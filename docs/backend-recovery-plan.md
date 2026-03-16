# Backend Recovery Plan

## Purpose

This document turns the last part of [user-duplication-root-cause-report.md](./user-duplication-root-cause-report.md) into a practical recovery plan.

It is written to help start saving the backend in a safe order.

This plan covers:

- what to do first
- which files will need changes later
- which tools/commands to use
- how to validate each step
- extra recommendations for stability

This document does **not** change source code. It is only a recovery guide.

---

## High-Level Goal

The backend needs to be fixed in this order:

1. protect production data
2. measure the current damage
3. clean duplicate users
4. clear risky Redis state
5. fix code so duplicates cannot come back
6. add a hard database constraint
7. validate everything under load

If you do the coding first but leave bad data and dirty Redis state in place, the same problem can come back after deploy.

---

## Tools You Will Use

### Required

- `node`
- `npm`
- `git`
- the existing investigation scripts in the repo-level `scripts/` folder

### Usually needed

- `mongodump` or a database/provider snapshot tool
- `mongosh` or a safe admin script for one-off DB checks
- `redis-cli` or your Redis provider dashboard

### Existing scripts already available

Run these from the repo root:

```bash
node scripts/audit-user-wallet-ambiguities.mjs
node scripts/investigate-user-integrity.mjs
node scripts/compare-duplicate-user-docs.mjs
```

These scripts are useful before and after every major step.

---

## Phase 0: Safety First

### Goal

Make sure you can recover if a merge or cleanup step goes wrong.

### Actions

1. Freeze user-writing traffic if possible.
2. Take a Mongo backup.
3. Take a Redis snapshot, or at least export the relevant keyspaces.

### Example commands

If `mongodump` is available:

```bash
mkdir -p backups
mongodump --uri "$MONGO_URL" --archive="backups/guesstheai-$(date +%Y%m%d-%H%M%S).archive"
```

If Redis is self-managed and `redis-cli` is available:

```bash
redis-cli -u "$REDIS_URL" --scan --pattern 'gta:mongodoc:*' > backups/redis-mongodoc-keys.txt
```

If you are on managed Mongo/Redis and these tools are not available, take provider-level snapshots instead.

### Why this matters

The dedupe step changes identity data. You want a clean rollback point before touching user rows.

---

## Phase 1: Baseline The Current State

### Goal

Capture evidence before changing anything.

### Commands

From repo root:

```bash
node scripts/investigate-user-integrity.mjs --json > tmp/investigate-before.json
node scripts/compare-duplicate-user-docs.mjs --json > tmp/duplicate-compare-before.json
node scripts/audit-user-wallet-ambiguities.mjs --json > tmp/wallet-audit-before.json
```

Create the folder if needed:

```bash
mkdir -p tmp
```

### What to look for

- duplicate wallet group count
- duplicate username group count
- risky dirty Redis snapshots
- groups where gameplay fields differ
- groups where only `username` and timestamps differ

### Why this matters

This gives you a checkpoint and a way to prove later that the cleanup worked.

---

## Phase 2: Define The Merge Rules Before Writing Anything

### Goal

Decide exactly how duplicate users will be merged.

### Recommended merge priority

When two docs belong to the same wallet:

1. Prefer the doc with higher `correctAnswers`
2. Then prefer higher `streak`
3. Then prefer `nameUpdated === true`
4. Then prefer richer `privyMetaData`
5. Then prefer latest `updatedAt`

### Recommended field-level merge behavior

- `walletAddress`: keep the canonical wallet
- `walletAddressOriginal`: keep the non-empty value
- `username`: prefer the user-set value if `nameUpdated === true`, otherwise keeper username
- `correctAnswers`, `currentStreak`, `streak`: keep the full stat set from the stronger gameplay doc
- `rank`, `dungeonTitle`: recompute from merged stats
- `privyMetaData`: merge non-empty fields
- `createdAt`: earliest value
- `updatedAt`, `lastUpdatedAt`, `lastFlushedAt`: latest value
- `nameUpdated`: true if either doc has true

### Important note

Do **not** merge stats field-by-field from different docs unless you really mean to. For example, taking `correctAnswers` from one doc and `streak` from another can create a user state that never actually existed.

---

## Phase 3: Build A Dry-Run Merge Planner

### Goal

Before any write, produce a file showing:

- keeper doc
- losing doc
- merged output
- fields that will change
- groups that need manual review

