import { createPublicClient, createWalletClient, http, isHex, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const abi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "abi", "GuessTheAIEvents.json"), "utf8")
);

const RPC_URL = process.env.ONCHAIN_RPC_URL;
const PRIVATE_KEY = process.env.ONCHAIN_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.ONCHAIN_CONTRACT_ADDRESS;

const CHAIN_ID = Number(process.env.ONCHAIN_CHAIN_ID || "16601");
const CHAIN_NAME = process.env.ONCHAIN_CHAIN_NAME || "0G Galileo Testnet";
const CHAIN_SYMBOL = process.env.ONCHAIN_CHAIN_CURRENCY || "OG";
const CHAIN_DECIMALS = Number(process.env.ONCHAIN_CHAIN_DECIMALS || 18);

const isConfigured = Boolean(RPC_URL && PRIVATE_KEY && CONTRACT_ADDRESS);

let walletClient = null;
let publicClient = null;

if (isConfigured) {
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

async function write(functionName, args, tag) {
  if (!walletClient || !publicClient) {
    return { skipped: true, reason: "not-configured" };
  }

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
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

export const isOnchainEnabled = () => Boolean(walletClient && publicClient);

export async function recordUserRegistration({ walletAddress, username }) {
  if (!walletAddress) return { skipped: true, reason: "wallet-required" };

  return write(
    "registerPlayer",
    [walletAddress, username || ""],
    "registerPlayer"
  );
}

export async function recordGameStart({ walletAddress, sessionKey }) {
  if (!walletAddress || !sessionKey) {
    return { skipped: true, reason: "missing-params" };
  }

  return write(
    "recordGameStart",
    [walletAddress, sessionKey],
    "recordGameStart"
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
    "recordGameEnd"
  );
}
