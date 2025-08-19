import fs from "fs";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

const OGSOURCE_BASE = process.env.OGSOURCE_BASE;
const READ_MS = Number(process.env.HTTP_READ_TIMEOUT_MS || 15000);
const MAX_BYTES = Number(process.env.HTTP_MAX_CONTENT_BYTES || 5 * 1024 * 1024);

const FETCH_MODE = (process.env.FETCH_MODE || "HTTP").toUpperCase();   // HTTP | CLI
const FETCH_FALLBACK = String(process.env.FETCH_FALLBACK || "true").toLowerCase() === "true";

async function fetchHTTPToBuffer(hash) {
  const url = `${OGSOURCE_BASE}${encodeURIComponent(hash)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_MS);
  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`http fetch failed: ${e.message}`);
  }
  clearTimeout(timer);

  if (!resp || !resp.ok) {
    const code = (resp && resp.status) || "no-response";
    throw new Error(`http upstream not ok: ${code}`);
  }
  const lenHeader = resp.headers?.get ? resp.headers.get("content-length") : null;
  const contentLen = lenHeader ? Number(lenHeader) : 0;
  if (contentLen && contentLen > MAX_BYTES) throw new Error(`http too large: ${contentLen} > ${MAX_BYTES}`);

  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > MAX_BYTES) throw new Error(`http too large after read: ${buf.length} > ${MAX_BYTES}`);
  return buf;
}

async function fetchCLIToFile(hash, destPath) {
  const bin = process.env.OG_CLI_BIN || "0g-storage-client";
  const indexer = process.env.OG_INDEXER_URL || "";
  const args = [
    "download",
    "--indexer", indexer,
    "--root", hash,
    "--file", destPath
  ];
  if (String(process.env.OG_CLI_PROOF || "false").toLowerCase() === "true") args.push("--proof");
  if (process.env.OG_CLI_RPC_RETRY_COUNT) args.push("--rpc-retry-count", String(process.env.OG_CLI_RPC_RETRY_COUNT));
  if (process.env.OG_CLI_RPC_RETRY_INTERVAL) args.push("--rpc-retry-interval", String(process.env.OG_CLI_RPC_RETRY_INTERVAL));
  if (process.env.OG_CLI_RPC_TIMEOUT) args.push("--rpc-timeout", String(process.env.OG_CLI_RPC_TIMEOUT));

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await execFileP(bin, args, {
    timeout: 5 * 60 * 1000,
    maxBuffer: 5 * 1024 * 1024
  }).catch((e) => {
    throw new Error(`cli failed: ${e.message}`);
  });
  await fs.promises.access(destPath, fs.constants.R_OK).catch(() => {
    throw new Error("cli did not produce file");
  });
  return true;
}

export async function fetchToDisk(hash, destPath) {
  try {
    await fs.promises.access(destPath, fs.constants.R_OK);
    return { existed: true, mode: "CACHE" };
  } catch (_) {}

  const tmp = `${destPath}.part`;
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  const tryHTTP = async () => {
    const buf = await fetchHTTPToBuffer(hash);
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, destPath);
    return { existed: false, mode: "HTTP" };
  };
  const tryCLI = async () => {
    await fetchCLIToFile(hash, tmp);
    await fs.promises.rename(tmp, destPath);
    return { existed: false, mode: "CLI" };
  };

  if (FETCH_MODE === "HTTP") {
    try {
      return await tryHTTP();
    } catch (e) {
      if (!FETCH_FALLBACK) throw e;
      try {
        return await tryCLI();
      } catch (e2) {
        throw new Error(`${e.message} | fallback:${e2.message}`);
      }
    }
  } else {
    try {
      return await tryCLI();
    } catch (e) {
      if (!FETCH_FALLBACK) throw e;
      try {
        return await tryHTTP();
      } catch (e2) {
        throw new Error(`${e.message} | fallback:${e2.message}`);
      }
    }
  }
}
