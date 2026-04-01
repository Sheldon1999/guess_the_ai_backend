/**
 * 0G Compute Network — Inference Client
 *
 * Lazily initialises the broker on first call, discovers the provider
 * for `ZG_CHAT_MODEL`, and exposes a simple `chatCompletion()` helper.
 *
 * ENV:
 *   ZG_PRIVATE_KEY         – wallet private key (required for 0G payments)
 *   ZG_RPC_URL             – RPC endpoint (default: https://evmrpc.0g.ai)
 *   ZG_CHAT_MODEL          – model name (default: deepseek-chat-v3-0324)
 *   ZG_REQUEST_TIMEOUT_MS  – per-request timeout (default: 15 000)
 *   ZG_MAX_RETRIES         – retry count on failure (default: 3)
 */

import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const DEFAULT_RPC_URL = 'https://evmrpc.0g.ai';
const DEFAULT_MODEL = 'deepseek-chat-v3-0324';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;

// Module-scoped singleton — initialised once
let _initPromise = null;
let _broker = null;
let _endpoint = '';
let _model = '';
let _providerAddress = '';

function env(key, fallback = '') {
  return (process.env[key] || '').trim() || fallback;
}

function normalizeModelName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^openai\//, '')
    .replace(/^qwen\//, '')
    .replace(/^deepseek\//, '')
    .replace(/^zai-org\//, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function init() {
  const privateKey = env('ZG_PRIVATE_KEY');
  if (!privateKey) {
    throw new Error('[zgInference] ZG_PRIVATE_KEY is not set — 0G hint generation disabled');
  }

  const rpcUrl = env('ZG_RPC_URL', DEFAULT_RPC_URL);
  const requestedModel = env('ZG_CHAT_MODEL', DEFAULT_MODEL);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  // Discover provider for the requested model
  const services = await broker.inference.listService();
  const requestedNormalized = normalizeModelName(requestedModel);

  const service = services.find((entry) => {
    const model = entry?.model;
    return model === requestedModel || normalizeModelName(model) === requestedNormalized;
  });

  if (!service) {
    const available = services.map((s) => s?.model).filter(Boolean).join(', ');
    throw new Error(
      `[zgInference] model "${requestedModel}" not found. Available: ${available}`
    );
  }

  const providerAddress =
    service.providerAddress ||
    service.provider ||
    service.address ||
    service.serviceProvider;

  if (!providerAddress) {
    throw new Error(`[zgInference] could not resolve provider address for "${requestedModel}"`);
  }

  const metadata = await broker.inference.getServiceMetadata(providerAddress);

  if (!metadata?.endpoint) {
    throw new Error(`[zgInference] service metadata returned no endpoint for "${requestedModel}"`);
  }

  _broker = broker;
  _endpoint = metadata.endpoint.replace(/\/+$/, '');
  _model = metadata.model || service.model || requestedModel;
  _providerAddress = providerAddress;

  console.log(
    `[zgInference] ready model=${_model} provider=${_providerAddress} endpoint=${_endpoint}`
  );
}

function ensureReady() {
  if (!_initPromise) {
    _initPromise = init().catch((err) => {
      console.error('[zgInference] init failed:', err.message);
      // Allow re-initialisation on next call
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Call 0G chat completion.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {object} [opts]
 * @param {number} [opts.temperature=0.4]
 * @param {number} [opts.maxTokens=120]
 * @returns {Promise<string>} The assistant's plain-text response
 */
export async function chatCompletion(messages, opts = {}) {
  await ensureReady();

  const defaultTimeout = Number(env('ZG_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const timeoutMs = opts.timeoutMs ?? defaultTimeout;
  const maxRetries = Number(env('ZG_MAX_RETRIES', DEFAULT_MAX_RETRIES));
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 120;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const userContent = messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');

      const headers = await _broker.inference.getRequestHeaders(
        _providerAddress,
        userContent
      );

      const response = await fetch(`${_endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          model: _model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`0G ${response.status}: ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;

      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }

      // Handle array content (some models return structured content)
      if (Array.isArray(content)) {
        const text = content
          .map((item) => (typeof item === 'string' ? item : item?.text || ''))
          .join('\n')
          .trim();
        if (text) return text;
      }

      throw new Error('0G returned empty content');
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(
        `[zgInference] attempt ${attempt}/${maxRetries} failed: ${err.message}`
      );
      await sleep(1500 * attempt);
    }
  }

  throw new Error('[zgInference] exhausted retries');
}

/**
 * Check whether 0G inference is configured (env vars present).
 * Does NOT guarantee the service is reachable.
 */
export function isConfigured() {
  return Boolean(env('ZG_PRIVATE_KEY'));
}

/**
 * Fire a blind request to 0G inference.
 * Sends the HTTP request so 0G logs the usage, but does NOT wait for
 * the response body, does NOT retry, and does NOT log any errors.
 */
export function fireBlindPing(messages) {
  if (!isConfigured()) return;

  // Ensure broker is initialized, then fire the single request
  ensureReady()
    .then(async () => {
      const userContent = messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');

      const headers = await _broker.inference.getRequestHeaders(
        _providerAddress,
        userContent
      );

      // Raw single fetch. No response body parsing, no retries, no logs.
      fetch(`${_endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          model: _model,
          messages,
          temperature: 0.4,
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(5000), // Drop connection after 5s regardless
      }).catch(() => {}); // silently gobble network errors
    })
    .catch(() => {}); // silently gobble intitialization errors
}
