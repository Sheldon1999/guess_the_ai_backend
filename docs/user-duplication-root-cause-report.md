# User Duplication And Redis Flush Incident Report

## Scope

This document explains which parts of the current `guess_the_ai_backend/src` codebase are responsible for:

- duplicate user documents for the same wallet
- unsafe Redis-to-Mongo flush behavior
- the production error:

```text
MongoServerError: E11000 duplicate key error collection: guesstheai.guesstheai_users index: username_1
```

This report is based on the current code only. No source code was changed while preparing it.

## Short Summary

In simple terms:

1. The database does **not** enforce `walletAddress` uniqueness for users.
2. The backend has **two separate user creation flows** that can both create a user for the same wallet at the same time.
3. Redis later flushes cached user snapshots back into Mongo with `upsert: true`, which means Redis can effectively try to create or reshape canonical user rows.
4. `username` is unique, but auto-generated usernames are time-based, so they are also vulnerable to collisions.

Because of that combination, the system can:

- create two Mongo user docs for one wallet
- cache one of those versions in Redis
- later flush Redis state back into Mongo
- fail on the unique `username` index

## Evidence From Investigation

From the investigation runs against the production-parallel setup:

- `112` duplicate user groups were found for the same normalized wallet
- all `112` were created within about `1 second`, which strongly suggests a race condition
- there is a unique index on `username`, but **not** on `walletAddress`
- Redis had many dirty cached user records pointing to duplicated Mongo wallet groups

This means the problem is primarily a **data integrity and concurrency issue**, not mainly a wallet-casing issue.

## What Is Not The Main Root Cause

Wallet normalization exists in the current code.

File: `src/utils/normalize.js`

```js
export function normalizeWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') return null;
  return wallet.trim().toLowerCase();
}
```

File: `src/middleware/login.js`

```js
req.rawWalletAddress = rawWalletAddress;
req.walletAddress = normalizeWallet(rawWalletAddress);
```

### Easy explanation

The code already lowercases wallets before most login flows continue. So the main issue is **not** that wallets are randomly being stored in different cases.

### Theory

Normalization reduces identity fragmentation, but it does not replace a uniqueness guarantee. Even a perfectly normalized wallet can still appear in multiple rows if the database allows duplicates.

---

## 1. Missing Unique Index On `walletAddress`

**Primary responsibility**

File: `src/lib/mongo.js`

Current code:

```js
await gateWallets.createIndex({ walletAddress: 1 }, { unique: true });
await users.createIndex({ username: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
await users.createIndex({ correctAnswers: -1 });
```

### Easy explanation

The backend protects `gateWallets.walletAddress`, but it does **not** protect `users.walletAddress`.

So Mongo is free to store:

- two user docs with the same wallet
- three user docs with the same wallet
- or more

That means the code is relying on application behavior to keep the data clean, but the database is not enforcing the most important rule.

### Why this is dangerous

If the business rule is "one wallet = one user", that rule should be enforced by the database. Otherwise:

- concurrent requests can create duplicates
- later reads become nondeterministic
- updates may hit the wrong copy
- Redis snapshots can no longer safely map back to one canonical row

### Improved code example

This is the kind of schema rule the backend should eventually have after deduplicating existing data:

```js
await users.createIndex({ walletAddress: 1 }, { unique: true });
await users.createIndex(
  { username: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
```

### Improvement needed

- Deduplicate existing users first
- Add a unique index on `users.walletAddress`
- Treat this as the main data integrity fix

---

## 2. Legacy Login Flow Has A Race Condition

**Primary responsibility**

File: `src/services/userService.js`

Current code:

```js
const existingUser = await users.findOne({ walletAddress });

if (!existingUser) {
  const result = await createNewUser({
    walletAddress,
    walletAddressOriginal,
    privyMetaData: shouldStorePrivyMetaData ? privyMetaData : null,
    now
  });
}
```

Current create code:

```js
await users.updateOne(
  { walletAddress },
  { $setOnInsert: setOnInsert, $set: { updatedAt: now } },
  { upsert: true }
);
```

### Easy explanation

This code first checks, "does the user already exist?"

If the answer is "no", it creates the user.

That looks fine in a single request, but it breaks under concurrency:

- Request A checks for the user
- Request B checks for the user
- both see "not found"
- both proceed to create

Since the database does not enforce wallet uniqueness, both requests can win.

### Why this is dangerous

This is a classic **time-of-check / time-of-use** race. The read and the write are separate operations, and there is no hard database constraint protecting them.

### Improved code example

The better pattern is:

1. enforce unique wallet index
2. use a single shared create-or-get function
3. if a duplicate-key error happens, read the existing row and continue

Example:

```js
async function createOrGetUser({ walletAddress, walletAddressOriginal, privyMetaData, now }) {
  const username = generatePlayerUsername();

  try {
    const result = await users.findOneAndUpdate(
      { walletAddress },
      {
        $setOnInsert: {
          walletAddress,
          walletAddressOriginal,
          username,
          correctAnswers: 0,
          currentStreak: 0,
          streak: 0,
          rank: "E",
          dungeonTitle: "Newbie",
          nameUpdated: false,
          createdAt: now,
          lastUpdatedAt: now,
          lastFlushedAt: now,
          ...(privyMetaData ? { privyMetaData } : {})
        },
        $set: { updatedAt: now }
      },
      { upsert: true, returnDocument: "after" }
    );

    return result?.value || result;
  } catch (error) {
    if (error?.code === 11000) {
      return await users.findOne({ walletAddress });
    }
    throw error;
  }
}
```

