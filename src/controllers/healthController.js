/**
 * Health Controller
 * Request handlers for health check endpoints
 */

import redis from '../lib/redis.js';
import db from '../lib/mongo.js';
import { daDeadLetters } from '../lib/mongo.js';
import { getDaQueueMetrics } from '../services/daEventService.js';

/**
 * Basic health check handler
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export function healthCheckHandler(req, res) {
  return res.json({ ok: true });
}

/**
 * Dependencies health check handler
 * Verifies Redis and MongoDB connectivity
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export async function dependenciesHealthHandler(req, res) {
  try {
    await redis.ping();
    await db.command({ ping: 1 });
    return res.json({ redis: 'ok', mongo: 'ok' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function daQueueHealthHandler(req, res) {
  try {
    const metrics = await getDaQueueMetrics();
    const deadLetters = await daDeadLetters.countDocuments({});
    return res.json({
      ok: true,
      queue: metrics,
      deadLetters
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
