import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_CLIENT_ID || process.env.PRIVY_APP_ID;
const PRIVY_SECRET = process.env.PRIVY_SECRET_KEY || process.env.PRIVY_APP_SECRET;
const PRIVY_CHAIN_TYPE = process.env.PRIVY_CHAIN_TYPE || "ethereum";

let cachedClient = null;
let clientInitAttempted = false;

const initClient = () => {
  if (cachedClient) return cachedClient;
  if (clientInitAttempted) return null;
  clientInitAttempted = true;

  if (!PRIVY_APP_ID || !PRIVY_SECRET) return null;

  try {
    cachedClient = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET);
    return cachedClient;
  } catch (error) {
    try {
      cachedClient = new PrivyClient({
        appId: PRIVY_APP_ID,
        appSecret: PRIVY_SECRET,
      });
      return cachedClient;
    } catch (innerError) {
      console.error("[privy] client init failed", innerError);
      return null;
    }
  }
};

const resolveWalletsApi = async (client) => {
  if (!client) return null;
  const walletsApi = typeof client.wallets === "function" ? client.wallets() : client.wallets;
  if (!walletsApi) return null;
  if (typeof walletsApi.then === "function") {
    return walletsApi;
  }
  return walletsApi;
};

const resolveWalletApi = (client) => {
  if (!client) return null;
  return client.walletApi || null;
};

export const isPrivyConfigured = () => Boolean(PRIVY_APP_ID && PRIVY_SECRET);

export async function getWalletById(walletId) {
  if (!walletId) {
    throw new Error("wallet id required");
  }
  const client = initClient();
  if (!client) {
    return { skipped: true, reason: "privy_not_configured" };
  }

  const walletApi = resolveWalletApi(client);
  if (walletApi && typeof walletApi.getWallet === "function") {
    return walletApi.getWallet({ id: walletId });
  }

  const walletsApi = await resolveWalletsApi(client);
  if (walletsApi && typeof walletsApi.getWallet === "function") {
    return walletsApi.getWallet({ id: walletId });
  }

  throw new Error("privy wallet get api unavailable");
}

export async function createEmbeddedWalletForUser(userId) {
  if (!userId) {
    throw new Error("privy user id required");
  }
  const client = initClient();
  if (!client) {
    return { skipped: true, reason: "privy_not_configured" };
  }

  // 1) Reuse existing embedded wallet for this user, if available.
  try {
    const usersApi = typeof client.users === "function" ? client.users() : client.users;
    const getFn = usersApi && (
      typeof usersApi._get === "function"
        ? usersApi._get.bind(usersApi)
        : typeof usersApi.get === "function"
          ? usersApi.get.bind(usersApi)
          : null
    );

    if (getFn) {
      const user = await getFn(userId);
      const linkedAccounts = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];

      const existing = linkedAccounts.find((acct) => {
        if (!acct || acct.type !== "wallet") return false;
        const chainOk = !PRIVY_CHAIN_TYPE || acct.chainType === PRIVY_CHAIN_TYPE;
        const isEmbedded = acct.walletClientType === "privy";
        return Boolean(isEmbedded && chainOk && acct.address);
      });

      if (existing?.address) {
        return {
          reused: true,
          id: existing?.id || null,
          address: existing.address,
          chainType: existing.chainType,
        };
      }
    }
  } catch (error) {
    console.warn("[privy] failed to fetch user for embedded wallet reuse:", error?.message || error);
  }

  // 2) Otherwise create a new embedded wallet.
  const walletsApi = await resolveWalletsApi(client);
  if (!walletsApi || typeof walletsApi.create !== "function") {
    throw new Error("privy wallets api unavailable");
  }

  const response = await walletsApi.create({
    chain_type: PRIVY_CHAIN_TYPE,
    owner: { user_id: userId },
  });

  return {
    reused: false,
    id: response?.id,
    address: response?.address,
    chainType: response?.chain_type,
  };
}