### Improvement needed

- Remove the separate "find then create" pattern for canonical user creation
- Use one shared atomic creation path
- Let the wallet unique index be the final guard

---

## 3. V2 Login Flow Repeats The Same Problem

**Primary responsibility**

File: `src/services/auth.js`

Current lookup:

```js
if (context.externalWalletAddress) {
  userDoc = await users.findOne({ walletAddress: context.externalWalletAddress });
}

if (!userDoc && context.embeddedWalletAddress) {
  userDoc = await users.findOne({ walletAddress: context.embeddedWalletAddress });
}
```

Current create:

```js
const username = `Player_${Date.now()}`;

const result = await users.updateOne(
  { walletAddress: walletToCreate },
  { $setOnInsert: setOnInsert, $set: { updatedAt: context.now } },
  { upsert: true }
);
```

### Easy explanation

The newer auth flow has the same basic shape:

- check if the user exists
- if not, create one

So even if the older login path were perfect, this newer path could still create duplicates on its own.

### Why this is dangerous

The same invariant is being protected in two different places, and both places are unsafe. That means the bug is duplicated in the architecture, not just in one function.

### Improved code example

Instead of owning a separate create flow here, this path should call the same shared helper:

```js
const userDoc = await createOrGetUser({
  walletAddress: walletToCreate,
  walletAddressOriginal: walletToCreate,
  privyMetaData: privyMetaToStore,
  now: context.now
});
```

### Improvement needed

- Centralize user creation
- Do not let `userService` and `auth` maintain separate creation logic
- Keep one source of truth for identity creation rules

---

## 4. Redis Flush Is The Direct Path Behind The Production Error

**Primary responsibility for the stack trace**

File: `src/lib/docCache.js`

Current code:

```js
const payload = {
  username: snapshot.username,
  correctAnswers: snapshot.correctAnswers,
  currentStreak: snapshot.currentStreak,
  streak: snapshot.streak,
  rank: snapshot.rank,
  dungeonTitle: snapshot.dungeonTitle,
  lastUpdatedAt: snapshot.lastUpdatedAt,
  lastFlushedAt: nowIso(),
  updatedAt: new Date(snapshot.lastUpdatedAt || nowIso()),
};

await users.updateOne(
  { walletAddress: snapshot.walletAddress },
  { $set: payload },
  { upsert: true }
);
```

### Easy explanation

This worker reads a user snapshot from Redis and writes it back into Mongo.

The dangerous part is `upsert: true`.

That means the cache flush is not only updating Mongo. It can also behave like a user creator if Mongo does not match the wallet cleanly.

### Why this is dangerous

This is the part of the system that matches your production error path.

If the snapshot contains a username that already exists elsewhere, or if the wallet state in Mongo is duplicated or missing, the flush worker can attempt a write that violates the unique `username` index.

### Theory

In a cache-aside system, Redis should normally be a performance layer, not an authority for creating canonical entities. Once a cache flush can do `upsert: true` into the main user collection, the cache becomes part of the data integrity boundary. That is much riskier than normal cache usage.

### Improved code example

Safer approach:

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

### Improvement needed

- Do not let Redis flush create canonical users
- Remove `upsert: true` from this path
- If the wallet resolves to 0 or more than 1 Mongo docs, log and skip

---

## 5. Auto-Generated Usernames Are Not Safe Enough

**Secondary but important responsibility**

File: `src/utils/crypto.js`

Current code:

```js
export function generatePlayerUsername() {
  return `Player_${Date.now()}`;
}
```

File: `src/services/auth.js`

```js
const username = `Player_${Date.now()}`;
```

File: `src/lib/docCache.js`

```js
username: doc.username || `Player_${Date.now()}`,
```

### Easy explanation

These usernames depend only on the current millisecond.

If two users are created in the same millisecond, both can get the same generated username.

That is especially risky because the database does enforce `username` uniqueness.

### Why this is dangerous

This creates a second collision surface:

- duplicate wallets are one problem
- duplicate generated usernames are another

Even if wallet handling were fixed, timestamp-only usernames are still fragile under parallel traffic.

### Improved code example

Use a collision-resistant suffix:

```js
import { randomBytes } from "node:crypto";

export function generatePlayerUsername() {
  return `Player_${randomBytes(4).toString("hex")}`;
}
```

Also, the cache layer should avoid inventing a new username when reading/materializing an existing user snapshot:

```js
if (!doc.username) {
  throw new Error("Cannot materialize cached user without username");
}
```

### Improvement needed

- Stop using `Date.now()` as the uniqueness source for usernames
- Do not synthesize persistent usernames inside cache materialization

---

## 6. Once Duplicates Exist, Many Reads And Updates Become Unreliable

Files:

- `src/services/answerHandler.js`
- `src/services/sessionService.js`
- `src/services/eligibilityService.js`
- `src/lib/docCache.js`

Current examples:

```js
const updateResult = await users.findOneAndUpdate(
  { walletAddress },
  [ ... ]
);
```

```js
const userDoc = await users.findOne(
  { walletAddress },
  { projection: { correctAnswers: 1, currentStreak: 1 } }
);
```

```js
const existingUser = await users.findOne(
  { walletAddress },
  { projection: { _id: 1 } }
);
```

### Easy explanation

These code paths assume one wallet matches one user row.

That assumption is fine only if the database guarantees it.

If duplicates already exist, these calls can hit whichever matching row Mongo returns first.

### Why this is dangerous

After corruption enters the system, normal business logic starts making the corruption worse:

- stat updates can hit one duplicate
- reads can come from another duplicate
- cache refreshes can lock onto the wrong duplicate

### Theory

This is a consistency amplification problem. The original bug is in user creation and schema design, but once the data is corrupted, any downstream code that assumes uniqueness becomes nondeterministic.

### Improved code example

During migration/hardening, it is safer to explicitly detect ambiguity:

```js
const matches = await users.find({ walletAddress }).limit(2).toArray();

if (matches.length !== 1) {
  throw new Error(`Ambiguous user identity for wallet ${walletAddress}`);
}

const userDoc = matches[0];
```

### Improvement needed

- After dedupe, the wallet unique index should make these reads safe again
- Before full cleanup, critical paths can defensively detect duplicate matches

---

## 7. Cache-First Behavior Helps Bad State Stay Alive

File: `src/lib/docCache.js`

Current code:

```js
const cached = await readUserFromRedis(normWallet);
if (cached) return cached;
```

### Easy explanation

If Redis already has a user snapshot, the backend returns it first and does not try to heal it from Mongo.

That means if Redis contains a stale or unlucky version of a duplicated user, it can stay in circulation for a long time.

### Why this is dangerous

Cache is supposed to speed up reads. Here, once identity data is corrupted, cache-first behavior helps preserve and spread the corrupted version.

### Improved code example

One safer pattern is:

```js
const cached = await readUserFromRedis(normWallet);
if (cached && cached.username && cached.lastUpdatedAt) {
  return cached;
}

const doc = await users.findOne({ walletAddress: normWallet }, projection);
```

Or, after a known cleanup event:

```js
await redis.del(userKey(normWallet));
await redis.srem(DIRTY_USERS_KEY, normWallet);
```

### Improvement needed

- Rebuild or invalidate user cache after dedupe
- Avoid trusting old identity snapshots blindly after known data problems

---

## Recommended Fix Order

This is the order I recommend.

### 1. Clean existing duplicate users

Why first:

- current data is already inconsistent
- adding a unique wallet index before cleanup will fail

### 2. Add a unique index on `users.walletAddress`

Why second:

- this is the main permanent guard
- it prevents the same class of corruption from coming back

### 3. Replace both creation flows with one shared create-or-get helper

Why third:

- removes duplicate logic
- reduces future drift

### 4. Remove `upsert: true` from the Redis user flush path

Why fourth:

- Redis should not be able to create canonical user rows
- flush should update an already resolved user only

### 5. Replace timestamp usernames with collision-resistant generation

Why fifth:

- this closes the second collision surface

### 6. Rebuild or clear Redis user cache after cleanup

Why sixth:

- old dirty cache entries can reintroduce confusion after Mongo is fixed

---

## Extra Recommendations

These are additional recommendations beyond the direct fixes.

### Add a migration-time safety mode

Temporarily make critical user reads fail loudly if more than one row exists for the same wallet. That is better than silently reading the wrong one.

### Add concurrency tests

Create tests that simulate:

- two concurrent first-time logins for the same wallet
- two concurrent v2 login requests for the same wallet
- Redis flush while duplicate users exist

### Add monitoring around duplicate-key failures

Track:

- `E11000` on `username_1`
- Redis flush failures
- count of duplicate wallet groups
- count of dirty Redis users skipped due to ambiguity

### Add structured logs on identity creation

Log whether the code:

- created a new user
- matched an existing user
- recovered from duplicate-key conflict

That makes future incident analysis much faster.

### Backfill missing gate wallet documents

This is not the main root cause of the duplication issue, but your investigation also showed users without matching gate wallet docs. That should be cleaned up to reduce side inconsistencies.

### Reduce code duplication around identity rules

Today, identity logic is spread across:

- `userService`
- `auth`
- `docCache`
- downstream readers/updaters

User creation, wallet uniqueness, canonical document selection, and cache persistence should be centralized as much as possible.

---

## Final Opinion

The most important point is this:

**The main bug is not Redis. Redis is where the production error becomes visible. The main bug is that user identity is not protected strongly enough in Mongo, and two creation paths are allowed to race.**

Once that happened, Redis flush became unsafe because it was allowed to write cached identity state back into Mongo with `upsert: true`.

If I had to rank the fixes by importance:

1. dedupe users
2. add unique wallet index
3. unify user creation logic
4. harden Redis flush
5. replace timestamp usernames

