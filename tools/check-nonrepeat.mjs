// tools/check-nonrepeat.mjs
// Simulate multiple users hitting /game/next and verify:
// 1) No per-user repeats
// 2) No global repeats across users during the test window
//
// Usage examples:
//   node tools/check-nonrepeat.mjs
//   BASE=http://localhost:3000 USERS=10 ROUNDS=50 CONCURRENT=true node tools/check-nonrepeat.mjs
//
// Env vars:
//   BASE=http://localhost:3000
//   USERS=5                     # number of test users
//   ROUNDS=40                   # times each user asks for next image
//   CONCURRENT=true|false       # if true, each round fires all users at once
//   PAUSE_MS=50                 # delay between rounds (ms) when not concurrent
//   ANSWER=false                # if true, also POST /game/answer with random guess
//   WALLET_PREFIX=0x11111111111111111111111111111111111111  # base; index appended as hex nibble

const BASE = process.env.BASE || "http://localhost:3000";
const USERS = Number(process.env.USERS || 5);
const ROUNDS = Number(process.env.ROUNDS || 40);
const CONCURRENT = String(process.env.CONCURRENT || "false").toLowerCase() === "true";
const PAUSE_MS = Number(process.env.PAUSE_MS || 50);
const ANSWER = String(process.env.ANSWER || "false").toLowerCase() === "true";
const WALLET_PREFIX = process.env.WALLET_PREFIX || "0x111111111111111111111111111111111111110";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mkWallet(i) {
  // Make deterministic test wallets by changing the last hex nibble
  // WALLET_PREFIX should be 41 chars incl "0x" + 39 hex so we can append one nibble.
  // If not, just fall back to u<i> style addresses (still hex-like).
  let w = `${WALLET_PREFIX}${(i % 16).toString(16)}`;
  if (!/^0x[0-9a-z]{40}$/i.test(w)) {
    const pad = String(i).padStart(38, "0");
    w = `0x${pad}aa`; // valid hex of 40 chars
  }
  return w.toLowerCase();
}

// function extractPayload(json) {
//   // backend may return {success:true,data:{...}} or raw object
//   if (json && typeof json === "object") {
//     if ("success" in json && "data" in json) return json.data;
//     return json;
//   }
//   return null;
// }

async function postJSON(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });

  // Read raw text first; try JSON only if present
  let text = "";
  try { text = await res.text(); } catch {}

  let json = null;
  if (text && text.trim().length) {
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  }

  return { ok: res.ok, status: res.status, json, text };
}

function extractPayload(json) {
  if (!json || typeof json !== "object") return null;
  if ("success" in json && "data" in json) return json.success ? json.data : null;
  return json;
}

async function getNext(walletAddress) {
  const r = await postJSON("/game/next", { walletAddress });

  // Treat 204 as “empty pool”
  if (r.status === 204) {
    return { ok: false, error: "no eligible image (204)", data: null };
  }

  if (!r.ok) {
    const msg = r.json?.message || `HTTP ${r.status}`;
    return { ok: false, error: msg, data: r.json ?? r.text };
  }

  const payload = extractPayload(r.json);
  if (payload?.hash) return { ok: true, data: payload };

  const msg = r.json?.message || "no hash in payload";
  return { ok: false, error: msg, data: r.json ?? r.text };
}


async function answerGuess(walletAddress, current) {
  const guess = Math.random() < 0.5 ? "ai" : "human";
  const body = { walletAddress, imageId: current.imageId, hash: current.hash, guess };
  const r = await postJSON("/game/answer", body);
  return r;
}

