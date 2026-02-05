# Guess The AI Blockchain Integration Documentation

## Overview
Guess The AI implements on-chain game data recording on the 0G blockchain network. This document outlines all blockchain contracts, their functionalities, and data flows. The system provides an immutable record of player activity, answer submissions, and leaderboard scores.

---

## Network Information
**Network:** 0G Galileo Testnet  
**Chain ID:** 16601  
**RPC URL:** https://evmrpc-testnet.0g.ai  
**Block Explorer:** https://chainscan-galileo.0g.ai

---

## Deployed Contracts

### 1. GuessTheAIEvents
**Purpose:** Records player registration, game session starts, and game session completions on-chain.

**Recorded Data:**
- Player wallet address
- Username (optional)
- Session ID (bytes32 hash)
- Game completion status
- Total correct answers per session
- Current answer streak

**Key Functions:**
| Function | Description |
|----------|-------------|
| `registerPlayer(address, string)` | Registers a new player with wallet and optional username |
| `recordGameStart(address, bytes32)` | Records the start of a new game session |
| `recordGameEnd(address, bytes32, bool, uint256, uint256)` | Records game completion with results |
| `registeredPlayers(address)` | Returns whether a player is registered |
| `knownSessions(bytes32)` | Returns whether a session ID exists |

**Events:**
- `PlayerRegistered` - New player registered
- `GameStarted` - Game session started
- `GameEnded` - Game session completed with results

**Trigger:** Called when:
- User creates an account (registration)
- User starts a new game session
- User completes a game session

---

### 2. AnswerSubmissions
**Purpose:** Records individual answer submissions with cryptographic hashes for verification and anti-cheat.

**Recorded Data:**
- Player wallet address
- Session ID (bytes32)
- Question ID
- Answer hash (keccak256 of the answer)
- Correctness boolean
- Submission timestamp

**Key Functions:**
| Function | Description |
|----------|-------------|
| `recordSubmission(address, bytes32, uint256, bytes32, bool)` | Records an answer submission |
| `getSubmission(uint256)` | Retrieves submission details by ID |
| `getPlayerSubmissionIds(address)` | Returns all submission IDs for a player |
| `getSessionSubmissionIds(bytes32)` | Returns all submission IDs for a session |
| `totalSubmissions()` | Returns total number of submissions recorded |

**Events:**
- `SubmissionRecorded` - Answer submission recorded with all details

**Trigger:** Called when a player submits an answer to a question.

**Anti-Cheat Features:**
- Answers are stored as keccak256 hashes, not plaintext
- Immutable on-chain record prevents tampering
- Session linking ensures answer belongs to valid game

---

### 3. Leaderboard
**Purpose:** Maintains season-based leaderboards with player scores.

**Recorded Data:**
- Season ID
- Player wallet address
- Total correct answers per season

**Key Functions:**
| Function | Description |
|----------|-------------|
| `setSeasonScore(uint256, address, uint256)` | Sets absolute score for a player in a season |
| `incrementSeasonScore(uint256, address, uint256)` | Adds to a player's season score |
| `getSeasonScore(uint256, address)` | Returns player's score in a season |
| `getSeasonPlayers(uint256)` | Returns all players who participated in a season |

**Events:**
- `SeasonScoreSet` - Player's season score set
- `SeasonScoreIncremented` - Player's season score increased

**Trigger:** Called when updating player leaderboard standings after game completion.

---

## Data Flow Architecture

### 1. Player Registration Flow
```
User Signs Up → Backend API → MongoDB Save → 
Blockchain Service (Async) → GuessTheAIEvents.registerPlayer()
```

### 2. Game Start Flow
```
User Starts Game → Backend API → Session Created → 
Blockchain Service (Async) → GuessTheAIEvents.recordGameStart()
```

### 3. Answer Submission Flow
```
User Submits Answer → Backend API → Answer Validated → MongoDB Update → 
Blockchain Service (Async) → AnswerSubmissions.recordSubmission()
```

### 4. Game End Flow
```
User Completes Game → Backend API → Score Calculated → MongoDB Update → 
Blockchain Service (Async) → GuessTheAIEvents.recordGameEnd()
```

### 5. Leaderboard Update Flow
```
Game Completed → Score Finalized → 
Blockchain Service (Async) → Leaderboard.setSeasonScore()
```

---

## Integration Strategy

### Async Recording Pattern
All blockchain write operations are executed asynchronously to avoid blocking API responses:

1. **Immediate Response:** API responds to client with MongoDB data immediately
2. **Background Recording:** Blockchain transaction is submitted in the background
3. **Non-Blocking:** API performance is unaffected by blockchain latency
4. **Logging:** Success/failure is logged but does not impact user experience