### Recommended output

Save a JSON file like:

```text
tmp/user-merge-plan.json
```

Each item should contain:

- normalized wallet
- keeper `_id`
- loser `_id`
- reason keeper was chosen
- merged document preview
- `requiresManualReview: true/false`

### Manual review groups

Mark these groups for review:

- gameplay stats differ
- both docs have `nameUpdated === true`
- both docs have different non-empty `privyMetaData` values for the same field
- both docs have meaningful but different usernames

### Why this matters

This step makes the real merge predictable and reviewable.

---

## Phase 4: Clean Mongo Data First

### Goal

Remove duplicate user rows in Mongo before deploying application fixes.

### How to do it

Use a dedicated one-off merge script or admin tool. The merge script should:

1. read each duplicate-wallet group
2. build one canonical merged doc
3. update the keeper doc
4. delete the loser doc
5. log every action

### Suggested write order per group

1. update keeper with merged fields
2. verify keeper row after write
3. delete loser row

### Why this order matters

If you delete first and then fail before update, you can lose data.

### Optional extra safety

Write every planned keeper/loser pair to a log file:

```text
tmp/user-merge-actions.log
```

---

## Phase 5: Clear Or Rebuild Redis Identity State

### Goal

Remove stale cached user snapshots and dirty-wallet entries after Mongo is cleaned.

### Why this is necessary

Mongo cleanup alone is not enough. Redis currently holds cached user state and dirty flush state that was built from the corrupted dataset.

### Minimum cleanup targets

- `gta:mongodoc:user:*`
- `gta:mongodoc:dirty-users`

### Suggested approach

Safest option:

- remove user-doc cache keys
- clear the dirty-users set
- let the backend repopulate cache from clean Mongo rows

### Example commands

If using `redis-cli`:

```bash
redis-cli -u "$REDIS_URL" DEL gta:mongodoc:dirty-users
redis-cli -u "$REDIS_URL" --scan --pattern 'gta:mongodoc:user:*'
```

Then delete the returned keys in batches.

If you prefer using existing repo tooling, use or extend:

```bash
node scripts/flush-redis.mjs
```

### Why this matters

If you leave dirty Redis snapshots behind, the backend can reintroduce confusion immediately after the data cleanup.

---

## Phase 6: Fix The Code Paths That Created The Problem

### Goal

Change the backend so the same corruption cannot happen again.

### Files to change

- `src/lib/mongo.js`
- `src/services/userService.js`
- `src/services/auth.js`
- `src/lib/docCache.js`
- `src/utils/crypto.js`
- `src/services/authHelpers.js`

### 6.1 Add wallet uniqueness at the DB layer

File:

- `src/lib/mongo.js`

Current issue:

- there is no unique index on `users.walletAddress`

Target shape:

```js
await users.createIndex({ walletAddress: 1 }, { unique: true });
await users.createIndex(
  { username: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
```

### 6.2 Replace duplicated user creation logic with one shared helper

Files:

- `src/services/userService.js`
- `src/services/auth.js`

Current issue:

- both files independently create users
- both use a read-then-create pattern

Target shape:

```js
const userDoc = await createOrGetUser({
  walletAddress,
  walletAddressOriginal,
  privyMetaData,
  now
});
```

Create the shared helper in a single place, for example:

- `src/lib/userIdentity.js`
- or `src/services/userIdentityService.js`

### 6.3 Harden Redis flush

File:

- `src/lib/docCache.js`

Current issue:

- Redis flush uses `upsert: true`

Target shape:

```js
const matches = await users
  .find({ walletAddress: snapshot.walletAddress }, { projection: { _id: 1 } })
  .limit(2)
  .toArray();

if (matches.length !== 1) {
  console.error("[docCache] flush skipped: ambiguous wallet", snapshot.walletAddress);
  continue;
}

await users.updateOne(
  { _id: matches[0]._id },
  { $set: payload }
);
```

### 6.4 Replace timestamp-based username generation

Files:

- `src/utils/crypto.js`
- `src/services/auth.js`
- `src/lib/docCache.js`
- `src/services/authHelpers.js`

Current issue:

- `Player_${Date.now()}` is used in more than one place

Target shape:

```js
import { randomBytes } from "node:crypto";

export function generatePlayerUsername() {
  return `Player_${randomBytes(4).toString("hex")}`;
}
```

Also remove fallback username creation from cache/read-only paths if possible.

