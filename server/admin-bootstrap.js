import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { auditPostgres, makeId, now } from './domain.js';
import { transaction } from './neon.js';

export function validBootstrapInput(body = {}) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const token = typeof body.bootstrapToken === 'string' ? body.bootstrapToken : '';
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) return null;
  if (password.length < 16 || password.length > 200) return null;
  if (token.length < 32 || token.length > 512) return null;
  return { username, password, token };
}

export function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

export function registerInitialAdminRoute(app, { ensureSchema, production }) {
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/setup/admin', limiter, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (production && !req.secure) {
        return res.status(426).json({ error: 'https_requis', message: 'Utilisez le site en HTTPS.' });
      }
      const expectedToken = process.env.ADMIN_SETUP_TOKEN || '';
      if (!process.env.DATABASE_URL || (process.env.SESSION_SECRET || '').length < 32 || expectedToken.length < 32) {
        return res.status(503).json({ error: 'configuration_incomplete', message: 'La configuration initiale sécurisée n’est pas activée.' });
      }
      const input = validBootstrapInput(req.body);
      if (!input || !tokenMatches(input.token, expectedToken)) {
        return res.status(403).json({ error: 'acces_refuse', message: 'Code de configuration invalide ou informations incorrectes.' });
      }
      await ensureSchema();
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [73194521]);
        const existing = await client.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
        if (existing.rows.length) throw Object.assign(new Error('Un compte administrateur existe déjà.'), { status: 409 });
        const id = makeId();
        const at = now();
        await client.query(`INSERT INTO users
          (id,login_name,password_hash,role,status,created_at,updated_at)
          VALUES($1,$2,$3,'admin','active',$4,$4)`, [id, input.username, passwordHash, at]);
        await auditPostgres(client, id, 'initial_admin_created', 'user', id, { username: input.username });
        return { id, username: input.username };
      });
      return res.status(201).json({ message: 'Compte administrateur créé. Supprimez maintenant ADMIN_SETUP_TOKEN des variables Vercel, puis connectez-vous.', user: user.username });
    } catch (error) {
      if (error?.status === 409 || error?.code === '23505') {
        return res.status(409).json({ error: 'admin_existant', message: 'Un compte administrateur existe déjà ou cet identifiant est utilisé.' });
      }
      if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(error?.code)
          || /DATABASE_URL|Neon|database|connect/i.test(error?.message || '')) {
        return res.status(503).json({ error: 'database_indisponible', message: 'La base Neon n’est pas disponible. Vérifie DATABASE_URL dans Vercel.' });
      }
      return next(error);
    }
  });
}
