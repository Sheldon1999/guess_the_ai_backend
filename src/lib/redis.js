// src/lib/redis
import Redis from "ioredis";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
console.log("[redis] connection: URL: ", redisUrl);
const client = new Redis(redisUrl);
client.on("ready", () => console.log("[redis] connection: successfull"));
client.on("error", (e) => { console.error("[redis] connection: error: ", e); process.exit(1); });
export default client;