### 6.5 Add temporary ambiguity guards

Files:

- `src/services/answerHandler.js`
- `src/services/sessionService.js`
- `src/services/eligibilityService.js`
- `src/lib/docCache.js`

Temporary pattern:

```js
const matches = await users.find({ walletAddress }).limit(2).toArray();

if (matches.length !== 1) {
  throw new Error(`Ambiguous user identity for wallet ${walletAddress}`);
}
```

This can be removed or simplified later once wallet uniqueness is guaranteed and old duplicates are gone.

---

## Phase 7: Validate The Fixes Before Production Rollout

### Goal

Prove the backend is safe before shipping.

### Validation checklist

#### Re-run the existing audits

```bash
node scripts/investigate-user-integrity.mjs --json > tmp/investigate-after.json
node scripts/compare-duplicate-user-docs.mjs --json > tmp/duplicate-compare-after.json
node scripts/audit-user-wallet-ambiguities.mjs --json > tmp/wallet-audit-after.json
```

Expected results:

- duplicate wallet groups: `0`
- duplicate username groups: `0`
- risky dirty Redis snapshots: `0`
- cache-wallet ambiguity count: `0`

#### Add concurrency tests

At minimum, test:

- two concurrent first-time logins for the same wallet
- two concurrent v2 logins for the same wallet
- Redis flush when user exists
- Redis flush when wallet is missing or ambiguous

#### Smoke test user flows

Test these endpoints:

- legacy login
- v2 login
- update username
- get profile
- answer flow
- session start/end

---

## Phase 8: Production Rollout Order

### Best order

1. Take backups and snapshots
2. Put backend into maintenance mode if possible
3. Run duplicate-user cleanup in Mongo
4. Clear/rebuild Redis user cache and dirty set
5. Deploy code fixes
6. Add wallet unique index
7. Re-run audits
8. Re-open traffic

### Why this order is safest

- cleanup before the unique index avoids index-build failure
- cache clear after cleanup avoids old state leaking back in
- code deploy before reopening traffic reduces chance of reintroducing duplicates immediately

---

## Extra Recommendations

### 1. Add alerting and dashboards

Track:

- duplicate-key errors on Mongo writes
- Redis flush failures
- count of duplicate wallet groups
- count of dirty Redis snapshots skipped

### 2. Add structured identity logs

Every user creation path should log:

- wallet
- whether user was created or reused
- whether the code recovered from duplicate-key conflict
- source path: legacy login or v2 auth

### 3. Keep one identity service

Try not to spread identity rules across many files. Ideally:

- one module owns user creation
- one module owns username generation
- one module owns cache persistence rules

### 4. Add a manual review list for hard merge cases

Some duplicate groups may need human review, especially if:

- both docs have real gameplay progress
- both docs have custom usernames
- both docs have meaningful but conflicting metadata

### 5. Backfill missing gate wallet rows

This is not the main duplicate-user bug, but the earlier investigation showed user/gate consistency gaps. Backfilling these will reduce future confusion.

### 6. Document the recovery runbook

Keep this document updated after the real cleanup so future incidents can be handled quickly.

---

## Suggested Working Session Flow

If you want a simple working order for one cleanup session, use this:

```bash
# 1. Save current investigation state
mkdir -p tmp
node scripts/investigate-user-integrity.mjs --json > tmp/investigate-before.json
node scripts/compare-duplicate-user-docs.mjs --json > tmp/duplicate-compare-before.json

# 2. Backup data
mongodump --uri "$MONGO_URL" --archive="backups/guesstheai-$(date +%Y%m%d-%H%M%S).archive"

# 3. Prepare and review dry-run merge plan
# (use a dedicated merge planner script here)

# 4. Execute Mongo merge
# (use a dedicated merge executor script here)

# 5. Clear risky Redis identity cache
# (provider snapshot or redis-cli / script-based cleanup)

# 6. Re-run audits
node scripts/investigate-user-integrity.mjs --json > tmp/investigate-after.json
node scripts/compare-duplicate-user-docs.mjs --json > tmp/duplicate-compare-after.json
```

---

## Final Advice

If the goal is to "save the backend", do not start with code first.

Start with:

1. backup
2. investigation snapshot
3. duplicate-user merge plan
4. Redis cleanup plan

Then fix the code and add the wallet unique index.

That order gives you the best chance of fixing both:

- the existing damage
- the underlying bug that created it

