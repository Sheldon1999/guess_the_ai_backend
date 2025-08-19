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

- **/auth/connect**: connect wallet (register if first time)
- **/user/:wallet** (GET/PATCH): get/update profile (username only)
- **/game/next**: get next image (no repeat per-user; global cooldown)
- **/game/answer**: submit guess (updates counters, rank, dungeon title; bumps leaderboards)
- **/img/h/:hash**: serve image (disk-first; cold pass-through + cached)
- **/admin/topup**: warm specific hashes
- **/admin/topup/new**: warm latest images from Mongo (`images` with `uploadedAt`)
- **/admin/label(s)**: upsert truth labels in Mongo
- **/leaderboard/alltime**, **/leaderboard/weekly**: leaderboards

Set `.env` values, particularly `OGSOURCE_BASE` and DB/Redis URLs.
