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

if (hasBaseConfig) {
  try {
    const account = privateKeyToAccount(
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

async function write(functionName, args, tag, { address, abi }) {
  if (!walletClient || !publicClient) {
    return { skipped: true, reason: "not-configured" };
  }
  if (!address) {
    return { skipped: true, reason: "missing-address" };
  }

  try {
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  } catch (error) {
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

  return write(
    "registerPlayer",
    [walletAddress, username || ""],
    "registerPlayer",
    { address: EVENTS_CONTRACT_ADDRESS, abi: eventsAbi }
  );
}

export async function recordGameStart({ walletAddress, sessionKey }) {
  if (!walletAddress || !sessionKey) {
    return { skipped: true, reason: "missing-params" };
  }

  return write(
    "recordGameStart",
    [walletAddress, sessionKey],
    "recordGameStart",
    { address: EVENTS_CONTRACT_ADDRESS, abi: eventsAbi }
  );
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

  return write(
    "recordGameEnd",
    [
      walletAddress,
      sessionKey,
      Boolean(completed),
      Number(totalCorrect) || 0,
      Number(currentStreak) || 0
    ],
    "recordGameEnd",
    { address: EVENTS_CONTRACT_ADDRESS, abi: eventsAbi }
  );
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

  return write(
    "recordSubmission",
    [walletAddress, sessionKey, questionId, resolvedHash, Boolean(isCorrect)],
    "recordSubmission",
    { address: ANSWER_CONTRACT_ADDRESS, abi: answerAbi }
  );
}

export async function recordSeasonScore({
  seasonId,
  walletAddress,
  totalCorrect
}) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };
  const finalSeasonId =
    seasonId === undefined || seasonId === null ? DEFAULT_SEASON_ID : seasonId;

  return write(
    "setSeasonScore",
    [Number(finalSeasonId), walletAddress, Number(totalCorrect) || 0],
    "setSeasonScore",
    { address: LEADERBOARD_CONTRACT_ADDRESS, abi: leaderboardAbi }
  );
}
