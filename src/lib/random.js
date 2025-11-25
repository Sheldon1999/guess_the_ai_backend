import crypto from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';

const sodiumReady = sodium.ready;

async function ensureSodiumReady() {
  await sodiumReady;
}

function toUint8(message) {
  if (message instanceof Uint8Array) return message;
  if (Buffer.isBuffer(message)) return new Uint8Array(message);
  return new TextEncoder().encode(String(message ?? ''));
}

function hashToIndex(hashBytes, listLength) {
  if (!Number.isInteger(listLength) || listLength <= 0) {
    throw new Error('listLength must be a positive integer');
  }
  const hex = Buffer.from(hashBytes).toString('hex');
  const n = BigInt(`0x${hex}`);
  return Number(n % BigInt(listLength));
}

export async function vrfProve(secretKey, message) {
  await ensureSodiumReady();
  const msg = toUint8(message);
  const proof = sodium.crypto_vrf_prove(secretKey, msg);
  const hash = sodium.crypto_vrf_proof_to_hash(proof);
  return {
    proof: Buffer.from(proof),
    hash: Buffer.from(hash),
  };
}

export async function vrfVerify(publicKey, message, proof) {
  await ensureSodiumReady();
  const msg = toUint8(message);
  return sodium.crypto_vrf_verify(publicKey, proof, msg);
}

export async function vrfIndexFromMessage(secretKey, message, listLength) {
  const { proof, hash } = await vrfProve(secretKey, message);
  return {
    index: hashToIndex(hash, listLength),
    proof: proof.toString('base64'),
    hash: hash.toString('hex'),
  };
}

export function localRandomIndex(listLength) {
  if (!Number.isInteger(listLength) || listLength <= 0) {
    throw new Error('listLength must be a positive integer');
  }
  return crypto.randomInt(0, listLength);
}

export async function pickVrfSample(secretKey, message, items, count = 10) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  const limit = Math.min(count, items.length);
  const results = [];
  const seen = new Set();
  let seed = message;

  while (results.length < limit && seen.size < items.length) {
    const { proof, hash } = await vrfProve(secretKey, seed);
    const idx = hashToIndex(hash, items.length);
    if (!seen.has(idx)) {
      results.push({
        value: items[idx],
        index: idx,
        proof: proof.toString('base64'),
        hash: hash.toString('hex'),
      });
      seen.add(idx);
    }
    seed = hash;
  }

  return results;
}

export function decodeProof(base64Proof) {
  return Buffer.from(base64Proof, 'base64');
}