(async () => {
  // Prepare users
  const users = Array.from({ length: USERS }, (_, i) => ({
    id: `u${i + 1}`,
    wallet: mkWallet(i + 1),
    seen: new Set(), // per-user seen hashes
    pulls: 0
  }));

  // Global tracking (to catch cross-user repeats)
  const globalOwner = new Map(); // hash -> { userId, round }
  const globalSeen = new Set();  // set of all hashes assigned during the test

  // Stats
  let totalPulls = 0;
  let perUserRepeats = 0;
  let globalRepeats = 0;

  const perUserViolations = [];  // {userId, wallet, round, hash}
  const globalViolations = [];   // {userId, prevUserId, round, prevRound, hash}

  console.log(`BASE=${BASE} | USERS=${USERS} | ROUNDS=${ROUNDS} | CONCURRENT=${CONCURRENT} | ANSWER=${ANSWER}`);
  console.log(`Starting simulation…`);

  for (let round = 1; round <= ROUNDS; round++) {
    if (CONCURRENT) {
      // Fire all users in parallel for this round
      const results = await Promise.all(users.map(async (u) => {
        const r = await getNext(u.wallet);
        return { u, r };
      }));

      for (const { u, r } of results) {
        if (!r.ok) {
          console.warn(`[round ${round}] ${u.id} error: ${r.error}`);
          continue;
        }
        const { hash } = r.data;

        // Per-user repeat?
        if (u.seen.has(hash)) {
          perUserRepeats++;
          perUserViolations.push({ userId: u.id, wallet: u.wallet, round, hash });
        } else {
          u.seen.add(hash);
        }

        // Global repeat across different users?
        if (globalSeen.has(hash)) {
          const prev = globalOwner.get(hash);
          if (prev && prev.userId !== u.id) {
            globalRepeats++;
            globalViolations.push({
              userId: u.id, prevUserId: prev.userId,
              round, prevRound: prev.round, hash
            });
          }
        } else {
          globalSeen.add(hash);
          globalOwner.set(hash, { userId: u.id, round });
        }

        u.pulls++;
        totalPulls++;

        if (ANSWER) {
          try { await answerGuess(u.wallet, r.data); } catch {}
        }
      }
    } else {
      // Serial round-robin (less racey, still validates rules)
      for (const u of users) {
        const r = await getNext(u.wallet);
        if (!r.ok) {
          console.warn(`[round ${round}] ${u.id} error: ${r.error}`);
          continue;
        }
        const { hash } = r.data;

        if (u.seen.has(hash)) {
          perUserRepeats++;
          perUserViolations.push({ userId: u.id, wallet: u.wallet, round, hash });
        } else {
          u.seen.add(hash);
        }

        if (globalSeen.has(hash)) {
          const prev = globalOwner.get(hash);
          if (prev && prev.userId !== u.id) {
            globalRepeats++;
            globalViolations.push({
              userId: u.id, prevUserId: prev.userId,
              round, prevRound: prev.round, hash
            });
          }
        } else {
          globalSeen.add(hash);
          globalOwner.set(hash, { userId: u.id, round });
        }

        u.pulls++;
        totalPulls++;

        if (ANSWER) {
          try { await answerGuess(u.wallet, r.data); } catch {}
        }
      }
      if (PAUSE_MS > 0) await sleep(PAUSE_MS);
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total pulls: ${totalPulls}`);
  console.log(`Users: ${USERS} | Rounds per user: ${ROUNDS}`);
  console.log(`Per-user repeats: ${perUserRepeats}`);
  console.log(`Global repeats (across users): ${globalRepeats}`);

  console.log("\nPer-user repeat violations:");
  if (perUserViolations.length === 0) {
    console.log("  none ✅");
  } else {
    for (const v of perUserViolations.slice(0, 20)) {
      console.log(`  [round ${v.round}] ${v.userId} (${v.wallet}) got duplicate hash ${v.hash}`);
    }
    if (perUserViolations.length > 20) console.log(`  ...and ${perUserViolations.length - 20} more`);
  }

  console.log("\nGlobal repeat violations (two different users got the same hash):");
  if (globalViolations.length === 0) {
    console.log("  none ✅");
  } else {
    for (const v of globalViolations.slice(0, 20)) {
      console.log(`  [round ${v.round}] ${v.userId} got ${v.hash} previously given to ${v.prevUserId} at round ${v.prevRound}`);
    }
    if (globalViolations.length > 20) console.log(`  ...and ${globalViolations.length - 20} more`);
  }

  // Exit non-zero if violations found (optional)
  if (perUserRepeats > 0 || globalRepeats > 0) process.exit(2);
})();
