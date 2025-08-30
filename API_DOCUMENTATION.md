# GuessTheAI API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication
Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## User Endpoints

### 1. Login / Register
**Endpoint:** `POST /user/login`

**Request:**
```bash
curl -X POST "$BASE_URL/user/login" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x123..."}'
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "username": "Player_123"
  }
}
```

**Error Responses:**
- 400 Bad Request - Invalid wallet address format
```json
{"success": false, "message": "invalid walletAddress"}
```

- 500 Internal Server Error
```json
{"success": false, "message": "internal error"}
```

### 2. Update Username
**Endpoint:** `PATCH /user/updateUsername`

**Request:**
```bash
curl -X PATCH "$BASE_URL/user/updateUsername" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "NewUsername"}'
```

**Success Response (200 OK):**
```json
{"success": true, "message": "Username updated"}
```

**Error Responses:**
- 400 Bad Request - Invalid username
```json
{"success": false, "message": "username cannot be empty"}
```

- 400 Bad Request - Username too long
```json
{"success": false, "message": "username too long"}
```

- 401 Unauthorized - Missing or invalid token
```json
{"success": false, "message": "No token provided"}
```

## Game Endpoints

### 1. Get Next Game Image
**Endpoint:** `GET /game/next`

**Request:**
```bash
curl -X GET "$BASE_URL/game/next" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Success Response (200 OK):**
```json
{
  "hash": "a1b2c3...",
  "imageUrl": "https://example.com/images/a1b2c3.jpg",
  "imageId": "507f1f77bcf86cd799439011"
}
```

### 2. Submit Answer
**Endpoint:** `POST /game/answer`

**Request:**
```bash
curl -X POST "$BASE_URL/game/answer" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hash": "a1b2c3...", "guess": "ai"}'
```

**Success Response (200 OK):**
```json
{
  "correct": true,
  "truth": "ai",
  "imageId": "507f1f77bcf86cd799439011",
  "hash": "a1b2c3...",
  "profile": {
    "_id": "0x123...",
    "username": "Player_123",
    "correctAnswers": 5,
    "currentStreak": 3,
    "streak": 5,
    "rank": "C",
    "dungeonTitle": "Adept",
    "updatedAt": "2025-08-30T15:30:00.000Z"
  }
}
```

**Error Responses:**
- 400 Bad Request - Missing or invalid parameters
```json
{"error": "hash required"}
```

- 400 Bad Request - Invalid guess
```json
{"error": "guess must be 'ai' or 'human'"}
```

- 401 Unauthorized - Missing or invalid token

## Leaderboard Endpoints

### 1. All-time Leaderboard
**Endpoint:** `GET /leaderboard/alltime`

**Request:**
```bash
curl -X GET "$BASE_URL/leaderboard/alltime?limit=10&offset=0"
```

**Success Response (200 OK):**
```json
{
  "period": "alltime",
  "limit": 10,
  "offset": 0,
  "data": [
    {
      "_id": "0x123...",
      "username": "TopPlayer",
      "score": 150,
      "rank": 1
    },
    ...
  ]
}
```

### 2. Weekly Leaderboard
**Endpoint:** `GET /leaderboard/weekly`

**Request:**
```bash
# Current week
curl -X GET "$BASE_URL/leaderboard/weekly?limit=10&offset=0"

# Specific week
curl -X GET "$BASE_URL/leaderboard/weekly?week=2025-35&limit=10&offset=0"
```

**Success Response (200 OK):**
```json
{
  "period": "weekly",
  "week": "2025-35",
  "limit": 10,
  "offset": 0,
  "data": [
    {
      "_id": "0x456...",
      "username": "WeeklyChamp",
      "score": 25,
      "rank": 1
    },
    ...
  ]
}
```

## Common Error Responses

### 401 Unauthorized
```json
{"success": false, "message": "No token provided"}
```

### 403 Forbidden
```json
{"success": false, "message": "Access denied"}
```

### 404 Not Found
```json
{"success": false, "message": "Resource not found"}
```

### 500 Internal Server Error
```json
{"success": false, "message": "Internal server error"}
```
