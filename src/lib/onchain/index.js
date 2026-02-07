import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  keccak256,
  stringToBytes
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const eventsAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "abi", "GuessTheAIEvents.json"), "utf8")
);
const answerAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "abi", "AnswerSubmissions.json"), "utf8")
);
const leaderboardAbi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "abi", "Leaderboard.json"), "utf8")
);

const RPC_URL = process.env.ONCHAIN_RPC_URL;
const PRIVATE_KEY = process.env.ONCHAIN_PRIVATE_KEY;
const EVENTS_CONTRACT_ADDRESS = process.env.ONCHAIN_CONTRACT_ADDRESS;
const ANSWER_CONTRACT_ADDRESS = process.env.ONCHAIN_ANSWER_CONTRACT_ADDRESS;
const LEADERBOARD_CONTRACT_ADDRESS = process.env.ONCHAIN_LEADERBOARD_CONTRACT_ADDRESS;
const DEFAULT_SEASON_ID = Number(process.env.ONCHAIN_SEASON_ID || "1");

const CHAIN_ID = Number(process.env.ONCHAIN_CHAIN_ID || "16601");
const CHAIN_NAME = process.env.ONCHAIN_CHAIN_NAME || "0G Galileo Testnet";
const CHAIN_SYMBOL = process.env.ONCHAIN_CHAIN_CURRENCY || "OG";
const CHAIN_DECIMALS = Number(process.env.ONCHAIN_CHAIN_DECIMALS || 18);

const hasBaseConfig = Boolean(RPC_URL && PRIVATE_KEY);

let walletClient = null;
let publicClient = null;
let account = null;

