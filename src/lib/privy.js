import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_CLIENT_ID || process.env.PRIVY_APP_ID;
const PRIVY_SECRET = process.env.PRIVY_SECRET_KEY || process.env.PRIVY_APP_SECRET;
const PRIVY_CHAIN_TYPE = process.env.PRIVY_CHAIN_TYPE || "ethereum";
const PRIVY_WALLET_AUTH_KEY =
  process.env.PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY ||
  process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY ||
  "";

const PRIVY_DEBUG = ["1", "true", "yes", "on"].includes(
  String(process.env.PRIVY_DEBUG || "").toLowerCase()
);

let cachedClient = null;
let clientInitAttempted = false;

const maskValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const summarizeConfig = () => ({
  appId: maskValue(PRIVY_APP_ID),
  hasAppId: Boolean(PRIVY_APP_ID),
  hasSecret: Boolean(PRIVY_SECRET),
  chainType: PRIVY_CHAIN_TYPE,
  hasWalletAuthKey: Boolean(PRIVY_WALLET_AUTH_KEY),
  walletAuthKeyPrefix: PRIVY_WALLET_AUTH_KEY ? PRIVY_WALLET_AUTH_KEY.split(":")[0] : "",
});

const normalizeError = (error) => {
  if (!error) return { message: "unknown error" };
  const status = Number(error?.statusCode || error?.status);
  return {
    message: error?.message || String(error),
    status: Number.isNaN(status) ? undefined : status,
    code: error?.code ? String(error.code) : undefined,
    name: error?.name ? String(error.name) : undefined,
  };
};

const logPrivy = (level, stage, data) => {
  if (!PRIVY_DEBUG && level === "debug") return;
  const payload = data || {};
  const prefix = `[privy] ${stage}`;
  if (level === "error") {
    console.error(prefix, payload);
  } else if (level === "warn") {
    console.warn(prefix, payload);
  } else {
    console.log(prefix, payload);
  }
};

logPrivy("debug", "config", summarizeConfig());

const buildClientOptions = () => {
  if (!PRIVY_WALLET_AUTH_KEY) {
    logPrivy("debug", "wallet_auth_missing", {});
    return undefined;
  }
  logPrivy("debug", "wallet_auth_present", {
    walletAuthKeyPrefix: PRIVY_WALLET_AUTH_KEY.split(":")[0],
  });
  return {
    walletApi: {
      authorizationPrivateKey: PRIVY_WALLET_AUTH_KEY,
    },
  };
};

const initClient = () => {
  if (cachedClient) {
    logPrivy("debug", "client_cached", {
      hasWalletApi: Boolean(cachedClient.walletApi),
      hasCreateWallets: typeof cachedClient.createWallets === "function",
    });
    return cachedClient;
  }
  if (clientInitAttempted) {
    logPrivy("debug", "client_init_skipped", { reason: "already_attempted" });
    return null;
  }
  clientInitAttempted = true;

  if (!PRIVY_APP_ID || !PRIVY_SECRET) {
    logPrivy("warn", "client_init_missing_config", {
      hasAppId: Boolean(PRIVY_APP_ID),
      hasSecret: Boolean(PRIVY_SECRET),
    });
    return null;
  }

  try {
    cachedClient = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, buildClientOptions());
    logPrivy("debug", "client_init_success", {
      hasWalletApi: Boolean(cachedClient.walletApi),
      hasCreateWallets: typeof cachedClient.createWallets === "function",
      chainType: PRIVY_CHAIN_TYPE,
    });
    return cachedClient;
  } catch (error) {
    console.error("[privy] client init failed", error);
    logPrivy("debug", "client_init_failed", normalizeError(error));
    return null;
  }
};

const resolveWalletApi = (client) => {
  if (!client) {
    logPrivy("debug", "wallet_api_unavailable", { reason: "no_client" });
    return null;
  }
  const walletApi = client.walletApi || null;
  logPrivy("debug", "wallet_api_resolve", {
    available: Boolean(walletApi),
    hasCreateWallet: Boolean(walletApi && typeof walletApi.createWallet === "function"),
  });
  return walletApi;
};

const fetchPrivyUser = async (client, userId) => {
  if (!client || !userId) return null;
  if (typeof client.getUserById === "function") {
    logPrivy("debug", "user_fetch_start", {
      userId: maskValue(userId),
      method: "getUserById",
    });
    return client.getUserById(userId);
  }
  if (typeof client.getUser === "function") {
    logPrivy("debug", "user_fetch_start", {
      userId: maskValue(userId),
      method: "getUser",
    });
    return client.getUser(userId);
  }
  logPrivy("warn", "user_fetch_unavailable", { userId: maskValue(userId) });
  return null;
};

const findEmbeddedWallet = (user) => {
  const linkedAccounts = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];
  return linkedAccounts.find((acct) => {
    if (!acct || acct.type !== "wallet") return false;
    const chainOk = !PRIVY_CHAIN_TYPE || acct.chainType === PRIVY_CHAIN_TYPE;
    const clientType = String(acct.walletClientType || "").toLowerCase();
    const isEmbedded = clientType === "privy" || clientType === "embedded";
    return Boolean(isEmbedded && chainOk && acct.address);
  });
};

