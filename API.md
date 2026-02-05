<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v24-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/MongoDB-6.x-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-Cache-DC382D?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/0G_Mainnet-On--Chain-8B5CF6?style=for-the-badge" />
</p>

<h1 align="center">Guess The AI - API Documentation</h1>

<p align="center">
  <b>Complete REST API reference for the Guess The AI backend</b><br/>
  <sub>All endpoints are prefixed with <code>/api</code> &bull; Base URL: <code>https://guesstheai.xyz</code></sub>
</p>

---

## Table of Contents

- [Authentication](#-authentication)
- [Endpoints](#-endpoints)
  - [Health Check](#health-check)
  - [User](#user)
  - [Game Session](#game-session)
  - [Gameplay](#gameplay)
  - [Leaderboard](#leaderboard)
  - [Campaign](#campaign)
  - [Image](#image)
- [Smart Contracts](#-smart-contracts-on-0g-mainnet)
- [On-Chain Recording](#-on-chain-recording)
- [Response Examples](#-response-examples)
- [Error Codes](#-error-codes)
- [Ranking System](#-ranking-system)

---

## Authentication

All protected endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are obtained via `/api/user/login` or `/api/v2/login`.

| Auth Method | Source | Description |
|-------------|--------|-------------|
| **JWT** | `Authorization: Bearer <token>` | Server-issued JWT from login |
| **Privy JWT** | `Authorization: Bearer <privy_token>` | Browser-based Privy authentication (V2 login) |

---

## Endpoints

### Health Check

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `GET` | `/api/health` | -- | Basic health check |
| `GET` | `/api/health/deps` | -- | Check Redis + MongoDB connectivity |

---

### User

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `POST` | `/api/user/login` | -- | Register or login with wallet address |
| `POST` | `/api/v2/login` | Optional | V2 login with Privy JWT support |
| `GET` | `/api/user/profile` | JWT | Get authenticated user's profile |
| `PUT` | `/api/user/updateUsername` | JWT | Update display name (max 30 chars) |

> New registrations are automatically recorded on-chain via `GuessTheAIEvents.registerPlayer()`

---

### Game Session

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `POST` | `/api/game/session/start` | JWT | Start a new game session |
| `POST` | `/api/game/session/end` | JWT | End current session and finalize stats |

**Session Start Request:**
```json
{
  "forceNew": false,
  "sessionId": "optional-custom-id"
}
```

> Both start and end are recorded on-chain via `GuessTheAIEvents`

---

### Gameplay

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `POST` | `/api/game/next` | JWT | Get next random image to guess |
| `GET` | `/api/game/next10` | JWT | Get 10 random images (batch mode) |
| `POST` | `/api/game/ans` | JWT | Submit answer (`"ai"` or `"human"`) |

**Answer Request:**
```json
{
  "hash": "IMAGE_HASH",
  "guess": "ai"
}
```

**Answer Response:**
```json
{
  "correct": true,
  "isCorrect": true,
  "truth": "ai",
  "imageId": "abc123",
  "hash": "abc123",
  "profile": {
    "username": "CryptoGuesser",
    "correctAnswers": 142,
    "currentStreak": 12,
    "streak": 25,
    "rank": "A",
    "dungeonTitle": "Warrior"
  },
  "gateStats": null
}
```

> Each answer is recorded on-chain via `AnswerSubmissions.recordSubmission()`
> Correct answers also update `Leaderboard.setSeasonScore()`

---

### Leaderboard

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `GET` | `/api/leaderboard/alltime` | -- | All-time leaderboard (sorted by correctAnswers) |
| `GET` | `/api/leaderboard/gateUsers` | -- | Gate campaign leaderboard |

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max results (capped at 200) |
| `offset` | number | 0 | Pagination offset |
| `type` | string | "all" | Filter type (gate leaderboard only) |

---

### Campaign

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `GET` | `/api/game/isGateUserEligible` | JWT | Check Gate campaign eligibility |
| `PUT` | `/api/game/awardGateUser` | JWT | Award Gate campaign reward |
| `GET` | `/api/game/check-gate-user-eligibility/:address?` | -- | Check Gate eligibility by wallet |
| `GET` | `/api/game/isGalaxyUserEligible` | JWT | Check Galaxy campaign eligibility |
| `GET` | `/api/galaxy/check-galaxy-reward-eligibility` | -- | Check Galaxy reward eligibility |

---

### Image

| Method | Endpoint | Auth | Description |
|:------:|----------|:----:|-------------|
| `GET` | `/api/img/h/:hash` | -- | Redirect to image by hash (CDN) |

---

## Smart Contracts on 0G Mainnet

All game events are immutably recorded on the **0G Mainnet** blockchain.

| Property | Value |
|----------|-------|
| **Network** | 0G Mainnet |
| **Chain ID** | `16661` |
| **RPC URL** | `https://evmrpc.0g.ai` |
| **Block Explorer** | [https://chainscan.0g.ai](https://chainscan.0g.ai) |
| **Currency** | OG (18 decimals) |

### Deployed Contracts

| # | Contract | Address | Purpose |
|:-:|----------|---------|---------|
| 1 | **GuessTheAIEvents** | [`0x4aCfb1a2Dc270846A7913757189543e4C18F7826`](https://chainscan.0g.ai/address/0x4aCfb1a2Dc270846A7913757189543e4C18F7826) | Player registration, game session tracking |
| 2 | **AnswerSubmissions** | [`0x73d377634F906fD24fE342fd95182c3c80bCFe49`](https://chainscan.0g.ai/address/0x73d377634F906fD24fE342fd95182c3c80bCFe49) | Answer recording with anti-cheat hashing |
| 3 | **Leaderboard** | [`0x9663dA1163842cfbac83D382Bdf331227d012114`](https://chainscan.0g.ai/address/0x9663dA1163842cfbac83D382Bdf331227d012114) | Season-based leaderboard scores |

---

## On-Chain Recording

Every key gameplay action is recorded on-chain asynchronously (non-blocking to API responses).

| Action | Contract | Function | Data Recorded |
|--------|----------|----------|---------------|
| User registers | GuessTheAIEvents | `registerPlayer()` | Wallet address, username |
| Session starts | GuessTheAIEvents | `recordGameStart()` | Wallet, session key (bytes32) |
| Session ends | GuessTheAIEvents | `recordGameEnd()` | Wallet, session key, completed, total correct, streak |
| Answer submitted | AnswerSubmissions | `recordSubmission()` | Wallet, session key, question hash, answer hash, correctness |
| Correct answer | Leaderboard | `setSeasonScore()` | Season ID, wallet, total correct answers |

> All blockchain writes are **async** -- the API responds immediately from MongoDB/Redis, and the on-chain transaction is submitted in the background. Blockchain failures are logged but never block API responses.

---

## Response Examples

### `GET /api/health`
```json
{ "ok": true }
```

### `GET /api/health/deps`
```json
{ "redis": "ok", "mongo": "ok" }
```

### `POST /api/user/login`
```bash
curl -X POST "/api/user/login" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x1234..."}'
```
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "username": "Player_1738784123456",
    "nameUpdated": false
  }
}
```

### `POST /api/game/session/start`
```bash
curl -X POST "/api/game/session/start" \
  -H "Authorization: Bearer JWT_TOKEN"
```
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "startedAt": "2026-02-06T10:30:00.000Z",
    "totalGuesses": 0,
    "correctGuesses": 0
  }
}
```

### `POST /api/game/ans`
```bash
curl -X POST "/api/game/ans" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hash": "abc123", "guess": "ai"}'
```
```json
{
  "correct": true,
  "isCorrect": true,
  "truth": "ai",
  "imageId": "abc123",
  "hash": "abc123",
  "profile": {
    "username": "CryptoGuesser",
    "correctAnswers": 142,
    "currentStreak": 12,
    "streak": 25,
    "rank": "A",
    "dungeonTitle": "Warrior"
  },
  "gateStats": null
}
```

### `POST /api/game/session/end`
```bash
curl -X POST "/api/game/session/end" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "startedAt": "2026-02-06T10:30:00.000Z",
    "totalGuesses": 10,
    "correctGuesses": 8,
    "totals": {
      "correctAnswers": 142,
      "currentStreak": 12
    },
    "onchain": {
      "transactionHash": "0xabc123..."
    }
  }
}
```

### `GET /api/leaderboard/alltime?limit=10`
```json
{
  "success": true,
  "data": [
    {
      "rank": "S",
      "dungeonTitle": "Dragon Hunter",
      "username": "TopPlayer",
      "walletAddress": "0x1234...",
      "correctAnswers": 500,
      "currentStreak": 25,
      "streak": 105
    }
  ]
}
```

### `GET /api/user/profile`
```json
{
  "success": true,
  "data": {
    "walletAddress": "0x1234...",
    "username": "CryptoGuesser",
    "correctAnswers": 142,
    "currentStreak": 12,
    "streak": 25,
    "rank": "A",
    "dungeonTitle": "Warrior",
    "nameUpdated": true,
    "createdAt": "2026-01-15T08:00:00.000Z",
    "updatedAt": "2026-02-06T10:30:00.000Z"
  }
}
```

---

## Error Codes

| Status | Body | Meaning |
|:------:|------|---------|
| `400` | `{ "error": "hash required" }` | Missing required field |
| `401` | `{ "success": false, "message": "unauthorized" }` | Invalid or missing JWT |
| `404` | `{ "success": false, "message": "user not found" }` | Resource not found |
| `500` | `{ "success": false, "message": "internal error" }` | Server error |

---

## Ranking System

Players earn ranks based on total correct answers and dungeon titles based on their best streak.

### Ranks (by Correct Answers)

| Correct Answers | Rank |
|:---------------:|:----:|
| 5000+ | **S++** |
| 1000+ | **S+** |
| 500+ | **S** |
| 100+ | **A** |
| 80+ | **B** |
| 50+ | **C** |
| 20+ | **D** |
| 0+ | **E** |

### Dungeon Titles (by Best Streak)

| Best Streak | Title |
|:-----------:|-------|
| 200+ | **Demon World Ruler** |
| 120+ | **Demon Slayer** |
| 100+ | **Dragon Hunter** |
| 50+ | **Warrior** |
| 0+ | **Newbie** |

---

## Quick Test Flow

```bash
# 1. Health check
curl http://localhost:3000/api/health

# 2. Register / Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xYOUR_WALLET"}' | jq -r '.data.token')

# 3. Start session
curl -X POST http://localhost:3000/api/game/session/start \
  -H "Authorization: Bearer $TOKEN"

# 4. Get image
curl -X POST http://localhost:3000/api/game/next \
  -H "Authorization: Bearer $TOKEN"

# 5. Submit answer
curl -X POST http://localhost:3000/api/game/ans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hash":"IMAGE_HASH","guess":"ai"}'

# 6. End session
curl -X POST http://localhost:3000/api/game/session/end \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed":true}'

# 7. Check leaderboard
curl http://localhost:3000/api/leaderboard/alltime?limit=10
```

---

<p align="center">
  <b>Guess The AI</b> &bull; 3 Smart Contracts on 0G Mainnet &bull; v1.0<br/>
  <sub>Built with Express.js &bull; MongoDB &bull; Redis &bull; Socket.IO &bull; Viem</sub>
</p>
