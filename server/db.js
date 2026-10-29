import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(dbPath = process.env.DB_PATH || './data/rangers.sqlite') {
  // Safety barrier: the current route layer is synchronous SQLite. Refuse
  // production startup until every route is migrated to the Neon async layer.
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    throw new Error('SQLite est désactivé en production. Migration async Neon requise avant déploiement.');
  }
  const resolvedPath = dbPath === ':memory:' ? dbPath : path.resolve(dbPath);
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  }
  const db = new Database(resolvedPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (resolvedPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

  // Safe additive migration for installations created before product images were added.
  const productColumns = db.pragma('table_info(products)');
  if (!productColumns.some(column => column.name === 'image_url')) {
    db.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS guest_sessions (
    id_hash TEXT PRIMARY KEY,
    csrf_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS guest_sessions_expiry_idx ON guest_sessions(expires_at);`);

  if (resolvedPath !== ':memory:') {
    try { fs.chmodSync(resolvedPath, 0o600); } catch { /* Certains systèmes ajustent les permissions */ }
  }
  return db;
}
