# Guess the AI × 0G — Full Infrastructure Stack

*Created by the Kult Games team.*

**Guess the AI** is a Web3 skill game: for every image, the player judges **AI-generated** vs **human-made**. The backend and client are built so that **competitive truth** and **receipts** can live on **0G EVM**, **verifiable labels** on **0G Storage** (indexer-addressed manifests), **availability-oriented gameplay events** flow through **0G DA–compatible pipelines**, and **AI hints** are produced by **0G Compute** (broker `chatCompletion`) **first**; **Cloudflare Workers AI** is used **only** as a **sequential fallback** when 0G errors, returns empty, or exceeds `HINT_ZG_TIMEOUT_MS`—**not** as the primary path and **not** in parallel with 0G for the same hint. This document is a **complete technical reference** for how each layer is wired — in the same spirit as the Highway Hustle × 0G reference you may have seen: **contracts, env vars, flows, payloads, and failure behavior**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)  
2. [0G EVM — Smart Contracts](#2-0g-evm--smart-contracts)  
3. [0G Storage — Images & the Label Manifest (Decentralized Verify)](#3-0g-storage--images--the-label-manifest-decentralized-verify)  
4. [0G DA (Data Availability) — How We Use It in Guess the AI](#4-0g-da-data-availability--how-we-use-it-in-guess-the-ai)  
5. [0G Compute — AI Hints (Broker + Cloudflare)](#5-0g-compute--ai-hints-broker--cloudflare)  
6. [Trust-Minimized Verification — Three Paths](#6-trust-minimized-verification--three-paths)  
7. [Data Flow: What Happens on Each Player Action](#7-data-flow-what-happens-on-each-player-action)  
8. [API Endpoints Reference](#8-api-endpoints-reference)  
9. [Environment Variables](#9-environment-variables)  
10. [Network Details & SDKs](#10-network-details--sdks)  
11. [Summary](#11-summary)  

---

## 1. Architecture Overview

```
React + Vite Web Client (Privy wallet)
      │
      ▼
Express.js Backend (Node.js, ESM)
      │
      ├── MongoDB ───────────────────── Primary game state (images metadata, users, sessions)
      │
      ├── Redis ─────────────────────── Sessions, scores cache, hint strings (polling)
      │
      ├── 0G EVM (Chain ID 16661 typical) ─── 3 smart contracts
      │       ├── GuessTheAIEvents ─────── registerPlayer, GameStarted, GameEnded
      │       ├── AnswerSubmissions ───── SubmissionRecorded (every guess receipt)
      │       └── Leaderboard ─────────── SeasonScoreSet / season totals
      │
      ├── 0G Storage (Indexer) ───────── Manifest JSON at fixed storage root
      │       └── indexer-storage-turbo.0g.ai/file?root=<ROOT>
      │           → Official AI/Human labels · Merkle-addressed blob · anyone can re-fetch
      │
      ├── 0G DA–aligned pipelines ─────── Batched answer events → optional upstream writer
      │       └── + HTTP gateway (zero_g_da_event_gateway style) → /v1/events
      │
      └── 0G Compute ─────────────────── @0glabs/0g-serving-broker (hints — primary path)
              └── Cloudflare Workers AI — fallback only (after 0G error, empty reply, or `HINT_ZG_TIMEOUT_MS`)
```

**Design principle (same philosophy as Highway Hustle):** MongoDB/Redis are the **fast, queryable** source of truth for live play. The **0G stack adds a trustless, decentralized layer**: immutable receipts on **0G EVM**, **content-addressed** label data via **0G Storage + indexer**, **structured event streams** suitable for **DA / availability** downstream, and **real inference traffic** through **0G Compute**. If any 0G dependency is down, **the game keeps running** — chain writes skip, hints may fall back **to Cloudflare only when 0G cannot return text** (if `CF_*` is set), DA batches retry or drop quietly.

### Explicit trust model (for review)

- **Operator-signed on-chain receipts:** transactions are submitted by a server-held operator key (`ONCHAIN_PRIVATE_KEY`), not by end-user wallets per action.
- **What users can verify:** event/score receipts on chain, manifest contents from 0G Storage roots, and DA status/proof material when the DA pipeline is healthy.
- **What remains centralized:** API-level game logic and ordering are server-controlled; decentralization adds auditability and availability, not full client-trustless execution.

---

## 2. 0G EVM — Smart Contracts

### Network

| Parameter | Value |
|-----------|--------|
| Network | **0G Mainnet** (typical) |
| Chain ID | **`16661`** (`ONCHAIN_CHAIN_ID`) |
| RPC URL | **`https://evmrpc.0g.ai`** (`ONCHAIN_RPC_URL`) |
| Explorer | **`https://chainscan.0g.ai`** |
| Client | **viem** — `createWalletClient`, `createPublicClient`, `writeContract` |
| Signer | One **operator** wallet: `ONCHAIN_PRIVATE_KEY` (gas-sponsored writes for all players) |

### Overview

**Three** custom Solidity contracts are deployed. Each covers a distinct slice of activity. Writes go through `guess_the_ai_backend/src/lib/onchain/index.js` immediately after (or in parallel with) MongoDB/Redis updates so on-chain history stays **consistent with** live game state when RPC is healthy.

---

### Contract 1 — `GuessTheAIEvents`

**Purpose:** On-chain **identity and session envelope** — registration and bounded play sessions.

**Env var:** `ONCHAIN_CONTRACT_ADDRESS`

**ABI (key functions):**

```solidity
function registerPlayer(address player, string calldata username) external returns (bool);

function recordGameStart(address player, bytes32 sessionId) external returns (bool);

function recordGameEnd(
    address player,
    bytes32 sessionId,
    bool completed,
    uint256 totalCorrect,
    uint256 currentStreak
) external returns (bool);
```

**Events:**

```solidity
event PlayerRegistered(address indexed player, string username, uint256 timestamp);
event GameStarted(address indexed player, bytes32 indexed sessionId, uint256 timestamp);
event GameEnded(
    address indexed player,
    bytes32 indexed sessionId,
    uint256 timestamp,
    bool completed,
    uint256 totalCorrect,
    uint256 currentStreak
);
```

**Triggered by:**

| Integration | When |
|-------------|------|
| `recordUserRegistration` | Wallet login / registration (`auth.js`, `userService.js`) |
| `recordGameStart` | `POST /api/game/session/start` → `sessionService.js` |
| `recordGameEnd` | `POST /api/game/session/end` |

---

### Contract 2 — `AnswerSubmissions`

**Purpose:** **Immutable audit trail** of every guess: wallet, session, question id, **keccak answer commitment**, correctness.

**Env var:** `ONCHAIN_ANSWER_CONTRACT_ADDRESS`

**Game linkage:** `questionId` is a `uint256` derived from the **image content hash** (deterministic `toQuestionId`); `answerHash` is `keccak256` of the committed answer string used in the write path.

**ABI (key function):**

```solidity
function recordSubmission(
    address player,
    bytes32 sessionId,
    uint256 questionId,
    bytes32 answerHash,
    bool isCorrect
) external returns (uint256 submissionId);
```

**Event:**

```solidity
event SubmissionRecorded(
    uint256 indexed submissionId,
    address indexed player,
    bytes32 indexed sessionId,
    uint256 questionId,
    bytes32 answerHash,
    bool isCorrect,
    uint256 timestamp
);
```

**Triggered by:**

| Route | Backend |
|-------|---------|
| Classic | `POST /api/game/ans` → `processAnswer` → `recordAnswerSubmissionHash` (`writeNoWait` hot path) |
| Modes | Card flip, rapid fire, duel, odd one out, multi-select → `recordModeAnswerOnchain` |

**Optimization:** `recordAnswerSubmissionHash` uses **`writeNoWait`** so the HTTP response is not blocked on full receipt confirmation when configured.

---

### Contract 3 — `Leaderboard`

**Purpose:** **Season-scoped** aggregate correct answers per wallet — trustless leaderboard substrate.

**Env var:** `ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS`

```solidity
function setSeasonScore(
    uint256 seasonId,
    address player,
    uint256 totalCorrect
) external;
```

**Events:**

```solidity
event SeasonScoreIncremented(uint256 indexed seasonId, address indexed player, uint256 delta, uint256 totalCorrect);
event SeasonScoreSet(uint256 indexed seasonId, address indexed player, uint256 totalCorrect);
```

**Triggered by:** Correct answers that refresh profile `correctAnswers` → `recordSeasonScore` with `ONCHAIN_SEASON_ID`.

---

### Blockchain resilience pattern

We do not use a single `safeBlockchainCall` helper name, but the **same intent**: missing config → `{ skipped: true }`; transient gas errors → **retry with bumped fees**; answer hot path → **submit without blocking on receipt**. Core APIs **always** return MongoDB/Redis results first.

```javascript
// guess_the_ai_backend/src/lib/onchain/index.js (conceptual)
async function write({ functionName, args, address, abi, tag }) {
  if (!walletClient || !address) return { skipped: true, reason: "not-configured" };
  try {
    const hash = await walletClient.writeContract({ address, abi, functionName, args, ...feeBump });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
    return { hash, receipt };
  } catch (error) {
    // Retry once on underpriced / replacement errors with explicit nonce + higher fees
    // ...
    return { error };
  }
}
```

---

## 3. 0G Storage — Images & the Label Manifest (Decentralized Verify)

### What is 0G Storage + the indexer

Publishing a blob to **0G decentralized storage** yields a **content root** you can fetch through the public **indexer** — same family of infrastructure used across the ecosystem for **addressable, verifiable data**. For Guess the AI, the critical published artifact is the **image label manifest**: a JSON document whose keys are **image root hashes** and whose values are **`"ai"` | `"human"`** — the **official** labels used for scoring and for **public verification**.

### Manifest payload (schema v2, illustrative)

```json
{
  "schemaVersion": 2,
  "name": "Guess The AI",
  "entries": {
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": "ai",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": "human"
  }
}
```

After `npm run manifest:upload-0g`, you set:

**`IMAGE_LABEL_MANIFEST_STORAGE_ROOT`** = the **storage root** returned for that JSON blob.

### How the backend loads it

**File:** `src/services/imageLabelManifest.js`

| Step | Behavior |
|------|----------|
| URL | `OG_IMAGE_BASE_URL` → default `https://indexer-storage-turbo.0g.ai/file?root=` + **URL-encoded** `IMAGE_LABEL_MANIFEST_STORAGE_ROOT` |
| Fetch | `fetch(url)` with timeout · parse JSON · build `Map(hash → label)` |
| Cache | In-memory TTL (`IMAGE_LABEL_MANIFEST_CACHE_MS`) |
| Dev | Optional `IMAGE_LABEL_MANIFEST_LOCAL_PATH` reads disk instead of network |

### Manifest upload flow (operator)

```
npm run manifest:labels     → writes data/guesstheai-image-label-manifest.json
        │
        ▼
npm run manifest:upload-0g  → @0gfoundation/0g-ts-sdk (see tools/upload-manifest-0g.mjs)
        │
        ▼
Paste returned STORAGE ROOT into IMAGE_LABEL_MANIFEST_STORAGE_ROOT (.env)
        │
        ▼
Backend + optional frontend VITE_LABEL_MANIFEST_STORAGE_ROOT now agree → trust-minimized verify
```

---

## 4. 0G DA (Data Availability) — How We Use It in Guess the AI

### What is 0G DA

**0G DA (Data Availability)** is the layer that guarantees published data remains **available** and **verifiable** network-wide: **erasure coding** spreads redundant shards, **KZG commitments** prove shard correctness, and **VRF-style node assignment** makes withholding economically hostile. When data is anchored in this ecosystem, callers receive **deterministic roots** — anyone can later retrieve and check content **without trusting a single game server**.

### How Guess the AI uses it (compared to a “full player snapshot” pattern)

Highway Hustle–style integrations sometimes **upload one large JSON snapshot per milestone** to DA storage and store `{ rootHash, txHash }` on the player. **Guess the AI uses a complementary pattern optimized for high-frequency guesses:**

| Aspect | Guess the AI |
|--------|----------------|
| **Primary DA-shaped workload** | **Structured answer events** (wallet, session, image hash, guess, correctness, latency) batched and forwarded |
| **Persistence** | MongoDB collection **`daBatches`** stores each batch + optional upstream reference |
| **Optional upstream** | `DA_UPSTREAM_URL` — POST JSON batches to your **DA writer / availability stack** |
| **Parallel gateway** | `DA_GATEWAY_URL` → `POST /v1/events` — normalized **`game.answer`** events for analytics / indexing |

So: we **feed the DA ecosystem with append-only gameplay telemetry** suitable for availability proofs and indexing — rather than storing one monolithic “player snapshot blob” per score in *this* repo.

### Batch payload (conceptual)

```json
{
  "createdAt": "2026-05-01T12:00:00.000Z",
  "source": "guess-the-ai",
  "events": [
    {
      "walletAddress": "0x…",
      "sessionKey": "0x…",
      "hash": "0x…",
      "guess": "ai",
      "isCorrect": true,
      "latencyMs": 42,
      "ts": "2026-05-01T12:00:00.000Z"
    }
  ]
}
```

### DA flush flow (`daEventService.js` → internal submit → optional upstream)

```
Player submits answer (classic or mode)
        │
        ▼
enqueueDaAnswerEvent(...) + publishDaAnswerGatewayEvent(...)
        │
        ├── [parallel] daGateway.js → POST DA_GATEWAY_URL/v1/events  (Bearer DA_INGEST_API_KEY)
        │                 event: "game.answer" · game: "guess_the_ai"
        │
        └── [queued] flush timer → POST DA_API_URL (default: /api/internal/da/submit)
                        │
                        ▼
                submitDaBatch in daWriterService.js
                        │
                        ├── If DA_UPSTREAM_URL → forward batch · extract reference
                        │
                        └── Else reference = local-da-… + still persist to MongoDB
```

### Gateway envelope (actual shape)

```json
{
  "game": "guess_the_ai",
  "event": "game.answer",
  "ts": "2026-05-01T12:00:00.000Z",
  "data": {
    "flow": "classic",
    "walletAddress": "0x…",
    "sessionKey": "0x…",
    "sessionId": "…",
    "hash": "0x…",
    "guess": "ai",
    "isCorrect": true,
    "latencyMs": 42
  }
}
```

### Resilience

- **Non-blocking:** DA enqueue does not delay the HTTP response path for gameplay.  
- **Timeouts:** `DA_TIMEOUT_MS`, `DA_GATEWAY_TIMEOUT_MS`.  
- **Disable gateway answers:** `DA_GATEWAY_PUBLISH_ANSWERS=false`.  
- **No upstream:** batches still get a **deterministic local reference** for audit.

---

## 5. 0G Compute — AI Hints (Broker + Cloudflare)

### What it does

During rounds, the UI can show **short cryptic hints** (never spoiling AI vs human). **`zgInference.chatCompletion()`** (`@0glabs/0g-serving-broker`) runs **first** for each hint; **`cfInference.chatCompletion()`** (Cloudflare Workers AI) runs **only after** that if needed—**one stored string per hint** in Redis, **not** two models in parallel. **Cloudflare** is used **only** when 0G errors, returns empty, or the attempt exceeds **`HINT_ZG_TIMEOUT_MS`** (default 12s); the fallback uses **`HINT_CF_TIMEOUT_MS`** (default 30s). Configure **`ZG_PRIVATE_KEY`** for 0G; add **`CF_ACCOUNT_ID` + `CF_API_TOKEN`** if you want the Cloudflare fallback (optional).

### Endpoints / packages

| Layer | Technology |
|-------|------------|
| Hint text in Redis | From **0G** when that call succeeds; otherwise from **Cloudflare** if configured — `src/services/hintService.js` |
| 0G Compute (primary) | **`@0glabs/0g-serving-broker`** — `src/lib/zgInference.js` |
| Cloudflare (fallback only) | **Workers AI** — `src/lib/cfInference.js` — **not** invoked unless 0G fails or times out |

### Env (0G broker)

| Variable | Role |
|----------|------|
| `ZG_PRIVATE_KEY` | Wallet that pays / authenticates broker discovery (**required** for 0G path) |
| `ZG_RPC_URL` | Default `https://evmrpc.0g.ai` |
| `ZG_CHAT_MODEL` | e.g. `deepseek-chat-v3-0324` |
| `ZG_REQUEST_TIMEOUT_MS` | Default completion timeout for generic 0G calls |

### Env (Cloudflare — fallback hints only)

These variables matter **only** for the **second** step when 0G did not produce a hint. Omit them to run **0G-only** hints (no Cloudflare).

| Variable | Role |
|----------|------|
| `CF_ACCOUNT_ID` | Cloudflare account |
| `CF_API_TOKEN` | Workers AI token |
| `CF_CHAT_MODEL` | Default `@cf/meta/llama-3.1-8b-instruct-fast` |

Hint-only timeouts (optional): `HINT_ZG_TIMEOUT_MS`, `HINT_CF_TIMEOUT_MS`.

### Integration pattern (diagram)

```
Hint generation (e.g. /api/game/next10 → fireHintGenerationBatch)
        │
        ├── 0G chatCompletion(messages) → Redis → GET /api/game/hint/:roundId
        │
        └── If 0G fails / empty / timeout → then Cloudflare chatCompletion (**same** messages, sequential)
```

### System prompt (actual string)

```
You write cryptic 1-2 line gameplay hints for "Guess the AI" — a game where players
identify whether images are AI-generated or photographed by a human. NEVER reveal the
answer or say whether any image is AI or human. Focus on subtle visual cues the player
should inspect. Keep the hint under 25 words total. Return ONLY the hint text, nothing else.
```

### Implementation excerpt

```javascript
// hintService.js — 0G first, Cloudflare on failure / timeout; then Redis.
const { hint } = await resolveHint(messages);
await redis.set(key, hint, 'EX', HINT_ROUND_TTL_SEC);
```

**Triggered by:** Hint batch hooks from game controllers when `/next10` (and related flows) load image hashes.

**Note:** “Take AI Review” **percentage bars** in multi-image modes use **`percentageService.js`** (deterministic seeded RNG) — **not** an extra LLM call.

---

## 6. Trust-Minimized Verification — Three Paths

We designed verification so **curious players and auditors** can confirm labels against the **same manifest blob** the indexer serves — **minimal trust in our API**.

```
Path A — Backend API
  POST /api/verify/image-label  { imageHash, guess }
       → server loads manifest from indexer (or local file in dev) → JSON result

Path B — Browser direct (optional)
  VITE_LABEL_MANIFEST_STORAGE_ROOT matches backend
       → SPA fetches indexer JSON in-tab (verifyManifest0g.ts)
       → Falls back to API if CORS / env blocks direct read

Path C — Fully manual
  User copies image root hash from in-game control → Wallet tab paste → Verify
       → Same manifest truth as operator-published blob on 0G Storage
```

---

## 7. Data Flow: What Happens on Each Player Action

### Login (Privy)

```
POST /api/v2/login
    │
    └── MongoDB upsert
    └── recordUserRegistration (0G EVM) · async · failures logged only
```

### Session start / end

```
POST /api/game/session/start
    └── Redis + Mongo session
    └── recordGameStart(wallet, sessionKey)

POST /api/game/session/end
    └── recordGameEnd(wallet, sessionKey, completed, totals…)
```

### Classic answer

```
POST /api/game/ans
    │
    ├── MongoDB/Redis scoring ◄── HTTP 200 to player
    ├── recordAnswerSubmissionHash → AnswerSubmissions
    ├── recordSeasonScore (on profile update path)
    ├── enqueueDaAnswerEvent + publishDaAnswerGatewayEvent
    └── Optional on-chain tx hash surfaced in response when available
```

### Alternate modes (same chain + DA story)

```
GET  /api/game/<mode>/question
POST /api/game/<mode>/answer
    └── Mode handlers → recordModeAnswerOnchain + DA paths
```

Modes include: **classic**, **multiselect**, **duel**, **oddoneout**, **cardflip**, **rapidfire** (see `gameRoutes.js`).

### Verify label (auditor)

```
POST /api/verify/image-label
    └── Manifest fetch from indexer root → compare guess vs official label
```

---

## 8. API Endpoints Reference

### Verification & manifest

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`/`POST` | `/api/verify/image-label` | Official label vs guess (`imageHash`, `guess`) |
| `POST` | `/api/verify/image-label/cache/purge` | Purge manifest cache (`MANIFEST_PURGE_API_KEY`) |

### Game & sessions (EVM-adjacent)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/game/session/start` | Session + `recordGameStart` |
| `POST` | `/api/game/session/end` | End + `recordGameEnd` |
| `GET` | `/api/game/next10` | Batch images + hint generation hooks |
| `POST` | `/api/game/ans` | Classic answer + on-chain + DA |
| `GET` | `/api/game/hint/:roundId` | Poll hint from Redis |
| Various | `/api/game/*/question`, `/api/game/*/answer` | Alternate modes |

### DA internal

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/internal/da/submit` | Batch ingest (`DA_INTERNAL_API_KEY` optional) |

### Leaderboards & health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/leaderboard/alltime` | All-time board |
| `GET` | `/api/leaderboard/gateUsers` | Gate campaign board |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/health/da-queue` | DA durable queue + dead-letter metrics |
| `GET` | `/api/img/h/:hash` | Image bytes |

> **Note:** Guess the AI does **not** ship the Highway Hustle–specific routes like `/api/blockchain/scores` unless you add them; explorers read contracts directly via **chainscan**.

---

## 9. Environment Variables

```env
# ── 0G EVM ─────────────────────────────────────────────────────────────
ONCHAIN_RPC_URL=https://evmrpc.0g.ai
ONCHAIN_PRIVATE_KEY=0x<operator>
ONCHAIN_CHAIN_ID=16661
ONCHAIN_CONTRACT_ADDRESS=0x…                    # GuessTheAIEvents
ONCHAIN_ANSWER_CONTRACT_ADDRESS=0x…             # AnswerSubmissions
ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS=0x…        # Leaderboard
ONCHAIN_SEASON_ID=1

# ── 0G Storage / manifest ──────────────────────────────────────────────
OG_IMAGE_BASE_URL=https://indexer-storage-turbo.0g.ai/file?root=
IMAGE_LABEL_MANIFEST_STORAGE_ROOT=0x…
IMAGE_LABEL_MANIFEST_LOCAL_PATH=
ZG_STORAGE_INDEXER_URL=https://indexer-storage-turbo.0g.ai
ZG_STORAGE_PRIVATE_KEY=0x…                       # manifest upload CLI

# ── DA pipeline & gateway ───────────────────────────────────────────────
DA_API_URL=
DA_API_KEY=
DA_BATCH_SIZE=20
DA_FLUSH_INTERVAL_MS=15000
DA_TIMEOUT_MS=12000
DA_UPSTREAM_URL=
DA_UPSTREAM_API_KEY=
DA_STRICT_UPSTREAM=true
DA_QUEUE_RETRIES=5
DA_QUEUE_BACKOFF_MS=2000
DA_QUEUE_CONCURRENCY=4
DA_INTERNAL_API_KEY=

DA_GATEWAY_URL=
DA_INGEST_API_KEY=
DA_GATEWAY_TIMEOUT_MS=8000
DA_GAME_ID=guess_the_ai
DA_GATEWAY_PUBLISH_ANSWERS=true

# ── 0G Compute (broker = hints primary) + Cloudflare (optional fallback) ─
ZG_PRIVATE_KEY=0x…
ZG_RPC_URL=https://evmrpc.0g.ai
ZG_CHAT_MODEL=deepseek-chat-v3-0324

# Omit CF_* below if you only want 0G hints (no Cloudflare step).
CF_ACCOUNT_ID=
CF_API_TOKEN=
CF_CHAT_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
# Optional: HINT_ZG_TIMEOUT_MS=12000  HINT_CF_TIMEOUT_MS=30000
```

Full lists: `guess_the_ai_backend/.env.example`, `guess_the_ai_frontend/.env.example`.

---

## 10. Network Details & SDKs

### 0G Mainnet (typical)

| Resource | URL |
|----------|-----|
| EVM RPC | `https://evmrpc.0g.ai` |
| Chain ID | `16661` |
| Explorer | `https://chainscan.0g.ai` |
| Storage indexer (turbo) | `https://indexer-storage-turbo.0g.ai` |
| Storage indexer (standard) | `https://indexer-storage-standard.0g.ai` |

### SDK & npm (this repo)

| Package | Purpose |
|---------|---------|
| `viem` | All EVM writes / reads |
| `@0glabs/0g-serving-broker` | 0G Compute Network broker client |
| `@0gfoundation/0g-ts-sdk` | Manifest upload (`manifest:upload-0g`) |
| `ethers` | Broker / provider helpers inside `zgInference.js` |

---

## 11. Summary

| 0G Product | What Guess the AI Uses It For |
|------------|-------------------------------|
| **0G EVM** | **Three contracts** on chain ID **16661**: player **registration**, **session start/end**, **per-answer submissions** with hashed commitments, and **season leaderboard scores** — explorer-verifiable receipts alongside MongoDB. |
| **0G Storage** | **Label manifest** (and image pipeline) addressed via **indexer URLs**; players and auditors can **verify AI vs human** against the **same** published blob — **trust-minimized** label proofs. |
| **0G DA ecosystem** | **Batched answer events** + optional **upstream DA writer** + **HTTP gateway** (`game.answer`) — structured **availability-grade telemetry**, non-blocking. |
| **0G Compute** | **Hints:** **0G broker** generates text first; **Cloudflare** runs **only** if that step fails, is empty, or hits `HINT_ZG_TIMEOUT_MS`—sequential fallback, not parallel. |

---

*Repository roots: `guess_the_ai_backend/` (API, on-chain, DA, hints, manifest tools), `guess_the_ai_frontend/` (React, Privy, Wallet verification UI).*
