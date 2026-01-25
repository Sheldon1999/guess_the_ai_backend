const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || "gta:";
const withPrefix = (suffix = "") => `${REDIS_KEY_PREFIX}${suffix}`;

// Common queue keys
export const READY_QUEUE_KEY = withPrefix("ready:q");

// Reusable builders
export const sessionKey = (wallet) => withPrefix(`session:${wallet}`);

// Doc-cache namespace
const DOC_PREFIX = withPrefix("mongodoc:");
export const DIRTY_USERS_KEY = `${DOC_PREFIX}dirty-users`;
export const docUserKey = (wallet) => `${DOC_PREFIX}user:${wallet}`;
export const docImageKey = (hash) => `${DOC_PREFIX}image:${hash}`;
export const docGateUserKey = (wallet) => `${withPrefix("campaign:GateWallet:")}${wallet}`;

// Presence namespace
const PRESENCE_PREFIX = withPrefix("presence:");
export const presencePendingKey = (wallet, dateKey) => `${PRESENCE_PREFIX}day:${wallet}:${dateKey}:pending`;
export const presenceTotalKey = (wallet, dateKey) => `${PRESENCE_PREFIX}day:${wallet}:${dateKey}:total`;
export const presenceTouchedKey = (wallet) => `${PRESENCE_PREFIX}user:${wallet}:touched`;
export const presenceTouchedScanPattern = `${PRESENCE_PREFIX}user:*:touched`;
export const WARM_LAST_KEY = withPrefix("warm:last");

// TTLs / Durations
export const SESSION_TTL_SEC = Math.max(Number(process.env.GAME_SESSION_TTL_SEC || 3600), 60);
export const PRESENCE_REDIS_TTL_SECONDS = Number(process.env.PRESENCE_REDIS_TTL_SECONDS || 3 * 24 * 3600);

// export function withKeyPrefix(suffix = "") {
//   return withPrefix(suffix);
// }

// export { REDIS_KEY_PREFIX };