export const isPrivyConfigured = () => Boolean(PRIVY_APP_ID && PRIVY_SECRET);

export async function getWalletById(walletId) {
  if (!walletId) {
    throw new Error("wallet id required");
  }
  logPrivy("debug", "wallet_get_start", { walletId: maskValue(walletId) });
  const client = initClient();
  if (!client) {
    logPrivy("warn", "wallet_get_skipped", {
      reason: "privy_not_configured",
      ...summarizeConfig(),
    });
    return { skipped: true, reason: "privy_not_configured" };
  }

  const walletApi = resolveWalletApi(client);
  if (walletApi && typeof walletApi.getWallet === "function") {
    logPrivy("debug", "wallet_get_call", { walletId: maskValue(walletId) });
    return walletApi.getWallet({ id: walletId });
  }

  logPrivy("warn", "wallet_get_unavailable", {
    reason: "wallet_api_missing",
    ...summarizeConfig(),
  });
  throw new Error("privy wallet get api unavailable");
}

export async function createEmbeddedWalletForUser(userId) {
  if (!userId) {
    throw new Error("privy user id required");
  }
  const client = initClient();
  if (!client) {
    logPrivy("warn", "wallet_create_skipped", {
      reason: "privy_not_configured",
      ...summarizeConfig(),
    });
    return { skipped: true, reason: "privy_not_configured" };
  }

  logPrivy("debug", "wallet_create_start", {
    userId: maskValue(userId),
    hasWalletApi: Boolean(client.walletApi),
    hasCreateWallets: typeof client.createWallets === "function",
    chainType: PRIVY_CHAIN_TYPE,
  });

  // 1) Reuse existing embedded wallet for this user, if available.
  try {
    const user = await fetchPrivyUser(client, userId);
    const existing = findEmbeddedWallet(user);
    if (existing?.address) {
      logPrivy("debug", "wallet_reuse_found", {
        userId: maskValue(userId),
        walletId: maskValue(existing?.id || ""),
        chainType: existing?.chainType,
      });
      return {
        reused: true,
        id: existing?.id || null,
        address: existing.address,
        chainType: existing.chainType,
      };
    }
  } catch (error) {
    console.warn("[privy] failed to fetch user for embedded wallet reuse:", error?.message || error);
    logPrivy("debug", "wallet_reuse_failed", {
      userId: maskValue(userId),
      error: normalizeError(error),
    });
  }

  // 2) Otherwise create a new embedded wallet.
  if (typeof client.createWallets === "function") {
    try {
      logPrivy("debug", "wallet_createwallets_start", {
        userId: maskValue(userId),
        chainType: PRIVY_CHAIN_TYPE,
      });
      const createInput = { userId };
      if (PRIVY_CHAIN_TYPE === "solana") {
        createInput.createSolanaWallet = true;
      } else {
        createInput.createEthereumWallet = true;
      }
      const updatedUser = await client.createWallets(createInput);
      const created = findEmbeddedWallet(updatedUser);
      if (created?.address) {
        logPrivy("debug", "wallet_createwallets_success", {
          userId: maskValue(userId),
          walletId: maskValue(created?.id || ""),
          chainType: created?.chainType,
        });
        return {
          reused: false,
          id: created?.id || null,
          address: created.address,
          chainType: created.chainType,
        };
      }
    } catch (error) {
      console.warn("[privy] failed to create embedded wallet via createWallets:", error?.message || error);
      logPrivy("debug", "wallet_createwallets_failed", {
        userId: maskValue(userId),
        error: normalizeError(error),
      });
    }
  } else {
    logPrivy("debug", "wallet_createwallets_unavailable", {});
  }

  const walletApi = resolveWalletApi(client);
  if (!walletApi || typeof walletApi.createWallet !== "function") {
    logPrivy("warn", "wallet_api_missing", {
      reason: "wallet_api_unavailable",
      hasWalletApi: Boolean(walletApi),
      ...summarizeConfig(),
    });
    throw new Error("privy wallets api unavailable");
  }
  let response;
  try {
    logPrivy("debug", "wallet_api_create_start", {
      userId: maskValue(userId),
      chainType: PRIVY_CHAIN_TYPE,
    });
    response = await walletApi.createWallet({
      chainType: PRIVY_CHAIN_TYPE,
      owner: { userId },
    });
    logPrivy("debug", "wallet_api_create_success", {
      userId: maskValue(userId),
      walletId: maskValue(response?.id || ""),
      chainType: response?.chainType,
    });
  } catch (error) {
    logPrivy("error", "wallet_api_create_failed", {
      userId: maskValue(userId),
      error: normalizeError(error),
    });
    throw error;
  }

  return {
    reused: false,
    id: response?.id,
    address: response?.address,
    chainType: response?.chainType,
  };
}
