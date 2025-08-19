import Redis from "ioredis";
const client = new Redis(process.env.REDIS_URL);
client.on("ready", () => console.log("redis: ready"));
client.on("error", (e) => { console.error("redis error:", e); process.exit(1); });
export default client;