if (hasBaseConfig) {
  try {
    account = privateKeyToAccount(
      PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`
    );

    const chain = {
      id: CHAIN_ID,
      name: CHAIN_NAME,
      network: CHAIN_NAME.toLowerCase().replace(/\s+/g, "-"),
      nativeCurrency: {
        name: CHAIN_SYMBOL,
        symbol: CHAIN_SYMBOL,
        decimals: CHAIN_DECIMALS
      },
      rpcUrls: {
        default: { http: [RPC_URL] },
        public: { http: [RPC_URL] }
      }
    };

    walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL)
    });

    publicClient = createPublicClient({
      chain,
      transport: http(RPC_URL)
    });
  } catch (error) {
    console.error("[onchain] failed to initialise wallet client:", error);
  }
} else {
  console.warn("[onchain] configuration incomplete, skipping blockchain writes");
}

// Derive a slightly boosted fee set to reduce replacement/underpriced errors
async function getFeeBump(multiplier = 1.2) {
  if (!publicClient) return {};
  try {
    const fee = await publicClient.estimateFeesPerGas();
    const bump = (value) =>
      value !== undefined ? BigInt(Math.ceil(Number(value) * multiplier)) : undefined;
    return {
      maxFeePerGas: bump(fee.maxFeePerGas),
      maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas)
    };
  } catch {
    return {};
  }
}

/**
 * Write to blockchain contract
 * @param {Object} options - Write options
 * @param {string} options.functionName - Contract function name
 * @param {Array} options.args - Function arguments
 * @param {string} options.tag - Logging tag
 * @param {string} options.address - Contract address
 * @param {Array} options.abi - Contract ABI
 * @returns {Promise<Object>} Transaction result
 */
async function write({ functionName, args, tag, address, abi }) {
  if (!walletClient || !publicClient) {
    return { skipped: true, reason: "not-configured" };
  }
  if (!address) {
    return { skipped: true, reason: "missing-address" };
  }

  // Helper to send with optional nonce/fee bump
  const sendWith = async (opts = {}) =>
    walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      ...opts
    });

  try {
    const feeBump = await getFeeBump(1.25);
    const hash = await sendWith(feeBump);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000, // 5 minutes to account for slower finality
      pollingInterval: 4_000
    });
    return { hash, receipt };
  } catch (error) {
    // Handle common gas replacement / nonce race by retrying once with higher fee & explicit nonce
    const msg = error?.shortMessage || error?.message || "";
    const isUnderpriced =
      msg.includes("replacement transaction underpriced") ||
      msg.includes("fee too low") ||
      msg.includes("invalid parameters");

    if (isUnderpriced && account) {
      try {
        const nonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending"
        });
        const feeBump = await getFeeBump(1.35);
        const hash = await sendWith({ nonce, ...feeBump });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 300_000,
          pollingInterval: 4_000
        });
        return { hash, receipt, retried: true };
      } catch (retryError) {
        console.error(`[onchain] ${tag} retry failed`, retryError);
        return { error: retryError };
      }
    }

    // If receipt not found yet, surface hash so caller can poll later
    if ((error?.shortMessage || "").includes("could not be found")) {
      console.warn(`[onchain] ${tag} pending; receipt not found yet`, {
        message: error.shortMessage,
        hash: error?.transactionHash
      });
      return { pending: true, hash: error?.transactionHash };
    }

    console.error(`[onchain] ${tag} failed`, error);
    return { error };
  }
}

/**
 * Submit a transaction and return the hash without waiting for a receipt.
 * @param {Object} options - Write options
 * @returns {Promise<Object>} Transaction hash result
 */
async function writeNoWait({ functionName, args, tag, address, abi }) {
  if (!walletClient || !publicClient) {
    return { skipped: true, reason: "not-configured" };
  }
  if (!address) {
    return { skipped: true, reason: "missing-address" };
  }

  const sendWith = async (opts = {}) =>
    walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      ...opts
    });

  try {
    const feeBump = await getFeeBump(1.25);
    const hash = await sendWith(feeBump);
    return { hash };
  } catch (error) {
    const msg = error?.shortMessage || error?.message || "";
    const isUnderpriced =
      msg.includes("replacement transaction underpriced") ||
      msg.includes("fee too low") ||
      msg.includes("invalid parameters");

    if (isUnderpriced && account) {
      try {
        const nonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending"
        });
        const feeBump = await getFeeBump(1.35);
        const hash = await sendWith({ nonce, ...feeBump });
        return { hash, retried: true };
      } catch (retryError) {
        console.error(`[onchain] ${tag} retry failed`, retryError);
        return { error: retryError };
      }
    }

    console.error(`[onchain] ${tag} failed`, error);
    return { error };
  }
}

export function deriveSessionKey(sessionId) {
  if (!sessionId) throw new Error("session id required");
  if (isHex(sessionId)) {
    if (sessionId.length === 66) {
      return sessionId.toLowerCase();
    }
    return keccak256(stringToBytes(sessionId));
  }
  return keccak256(stringToBytes(sessionId));
}

// export const isOnchainEnabled = () => Boolean(walletClient && publicClient);

export async function recordUserRegistration({ walletAddress, username }) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };

  return write({
    functionName: "registerPlayer",
    args: [walletAddress, username || ""],
    tag: "registerPlayer",
    address: EVENTS_CONTRACT_ADDRESS,
    abi: eventsAbi
  });
}

export async function recordGameStart({ walletAddress, sessionKey }) {
  if (!walletAddress || !sessionKey) {
    return { skipped: true, reason: "missing-params" };
  }

  return write({
    functionName: "recordGameStart",
    args: [walletAddress, sessionKey],
    tag: "recordGameStart",
    address: EVENTS_CONTRACT_ADDRESS,
    abi: eventsAbi
  });
}

export async function recordGameEnd({
  walletAddress,
  sessionKey,
  completed,
  totalCorrect,
  currentStreak
}) {
  if (!walletAddress || !sessionKey) {
    return { skipped: true, reason: "missing-params" };
  }

  return write({
    functionName: "recordGameEnd",
    args: [
      walletAddress,
      sessionKey,
      Boolean(completed),
      Number(totalCorrect) || 0,
      Number(currentStreak) || 0
    ],
    tag: "recordGameEnd",
    address: EVENTS_CONTRACT_ADDRESS,
    abi: eventsAbi
  });
}

export async function recordAnswerSubmission({
  walletAddress,
  sessionKey,
  questionId,
  answer,
  answerHash,
  isCorrect
}) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };
  if (!sessionKey) return { skipped: true, reason: "session-required" };
  if (questionId === undefined || questionId === null) {
    return { skipped: true, reason: "question-required" };
  }

  const resolvedHash =
    answerHash ||
    (answer ? keccak256(stringToBytes(String(answer))) : undefined);
  if (!resolvedHash) {
    return { skipped: true, reason: "answer-required" };
  }

  return write({
    functionName: "recordSubmission",
    args: [walletAddress, sessionKey, questionId, resolvedHash, Boolean(isCorrect)],
    tag: "recordSubmission",
    address: ANSWER_CONTRACT_ADDRESS,
    abi: answerAbi
  });
}

export async function recordAnswerSubmissionHash({
  walletAddress,
  sessionKey,
  questionId,
  answer,
  answerHash,
  isCorrect
}) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };
  if (!sessionKey) return { skipped: true, reason: "session-required" };
  if (questionId === undefined || questionId === null) {
    return { skipped: true, reason: "question-required" };
  }

  const resolvedHash =
    answerHash ||
    (answer ? keccak256(stringToBytes(String(answer))) : undefined);
  if (!resolvedHash) {
    return { skipped: true, reason: "answer-required" };
  }

  return writeNoWait({
    functionName: "recordSubmission",
    args: [walletAddress, sessionKey, questionId, resolvedHash, Boolean(isCorrect)],
    tag: "recordSubmission",
    address: ANSWER_CONTRACT_ADDRESS,
    abi: answerAbi
  });
}

export async function recordSeasonScore({
  seasonId,
  walletAddress,
  totalCorrect
}) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };
  const finalSeasonId =
    seasonId === undefined || seasonId === null ? DEFAULT_SEASON_ID : seasonId;

  return write({
    functionName: "setSeasonScore",
    args: [Number(finalSeasonId), walletAddress, Number(totalCorrect) || 0],
    tag: "setSeasonScore",
    address: LEADERBOARD_CONTRACT_ADDRESS,
    abi: leaderboardAbi
  });
}