### Session Key Derivation
Session IDs are derived using keccak256 hashing:
- If the session ID is already a valid 32-byte hex string, it's used directly
- Otherwise, the session ID string is hashed to produce a bytes32 key

### Error Handling
- Blockchain failures are logged but do not break API functionality
- MongoDB remains the source of truth for real-time gameplay
- Blockchain provides immutable historical record and verification
- Missing configuration gracefully skips blockchain writes

---

## Smart Contract Events

All contracts emit events for transparency and tracking:

### GuessTheAIEvents Events
| Event | Description |
|-------|-------------|
| `PlayerRegistered` | New player registered with wallet and username |
| `GameStarted` | Game session initiated |
| `GameEnded` | Game session completed with final stats |
| `AdminUpdated` | Contract admin changed |

### AnswerSubmissions Events
| Event | Description |
|-------|-------------|
| `SubmissionRecorded` | Answer recorded with hash and correctness |
| `AdminUpdated` | Contract admin changed |

### Leaderboard Events
| Event | Description |
|-------|-------------|
| `SeasonScoreSet` | Player score set for a season |
| `SeasonScoreIncremented` | Player score increased |
| `AdminUpdated` | Contract admin changed |

---

## Security Features

### Access Control
- All write functions are restricted to contract admin
- Admin is the backend deployer wallet
- Two-step admin transfer pattern prevents accidental lockout
- Prevents unauthorized data manipulation

### Anti-Cheat Mechanisms
- **Answer Hashing:** Answers stored as keccak256 hashes, not plaintext
- **Session Validation:** Answers linked to valid game sessions
- **Immutable Records:** Once recorded, data cannot be altered
- **Timestamp Tracking:** All events include blockchain timestamps

### Data Integrity
- Immutable on-chain records
- Event logging for audit trails
- Transparent public data viewable on block explorer

---

## Gas Costs and Performance

### Average Gas Costs (0G Network)
- Player registration: ~0.0001 OG
- Game start recording: ~0.0001 OG
- Answer submission: ~0.0002 OG
- Game end recording: ~0.0002 OG
- Leaderboard update: ~0.0002 OG

### Performance Characteristics
- All write operations are admin-only (backend controlled)
- No player signatures required
- Async design eliminates user-facing latency
- Viem library provides efficient transaction handling

---

## Development Resources

### Contract ABIs
Located in `src/lib/onchain/abi/`:
- `GuessTheAIEvents.json` - Player and game session events
- `AnswerSubmissions.json` - Answer recording
- `Leaderboard.json` - Season scoring

### Integration Code
Main integration file: `src/lib/onchain/index.js`

### Environment Variables Required
```
ONCHAIN_RPC_URL=<rpc_endpoint>
ONCHAIN_PRIVATE_KEY=<deployer_private_key>
ONCHAIN_CHAIN_ID=16601
ONCHAIN_CHAIN_NAME=0G Galileo Testnet
ONCHAIN_CHAIN_CURRENCY=OG
ONCHAIN_CHAIN_DECIMALS=18
ONCHAIN_CONTRACT_ADDRESS=<events_contract_address>
ONCHAIN_ANSWER_CONTRACT_ADDRESS=<answer_contract_address>
ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS=<leaderboard_contract_address>
ONCHAIN_SEASON_ID=<current_season_id>
```

---

## Monitoring and Maintenance

### Required Monitoring
1. **Deployer Wallet Balance:** Ensure sufficient OG for gas fees
2. **Transaction Success Rate:** Monitor blockchain service logs
3. **Event Emissions:** Track events for anomalies via block explorer

### Maintenance Tasks
1. **Regular:** Review transaction logs
2. **Seasonal:** Update season ID for new leaderboard periods
3. **As Needed:** Rotate admin keys if compromised

---

## Future Enhancements

### Potential Additions
1. **Achievement NFTs:** Mint NFTs for milestone achievements
2. **Reward Distribution:** On-chain reward claiming
3. **Tournament System:** Dedicated tournament contracts
4. **Cross-Chain:** Bridge to additional blockchain networks

### Scalability Considerations
- Current design supports unlimited players via mappings
- Season-based leaderboards prevent unbounded data growth
- Batch operations can be added for efficiency

---

## Support and Documentation

### Block Explorer
All contracts and transactions are publicly viewable at the 0G block explorer.

### Contract Source Code
All contracts are written in Solidity with admin-only write patterns.

---

**Document Version:** 1.0  
**Last Updated:** February 2026  
**Network:** 0G Galileo Testnet  
**Status:** Production
