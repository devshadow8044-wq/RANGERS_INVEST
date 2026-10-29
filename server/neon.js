import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

neonConfig.webSocketConstructor = ws;
let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL Neon est requis.');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 10_000 });
  return pool;
}
export const query = async (text, values = []) => getPool().query(text, values);
export async function one(text, values = []) { return (await query(text, values)).rows[0] ?? null; }
export async function all(text, values = []) { return (await query(text, values)).rows; }
export async function transaction(fn) {
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original error */ } throw error; }
  finally { client.release(); }
}
export function safeXof(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Montant hors limites sûres.');
  return Number(n);
}
export async function initializeSchema() {
  const sql = await fs.readFile(new URL('./schema.postgres.sql', import.meta.url), 'utf8');
  await query(sql);
}
export async function closePool() { if (pool) { const current = pool; pool = undefined; await current.end(); } }
