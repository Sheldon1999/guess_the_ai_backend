/**
 * Cloudflare Workers AI — Inference Client
 *
 * Drop-in replacement for zgInference.js.
 * Calls the Cloudflare REST API (OpenAI-compatible /v1/chat/completions).
 *
 * ENV:
 *   CF_ACCOUNT_ID        – Cloudflare Account ID (required)
 *   CF_API_TOKEN          – Workers AI API token (required)
 *   CF_CHAT_MODEL         – model identifier (default: @cf/meta/llama-3.1-8b-instruct-fast)
 *   CF_REQUEST_TIMEOUT_MS – per-request timeout (default: 15 000)
 *   CF_MAX_RETRIES        – retry count on transient failure (default: 2)
 */

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

function env(key, fallback = '') {
  return (process.env[key] || '').trim() || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Cloudflare Workers AI chat completion (OpenAI-compatible endpoint).
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {object} [opts]
 * @param {number} [opts.temperature=0.4]
 * @param {number} [opts.maxTokens=120]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} The assistant's plain-text response
 */
export async function chatCompletion(messages, opts = {}) {
  const accountId = env('CF_ACCOUNT_ID');
  const apiToken = env('CF_API_TOKEN');

  if (!accountId || !apiToken) {
    throw new Error('[cfInference] CF_ACCOUNT_ID and CF_API_TOKEN are required');
  }

  const model = env('CF_CHAT_MODEL', DEFAULT_MODEL);
  const defaultTimeout = Number(env('CF_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const timeoutMs = opts.timeoutMs ?? defaultTimeout;
  const maxRetries = Number(env('CF_MAX_RETRIES', DEFAULT_MAX_RETRIES));
  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 120;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`CF ${response.status}: ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();

      // OpenAI-compatible response shape
      const content = data?.choices?.[0]?.message?.content;

      if (typeof content === 'string' && content.trim()) {
        return content.trim();
      }

      // Fallback: Cloudflare native response shape
      if (data?.result?.response) {
        return String(data.result.response).trim();
      }

      throw new Error('CF returned empty content');
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(
        `[cfInference] attempt ${attempt}/${maxRetries} failed: ${err.message}`
      );
      await sleep(1000 * attempt);
    }
  }

  throw new Error('[cfInference] exhausted retries');
}

/**
 * Check whether Cloudflare Workers AI is configured (env vars present).
 * Does NOT guarantee the service is reachable.
 */
export function isConfigured() {
  return Boolean(env('CF_ACCOUNT_ID')) && Boolean(env('CF_API_TOKEN'));
}
