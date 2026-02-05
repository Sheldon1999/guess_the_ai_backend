<p align="center">
  <img src="https://img.shields.io/badge/0G_Mainnet-Live-8B5CF6?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Chain_ID-16661-00FFFF?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Contracts-3_Deployed-FF00FF?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Viem-Blockchain_Client-FFD700?style=for-the-badge" />
</p>

<h1 align="center">Guess The AI - Blockchain Integration</h1>

<p align="center">
  <b>On-chain game data recording on the 0G Network</b><br/>
  <sub>Immutable records of player activity, answer submissions, and leaderboard scores</sub>
</p>

---

## Table of Contents

- [Network Information](#-network-information)
- [Deployed Contracts](#-deployed-contracts)
  - [GuessTheAIEvents](#1-guesstheaievents)
  - [AnswerSubmissions](#2-answersubmissions)
  - [Leaderboard](#3-leaderboard)
- [Data Flow Architecture](#-data-flow-architecture)
- [Integration Strategy](#-integration-strategy)
- [Smart Contract Events](#-smart-contract-events)
- [Security & Anti-Cheat](#-security--anti-cheat)
- [Gas Costs & Performance](#-gas-costs--performance)
- [Environment Variables](#-environment-variables)
- [Monitoring & Maintenance](#-monitoring--maintenance)

---

## Network Information

| Property | Value |
|----------|-------|
| **Network** | 0G Mainnet |
| **Chain ID** | `16661` |
| **RPC URL** | `https://evmrpc.0g.ai` |
| **Block Explorer** | [https://chainscan.0g.ai](https://chainscan.0g.ai) |
| **Currency** | OG |
| **Decimals** | 18 |

---

## Deployed Contracts

### Contract Addresses at a Glance

| # | Contract | Address | Explorer |
|:-:|----------|---------|----------|
| 1 | **GuessTheAIEvents** | `0x4aCfb1a2Dc270846A7913757189543e4C18F7826` | [View on Explorer](https://chainscan.0g.ai/address/0x4aCfb1a2Dc270846A7913757189543e4C18F7826) |
| 2 | **AnswerSubmissions** | `0x73d377634F906fD24fE342fd95182c3c80bCFe49` | [View on Explorer](https://chainscan.0g.ai/address/0x73d377634F906fD24fE342fd95182c3c80bCFe49) |
| 3 | **Leaderboard** | `0x9663dA1163842cfbac83D382Bdf331227d012114` | [View on Explorer](https://chainscan.0g.ai/address/0x9663dA1163842cfbac83D382Bdf331227d012114) |

---

### 1. GuessTheAIEvents

**Address:** `0x4aCfb1a2Dc270846A7913757189543e4C18F7826`
**Purpose:** Records player registrations, game session starts, and game session completions on-chain.

#### What Gets Recorded

| Data Point | Type | Description |
|------------|------|-------------|
| Player wallet | `address` | User's blockchain wallet address |
| Username | `string` | Optional display name |
| Session ID | `bytes32` | Unique game session identifier (keccak256 hash) |
| Completion status | `bool` | Whether the game session was completed |
| Total correct | `uint256` | Number of correct answers in the session |
| Current streak | `uint256` | Consecutive correct answers at session end |

#### Functions

| Function | Parameters | Description | When Called |
|----------|------------|-------------|------------|
| `registerPlayer` | `address player, string username` | Registers a new player on-chain | User creates an account |
| `recordGameStart` | `address player, bytes32 sessionKey` | Records the start of a game session | User starts a new game |
| `recordGameEnd` | `address player, bytes32 sessionKey, bool completed, uint256 totalCorrect, uint256 currentStreak` | Records game completion with final results | User finishes a game |
| `registeredPlayers` | `address player` | Returns whether a player is registered | Read-only query |
| `knownSessions` | `bytes32 sessionKey` | Returns whether a session ID exists | Read-only query |

#### Events Emitted

| Event | Fields | Description |
|-------|--------|-------------|
| `PlayerRegistered` | player, username | New player registered |
| `GameStarted` | player, sessionKey | Game session initiated |
| `GameEnded` | player, sessionKey, completed, totalCorrect, currentStreak | Game session completed |
| `AdminUpdated` | oldAdmin, newAdmin | Contract admin changed |

---

### 2. AnswerSubmissions

**Address:** `0x73d377634F906fD24fE342fd95182c3c80bCFe49`
**Purpose:** Records individual answer submissions with cryptographic hashes for verification and anti-cheat.

#### What Gets Recorded

| Data Point | Type | Description |
|------------|------|-------------|
| Player wallet | `address` | User's wallet address |
| Session ID | `bytes32` | Links answer to a valid game session |
| Question ID | `uint256` | Hashed identifier of the image/question |
| Answer hash | `bytes32` | keccak256 hash of the submitted answer |
| Correctness | `bool` | Whether the answer was correct |
| Timestamp | `uint256` | Block timestamp of submission |

#### Functions

| Function | Parameters | Description | When Called |
|----------|------------|-------------|------------|
| `recordSubmission` | `address player, bytes32 sessionKey, uint256 questionId, bytes32 answerHash, bool isCorrect` | Records an answer submission with hash | User submits any answer |
| `getSubmission` | `uint256 submissionId` | Retrieves full submission details by ID | Read-only query |
| `getPlayerSubmissionIds` | `address player` | Returns all submission IDs for a player | Read-only query |
| `getSessionSubmissionIds` | `bytes32 sessionKey` | Returns all submission IDs for a session | Read-only query |
| `totalSubmissions` | -- | Returns total submissions recorded globally | Read-only query |

#### Events Emitted

| Event | Fields | Description |
|-------|--------|-------------|
| `SubmissionRecorded` | submissionId, player, sessionKey, questionId, answerHash, isCorrect, timestamp | Answer recorded with all details |
| `AdminUpdated` | oldAdmin, newAdmin | Contract admin changed |

#### Anti-Cheat Features

- Answers stored as **keccak256 hashes**, never plaintext
- Each answer is **linked to a valid session** -- no orphaned submissions
- **Immutable on-chain record** prevents post-hoc tampering
- Submission IDs are **auto-incremented** for sequential tracking

---

### 3. Leaderboard

**Address:** `0x9663dA1163842cfbac83D382Bdf331227d012114`
**Purpose:** Maintains season-based leaderboards with player scores on-chain.

#### What Gets Recorded

| Data Point | Type | Description |
|------------|------|-------------|
| Season ID | `uint256` | Current season identifier |
| Player wallet | `address` | User's wallet address |
| Total correct | `uint256` | Cumulative correct answers for the season |

#### Functions

| Function | Parameters | Description | When Called |
|----------|------------|-------------|------------|
| `setSeasonScore` | `uint256 seasonId, address player, uint256 totalCorrect` | Sets absolute score for a player in a season | After each correct answer |
| `incrementSeasonScore` | `uint256 seasonId, address player, uint256 amount` | Adds to a player's season score | Alternative increment method |
| `getSeasonScore` | `uint256 seasonId, address player` | Returns player's score in a season | Read-only query |
| `getSeasonPlayers` | `uint256 seasonId` | Returns all players in a season | Read-only query |

#### Events Emitted

| Event | Fields | Description |
|-------|--------|-------------|
| `SeasonScoreSet` | seasonId, player, totalCorrect | Player's season score set |
| `SeasonScoreIncremented` | seasonId, player, amount, newTotal | Player's season score increased |
| `AdminUpdated` | oldAdmin, newAdmin | Contract admin changed |

---

## Data Flow Architecture

### 1. Player Registration

```
User Signs Up
    |
    v
Backend API ──> MongoDB Save (immediate)
    |
    v
Blockchain Service (async, non-blocking)
    |
    v
GuessTheAIEvents.registerPlayer(wallet, username)
    |
    v
PlayerRegistered event emitted on-chain
```

### 2. Game Session Start

```
User Starts Game
    |
    v
Backend API ──> Session Created in MongoDB
    |
    v
Blockchain Service (async)
    |
    v
GuessTheAIEvents.recordGameStart(wallet, sessionKey)
    |
    v
GameStarted event emitted on-chain
```

### 3. Answer Submission

```
User Submits Answer
    |
    v
Backend API ──> Answer Validated ──> MongoDB Update (immediate)
    |
    v
Blockchain Service (async, 2 parallel writes)
    |
    ├──> AnswerSubmissions.recordSubmission(wallet, sessionKey, questionId, answerHash, isCorrect)
    |         |
    |         v
    |    SubmissionRecorded event emitted
    |
    └──> (if correct) Leaderboard.setSeasonScore(seasonId, wallet, totalCorrect)
              |
              v
         SeasonScoreSet event emitted
```

### 4. Game Session End

```
User Completes Game
    |
    v
Backend API ──> Score Finalized ──> MongoDB Update (immediate)
    |
    v
Blockchain Service (async)
    |
    v
GuessTheAIEvents.recordGameEnd(wallet, sessionKey, completed, totalCorrect, currentStreak)
    |
    v
GameEnded event emitted on-chain
```

---

## Integration Strategy

### Async Recording Pattern

All blockchain writes are executed **asynchronously** to keep API responses fast:

| Step | What Happens |
|------|-------------|
| 1. **Immediate Response** | API responds to client from MongoDB/Redis instantly |
| 2. **Background Write** | Blockchain transaction submitted in background |
| 3. **Non-Blocking** | API performance is completely unaffected by chain latency |
| 4. **Fault Tolerant** | Blockchain failures are logged but never break the API |

### Session Key Derivation

Session IDs are converted to `bytes32` for on-chain storage:

```
If sessionId is already a valid 32-byte hex string:
    → Used directly as bytes32

Otherwise:
    → keccak256(sessionId) → bytes32 key
```

### Source of Truth

| Layer | Role |
|-------|------|
| **MongoDB** | Primary source of truth for real-time gameplay |
| **Redis** | Hot cache for user profiles and game state |
| **Blockchain** | Immutable historical record for verification and transparency |

---

## Smart Contract Events

All contracts emit events for on-chain transparency. These can be monitored via the [0G Block Explorer](https://chainscan.0g.ai).

### GuessTheAIEvents Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `PlayerRegistered` | New player registered | player, username |
| `GameStarted` | Game session initiated | player, sessionKey |
| `GameEnded` | Game completed with results | player, sessionKey, completed, totalCorrect, currentStreak |
| `AdminUpdated` | Admin role transferred | oldAdmin, newAdmin |

### AnswerSubmissions Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `SubmissionRecorded` | Answer recorded | submissionId, player, sessionKey, questionId, answerHash, isCorrect, timestamp |
| `AdminUpdated` | Admin role transferred | oldAdmin, newAdmin |

### Leaderboard Events

| Event | Description | Key Fields |
|-------|-------------|------------|
| `SeasonScoreSet` | Score set for season | seasonId, player, totalCorrect |
| `SeasonScoreIncremented` | Score increased | seasonId, player, amount, newTotal |
| `AdminUpdated` | Admin role transferred | oldAdmin, newAdmin |

---

## Security & Anti-Cheat

### Access Control

| Feature | Description |
|---------|-------------|
| **Admin-Only Writes** | All write functions are restricted to the deployer wallet |
| **Two-Step Transfer** | Admin transfer requires explicit acceptance to prevent lockout |
| **Backend Controlled** | No player signatures required -- all writes come from the server |

### Anti-Cheat Mechanisms

| Mechanism | How It Works |
|-----------|-------------|
| **Answer Hashing** | Answers stored as `keccak256` hashes, never plaintext |
| **Session Linking** | Every answer is linked to a valid game session |
| **Immutable Records** | Once recorded, data cannot be altered or deleted |
| **Timestamp Tracking** | All events include blockchain timestamps for audit |
| **Sequential IDs** | Auto-incremented submission IDs prevent gaps |

### Data Integrity

- All on-chain records are **publicly viewable** on the block explorer
- Events provide a complete **audit trail** of all game activity
- MongoDB and blockchain records can be **cross-verified** for consistency

---

## Gas Costs & Performance

### Average Gas Costs (0G Network)

| Operation | Estimated Cost |
|-----------|---------------|
| Player registration | ~0.0001 OG |
| Game start recording | ~0.0001 OG |
| Answer submission | ~0.0002 OG |
| Game end recording | ~0.0002 OG |
| Leaderboard update | ~0.0002 OG |

### Performance

| Property | Value |
|----------|-------|
| **Write latency** | Async -- zero impact on API response time |
| **Library** | Viem (efficient transaction handling) |
| **Signatures** | Admin-only (no player wallet interaction needed) |
| **Failure handling** | Graceful -- logged but never blocks gameplay |

---

## Environment Variables

All blockchain configuration is managed via environment variables:

```env
# --- Network ---
ONCHAIN_RPC_URL=https://evmrpc.0g.ai
ONCHAIN_CHAIN_ID=16661
ONCHAIN_CHAIN_NAME=0G Mainnet
ONCHAIN_CHAIN_CURRENCY=OG
ONCHAIN_CHAIN_DECIMALS=18

# --- Auth ---
ONCHAIN_PRIVATE_KEY=<deployer_wallet_private_key>

# --- Contract Addresses ---
ONCHAIN_CONTRACT_ADDRESS=0x4aCfb1a2Dc270846A7913757189543e4C18F7826
ONCHAIN_ANSWER_CONTRACT_ADDRESS=0x73d377634F906fD24fE342fd95182c3c80bCFe49
ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS=0x9663dA1163842cfbac83D382Bdf331227d012114

# --- Season ---
ONCHAIN_SEASON_ID=1
```

### Contract ABIs

Located in `src/lib/onchain/abi/`:

| File | Contract |
|------|----------|
| `GuessTheAIEvents.json` | Player registration and game session events |
| `AnswerSubmissions.json` | Answer recording with hashes |
| `Leaderboard.json` | Season-based scoring |

### Integration Code

Main blockchain service: `src/lib/onchain/index.js`

Exported functions:

| Function | Contract Used | Description |
|----------|---------------|-------------|
| `recordUserRegistration(wallet, username)` | GuessTheAIEvents | Record new player signup |
| `recordGameStart(wallet, sessionKey)` | GuessTheAIEvents | Record session start |
| `recordGameEnd(wallet, sessionKey, completed, totalCorrect, streak)` | GuessTheAIEvents | Record session completion |
| `recordAnswerSubmission(wallet, sessionKey, questionId, answer, isCorrect)` | AnswerSubmissions | Record individual answer |
| `recordSeasonScore(wallet, totalCorrect)` | Leaderboard | Update leaderboard score |
| `deriveSessionKey(sessionId)` | -- | Convert session ID to bytes32 |

---

## Monitoring & Maintenance

### Required Monitoring

| What | Why | How |
|------|-----|-----|
| **Deployer Wallet Balance** | Ensure sufficient OG for gas fees | Check wallet on explorer |
| **Transaction Success Rate** | Detect blockchain service issues | Monitor application logs |
| **Event Emissions** | Track on-chain activity for anomalies | Query events on explorer |

### Maintenance Tasks

| Frequency | Task | Description |
|-----------|------|-------------|
| Regular | Review transaction logs | Check for failed writes or anomalies |
| Seasonal | Update `ONCHAIN_SEASON_ID` | New season for fresh leaderboard period |
| As Needed | Rotate admin keys | If deployer private key is compromised |

### Graceful Degradation

If blockchain connectivity is lost:
- API continues to function normally using MongoDB
- Blockchain writes are skipped and logged
- No user-facing impact -- the game keeps running
- On-chain records resume when connectivity is restored

---

## Future Enhancements

| Enhancement | Description |
|-------------|-------------|
| **Achievement NFTs** | Mint NFTs for milestone achievements (S++ rank, 200+ streak) |
| **Reward Distribution** | On-chain reward claiming for top leaderboard players |
| **Tournament System** | Dedicated tournament contracts with prize pools |
| **Cross-Chain** | Bridge game data to additional blockchain networks |
| **Batch Operations** | Batch multiple submissions in a single transaction for efficiency |

---

<p align="center">
  <b>Guess The AI</b> &bull; 3 Smart Contracts &bull; 0G Mainnet &bull; Production<br/>
  <sub>
    <a href="https://chainscan.0g.ai/address/0x4aCfb1a2Dc270846A7913757189543e4C18F7826">GuessTheAIEvents</a> &bull;
    <a href="https://chainscan.0g.ai/address/0x73d377634F906fD24fE342fd95182c3c80bCFe49">AnswerSubmissions</a> &bull;
    <a href="https://chainscan.0g.ai/address/0x9663dA1163842cfbac83D382Bdf331227d012114">Leaderboard</a>
  </sub>
</p>
