# Guess The AI Backend API Documentation

All endpoints are prefixed with `/api`

---

## 🔗 Blockchain Contracts
Guess The AI uses 3 smart contracts deployed on the 0G Network for on-chain game data tracking.

### Network Information
- **Network:** 0G Mainnet
- **Chain ID:** 16661
- **RPC URL:** https://evmrpc.0g.ai
- **Block Explorer:** https://chainscan.0g.ai

### Deployed Contracts

#### 1. GuessTheAIEvents
**Purpose:** Records player registrations, game session starts, and game session completions on-chain.

#### 2. AnswerSubmissions
**Purpose:** Records individual answer submissions with cryptographic hashes for verification and anti-cheat.

#### 3. Leaderboard
**Purpose:** Maintains season-based leaderboards with player scores.

---

## 📡 Complete Endpoint List

### Authentication Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/user/login` | Register or login user ⛓️ | No |
| POST | `/api/v2/login` | V2 login (Privy-aware) | Optional |

**⛓️ = Records on blockchain (new registrations only)**

### User Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/user/profile` | Get user profile | JWT |
| PUT | `/api/user/updateUsername` | Update username | JWT |

### Game Session Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/game/session/start` | Start a new game session ⛓️ | JWT |
| POST | `/api/game/session/end` | End current game session ⛓️ | JWT |

**⛓️ = Records on blockchain**

### Game Play Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/game/next` | Get next image to guess | JWT |
| GET | `/api/game/next10` | Get 10 random images | JWT |
| POST | `/api/game/ans` | Submit answer ⛓️ 📊 | JWT |

**⛓️ = Records answer on blockchain**  
**📊 = Updates leaderboard on blockchain if correct**

### Campaign Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/game/isGateUserEligible` | Check Gate campaign eligibility | JWT |
| PUT | `/api/game/awardGateUser` | Mark Gate user as awarded | JWT |
| GET | `/api/game/check-gate-user-eligibility/:address?` | Check eligibility by address | No |
| GET | `/api/game/isGalaxyUserEligible` | Check Galaxy campaign eligibility | JWT |
| GET | `/api/galaxy/check-galaxy-reward-eligibility` | Galaxy reward eligibility check | No |

### Leaderboard Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/leaderboard/alltime` | Get all-time leaderboard | No |
| GET | `/api/leaderboard/gateUsers` | Get Gate campaign leaderboard | No |

### Health Check Endpoints
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/health` | Basic health check | No |
| GET | `/api/health/deps` | Check Redis and MongoDB status | No |

---

## 🔥 Quick Test Commands

### Health Checks
```bash
# Basic health
curl "/api/health"

# Dependencies health
curl "/api/health/deps"
```

### User Registration
```bash
# Register/Login
curl -X POST "/api/user/login" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0xWALLET"}'
```

### Game Session Flow
```bash
# Start session (records on blockchain)
curl -X POST "/api/game/session/start" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json"

# Get next image
curl -X POST "/api/game/next" \
  -H "Authorization: Bearer JWT_TOKEN"

# Submit answer (records on blockchain)
curl -X POST "/api/game/ans" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hash": "IMAGE_HASH", "guess": "ai"}'

# End session (records on blockchain)
curl -X POST "/api/game/session/end" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```

### Leaderboard Queries
```bash
# All-time leaderboard
curl "/api/leaderboard/alltime?limit=50&offset=0"

# Gate users leaderboard
curl "/api/leaderboard/gateUsers?limit=50&type=all"
```

---

## 🔗 What Gets Recorded On-Chain

### Automatic Recording

#### On User Registration
- **Contract:** GuessTheAIEvents
- **Function:** `registerPlayer()`
- **Data:** Wallet address, username

#### On Session Start
- **Contract:** GuessTheAIEvents
- **Function:** `recordGameStart()`
- **Data:** Wallet address, session key (bytes32)

#### On Session End
- **Contract:** GuessTheAIEvents
- **Function:** `recordGameEnd()`
- **Data:** Wallet address, session key, completion status, total correct, current streak

#### On Answer Submission
- **Contract:** AnswerSubmissions
- **Function:** `recordSubmission()`
- **Data:** Wallet address, session key, question ID (hashed), answer hash, correctness

#### On Correct Answer
- **Contract:** Leaderboard
- **Function:** `setSeasonScore()`
- **Data:** Season ID, wallet address, total correct answers

### Data Recorded Per Contract

**GuessTheAIEvents:**
- Player wallet address
- Username
- Session IDs (as bytes32 keys)
- Game start timestamps
- Game end results (completed, score, streak)

**AnswerSubmissions:**
- Submission ID (auto-incremented)
- Player wallet address
- Session ID
- Question ID (keccak256 hash)
- Answer hash (keccak256)
- Correctness boolean
- Timestamp

**Leaderboard:**
- Season ID
- Player wallet address
- Total correct answers per season

---

## 📊 Response Examples

### Health Check
```bash
curl "/api/health"
```

**Response:**
```json
{
  "ok": true
}
```

### Dependencies Check
```bash
curl "/api/health/deps"
```

**Response:**
```json
{
  "redis": "ok",
  "mongo": "ok"
}
```

### User Login
```bash
curl -X POST "/api/user/login" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x1234..."}'
```

**Response:**
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

### Start Session
```bash
curl -X POST "/api/game/session/start" \
  -H "Authorization: Bearer JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "startedAt": "2026-02-05T16:30:00.000Z",
    "totalGuesses": 0,
    "correctGuesses": 0
  }
}
```

### Submit Answer
```bash
curl -X POST "/api/game/ans" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hash": "abc123", "guess": "ai"}'
```

**Response:**
```json
{
  "correct": true,
  "isCorrect": true,
  "truth": "ai",
  "imageId": "abc123",
  "hash": "abc123",
  "profile": {
    "username": "Player_1738784123456",
    "correctAnswers": 42,
    "currentStreak": 5,
    "streak": 10,
    "rank": "A",
    "dungeonTitle": "Master"
  },
  "gateStats": null
}
```

### End Session
```bash
curl -X POST "/api/game/session/end" \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "startedAt": "2026-02-05T16:30:00.000Z",
    "totalGuesses": 10,
    "correctGuesses": 8,
    "totals": {
      "correctAnswers": 42,
      "currentStreak": 5
    },
    "onchain": {
      "transactionHash": "0xabc123..."
    }
  }
}
```

### Leaderboard
```bash
curl "/api/leaderboard/alltime?limit=10"
```

**Response:**
```json
[
  {
    "rank": "S",
    "username": "TopPlayer",
    "walletAddress": "0x1234...",
    "correctAnswers": 500,
    "currentStreak": 25,
    "streak": 50
  },
  {
    "rank": "A",
    "username": "Player2",
    "walletAddress": "0x5678...",
    "correctAnswers": 350,
    "currentStreak": 10,
    "streak": 30
  }
]
```

---

## 🔐 Authentication

All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

Tokens are obtained from the `/api/user/login` endpoint.

---

## ⚠️ Error Responses

**400 Bad Request:**
```json
{
  "error": "hash required"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "unauthorized"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "user not found"
}
```

**500 Internal Error:**
```json
{
  "success": false,
  "message": "internal error"
}
```

---

**Built for Guess The AI**  
**Blockchain Integration: 3 Contracts on 0G Mainnet**  
**Version:** 1.0
