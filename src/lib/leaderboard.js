import redis from "./redis.js";
import { users } from "./mongo.js";

export function currentWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const year = date.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function bumpAllTime(wallet, delta = 1) {
  return redis.zincrby("lb:alltime", delta, wallet);
}

export async function bumpWeekly(wallet, delta = 1, when = new Date()) {
  const key = `lb:week:${currentWeekKey(when)}`;
  return redis.zincrby(key, delta, wallet);
}

async function hydrateUsers(wallets) {
  if (!wallets.length) return [];
  const docs = await users.find(
    { walletAddress: { $in: wallets } }, 
    { 
      projection: { 
        walletAddress: 1, 
        username: 1, 
        rank: 1, 
        dungeonTitle: 1, 
        correctAnswers: 1, 
        streak: 1 
      } 
    }
  ).toArray();
  const map = new Map(docs.map(d => [d.walletAddress, d]));
  return wallets.map(w => ({
    walletAddress: w,
    username: map.get(w)?.username || w.slice(0, 8),
    rank: map.get(w)?.rank || "E",
    dungeonTitle: map.get(w)?.dungeonTitle || "Newbie",
    correctAnswers: map.get(w)?.correctAnswers || 0,
    streak: map.get(w)?.streak || 0
  }));
}

export async function topAllTime(limit = 50, offset = 0) {

    try {
      const leaderboard = await users.find().sort({ correctAnswers: -1 }).limit(limit).skip(offset).toArray();
      return ({success:true,leaderboard});
    }
    catch(error) {
      return ({
        success: false,
        message: 'Something went wrong'
    })
    }
}

export async function topWeekly(weekKey, limit = 50, offset = 0) {
  const key = `lb:week:${weekKey}`;
  const raw = await redis.zrevrange(key, offset, offset + limit - 1, "WITHSCORES");
  const wallets = []; const scores = [];
  for (let i = 0; i < raw.length; i += 2) { wallets.push(raw[i]); scores.push(Number(raw[i + 1])); }
  const entries = await hydrateUsers(wallets);
  return entries.map((e, i) => ({ ...e, score: scores[i] || 0, rankPos: offset + i + 1 }));
}
