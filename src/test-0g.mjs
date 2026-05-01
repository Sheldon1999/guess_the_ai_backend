/**
 * Quick 0G inference test — run with: node src/test-0g.mjs
 */
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import dotenv from 'dotenv';
dotenv.config();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

async function main() {
  const PRIVATE_KEY = process.env.ZG_PRIVATE_KEY;
  const RPC_URL = process.env.ZG_RPC_URL || 'https://evmrpc.0g.ai';
  const MODEL = process.env.ZG_CHAT_MODEL || 'deepseek/deepseek-chat-v3-0324';

  if (!PRIVATE_KEY) {
    console.error('ZG_PRIVATE_KEY not set');
    process.exit(1);
  }

  console.log(`RPC: ${RPC_URL}`);
  console.log(`Model: ${MODEL}`);
  console.log('');

  console.log('1. Initializing broker...');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  console.log('   Broker ready');

  console.log('2. Listing services...');
  const services = await broker.inference.listService();
  console.log(`   Found ${services.length} services`);
  
  const normalize = (s) => String(s || '').trim().toLowerCase().replace(/^deepseek\//, '');
  const service = services.find((s) => s.model === MODEL || normalize(s.model) === normalize(MODEL));

  if (!service) {
    console.error('   Model not found! Available:', services.map((s) => s.model).join(', '));
    process.exit(1);
  }

  const providerAddress = service.providerAddress || service.provider || service.address;
  console.log(`   Provider: ${providerAddress}`);

  console.log('3. Getting metadata...');
  const metadata = await broker.inference.getServiceMetadata(providerAddress);
  const endpoint = metadata.endpoint.replace(/\/+$/, '');
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Model from metadata: ${metadata.model}`);

  console.log('4. Getting auth headers...');
  const userContent = 'Say hello and confirm you are working.';
  const headers = await broker.inference.getRequestHeaders(providerAddress, userContent);
  console.log(`   Headers keys: ${Object.keys(headers).join(', ')}`);

  console.log('5. Sending request (60s timeout)...');
  const start = Date.now();

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model: metadata.model || MODEL,
      messages: [
        { role: 'system', content: 'Reply in one sentence.' },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 50,
    }),
    signal: AbortSignal.timeout(60000),
  });

  const elapsed = Date.now() - start;
  console.log(`   Status: ${response.status} (${elapsed}ms)`);

  if (response.ok) {
    const data = await response.json();
    console.log('   Response:', data?.choices?.[0]?.message?.content);
  } else {
    const text = await response.text();
    console.error('   Error body:', text.slice(0, 500));
  }

  console.log('\nDone!');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
