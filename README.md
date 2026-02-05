# Guess The AI — Backend

Node 20+, MongoDB, Redis. ESM modules.

## Quick start
```bash
npm i
cp .env.example .env
mkdir -p ./cache/orig
npm run dev
```

## Key endpoints

- **POST /api/user/login**: connect wallet (register if first time; now mirrors on-chain registration)
- **PUT /api/user/updateUsername**: update username
- **POST /api/game/session/start**: create/reset a play session (triggers on-chain `GameStarted`)
- **POST /api/game/session/end**: finalise active session (records on-chain `GameEnded`)
- **POST /api/game/next**: get next image (no repeat per-user; global cooldown)
- **POST /api/game/answer**: submit guess (updates counters, rank, dungeon title; bumps leaderboards)
- **POST /api/game/next10**: fetch a batch of upcoming images
- **GET /api/user/profile**: current player profile
- **GET /api/leaderboard/alltime**, **/api/leaderboard/weekly**: leaderboards
- **GET /api/img/h/:hash**: serve image (disk-first; cold pass-through + cached)

Set `.env` values, particularly DB/Redis URLs, `OGSOURCE_BASE`, and the on-chain configuration below.

## On-chain configuration

The backend can emit transactions whenever players register, start a session, or end a session. Provide the following env vars to enable it:

| Variable | Purpose |
| --- | --- |
| `ONCHAIN_RPC_URL` | HTTPS RPC endpoint for the target EVM network (e.g. 0G Galileo) |
| `ONCHAIN_PRIVATE_KEY` | Admin signer that pays gas and submits transactions (no `0x` needed) |
| `ONCHAIN_CONTRACT_ADDRESS` | Deployed `GuessTheAIEvents` contract address |
| `ONCHAIN_ANSWER_CONTRACT_ADDRESS` | Deployed `AnswerSubmissions` contract address |
| `ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS` | Deployed `Leaderboard` contract address |
| `ONCHAIN_SEASON_ID` | Season id for leaderboard writes (defaults to `1`) |
| `ONCHAIN_CHAIN_ID` | Chain id (defaults to `16601`) |
| `ONCHAIN_CHAIN_NAME` | Friendly chain name for logs (defaults to `0G Galileo Testnet`) |
| `ONCHAIN_CHAIN_CURRENCY` | Native token symbol (defaults to `OG`) |
| `ONCHAIN_CHAIN_DECIMALS` | Native token decimals (defaults to `18`) |
| `GAME_SESSION_TTL_SEC` | Redis TTL for an active game session (defaults to 3600, min 60) |

If any of the first three values are missing the integration auto-disables and gameplay continues without blockchain writes.
