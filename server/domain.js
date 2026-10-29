import { randomUUID, createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export const COUNTRIES = ['SN', 'ML', 'CI', 'BJ'];
export const PAYMENT_METHODS = {
  SN: ['Orange Money', 'Wave'],
  CI: ['Orange Money', 'Moov', 'Wave'],
  ML: ['Orange Money', 'Moov'],
  BJ: ['Moov']
};
const DIAL_CODES = { SN: '221', ML: '223', CI: '225', BJ: '229' };

export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const makeId = () => randomUUID();
export function validAmount(value) { return Number.isSafeInteger(value) && value > 0; }
export function validatePassword(value, minimum = 12) {
  return typeof value === 'string' && value.length >= minimum && value.length <= 200;
}
export function validateCountryProvider(country, provider) {
  return COUNTRIES.includes(country) && PAYMENT_METHODS[country].includes(provider);
}
export function normalizePhone(country, value) {
  const dialingCode = DIAL_CODES[country];
  if (!dialingCode || typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  const international = digits.startsWith(dialingCode) ? digits : `${dialingCode}${digits}`;
  if (international.length < 9 || international.length > 15) return null;
  return `+${international}`;
}

export function availableBalance(db, userId) {
  const ledgerBalance = db.prepare(`SELECT COALESCE(SUM(
    CASE WHEN direction='credit' THEN amount_xof ELSE -amount_xof END),0) AS balance
    FROM ledger_entries WHERE user_id=?`).get(userId).balance;
  const reserved = db.prepare(`SELECT COALESCE(SUM(amount_xof),0) AS amount
    FROM withdrawal_requests WHERE user_id=? AND status IN ('pending','processing')`).get(userId).amount;
  return { balanceXof: ledgerBalance, reservedXof: reserved, availableXof: ledgerBalance - reserved };
}

// PostgreSQL equivalents used by Vercel; retain synchronous SQLite functions
// above solely for legacy isolated domain tests.
export async function availableBalancePostgres(client, userId, safeXof) {
  const { rows } = await client.query(`SELECT
    COALESCE((SELECT SUM(CASE WHEN direction='credit' THEN amount_xof ELSE -amount_xof END)
      FROM ledger_entries WHERE user_id=$1),0)::text AS balance,
    COALESCE((SELECT SUM(amount_xof) FROM withdrawal_requests
      WHERE user_id=$1 AND status IN ('pending','processing')),0)::text AS reserved`, [userId]);
  const balanceXof = safeXof(rows[0].balance);
  const reservedXof = safeXof(rows[0].reserved);
  return { balanceXof, reservedXof, availableXof: balanceXof - reservedXof };
}

export function audit(db, actor, action, type, entity, details = {}) {
  db.prepare(`INSERT INTO audit_log
    (id,actor_id,action,entity_type,entity_id,details_json,created_at)
    VALUES(?,?,?,?,?,?,?)`)
    .run(makeId(), actor ?? null, action, type, entity ?? null, JSON.stringify(details), now());
}

export async function auditPostgres(client, actor, action, type, entity, details = {}) {
  await client.query(`INSERT INTO audit_log
    (id,actor_id,action,entity_type,entity_id,details_json,created_at)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
  [makeId(), actor ?? null, action, type, entity ?? null, JSON.stringify(details), now()]);
}
export function transaction(db, fn) { return db.transaction(fn).immediate(); }

export function createWithdrawal(db, { userId, country, provider, amountXof, recipientPhone, idempotencyKey }) {
  if (!validAmount(amountXof)) throw Object.assign(new Error('Montant invalide.'), { status: 400 });
  if (!validateCountryProvider(country, provider)) throw Object.assign(new Error('Méthode de paiement invalide pour ce pays.'), { status: 400 });
  if (typeof recipientPhone !== 'string' || !/^\+\d{8,15}$/.test(recipientPhone)
      || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 150) {
    throw Object.assign(new Error('Informations de retrait invalides.'), { status: 400 });
  }
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM withdrawal_requests WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) {
      const sameRequest = existing.user_id === userId && existing.country === country
        && existing.provider === provider && existing.amount_xof === amountXof
        && existing.recipient_phone === recipientPhone;
      if (!sameRequest) throw Object.assign(new Error('Cette clé de demande a déjà été utilisée pour d’autres informations.'), { status: 409 });
      return { ...existing, replay: true };
    }
    const balance = availableBalance(db, userId);
    if (balance.availableXof < amountXof) throw Object.assign(new Error('Solde disponible insuffisant.'), { status: 409 });
    const id = makeId();
    db.prepare(`INSERT INTO withdrawal_requests
      (id,user_id,country,provider,amount_xof,recipient_phone,status,idempotency_key,created_at)
      VALUES(?,?,?,?,?,?,'pending',?,?)`)
      .run(id, userId, country, provider, amountXof, recipientPhone, idempotencyKey, now());
    return db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(id);
  });
}

export function reviewDeposit(db, adminId, id, action, note = '') {
  if (!['approve', 'reject'].includes(action)) throw Object.assign(new Error('Action invalide.'), { status: 400 });
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (action === 'approve' && cleanNote.length < 8) {
    throw Object.assign(new Error('Ajoutez la référence ou la preuve de paiement vérifiée avant tout crédit.'), { status: 400 });
  }
  if (action === 'reject' && cleanNote.length < 3) {
    throw Object.assign(new Error('Indiquez la raison du refus.'), { status: 400 });
  }
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM deposit_requests WHERE id=?').get(id);
    if (!row || row.status !== 'pending') throw Object.assign(new Error('Demande introuvable ou déjà traitée.'), { status: 409 });
    const status = action === 'approve' ? 'approved' : 'rejected';
    const at = now();
    db.prepare(`UPDATE deposit_requests SET status=?,admin_id=?,admin_note=?,reviewed_at=?
      WHERE id=? AND status='pending'`).run(status, adminId, cleanNote.slice(0, 1000), at, id);
    if (action === 'approve') {
      db.prepare(`INSERT INTO ledger_entries
        (id,user_id,entry_type,direction,amount_xof,related_type,related_id,created_by,created_at)
        VALUES(?,?,'deposit','credit',?,'deposit',?,?,?)`)
        .run(makeId(), row.user_id, row.amount_xof, id, adminId, at);
    }
    audit(db, adminId, `deposit_${action}`, 'deposit', id, { amountXof: row.amount_xof, note: cleanNote.slice(0, 160) });
    return db.prepare('SELECT * FROM deposit_requests WHERE id=?').get(id);
  });
}

export function reviewWithdrawal(db, adminId, id, action, note = '', reference = '') {
  if (!['processing', 'paid', 'reject'].includes(action)) throw Object.assign(new Error('Action invalide.'), { status: 400 });
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  const cleanReference = typeof reference === 'string' ? reference.trim() : '';
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(id);
    if (!row || !['pending', 'processing'].includes(row.status)) {
      throw Object.assign(new Error('Demande introuvable ou déjà traitée.'), { status: 409 });
    }
    if (action === 'processing' && row.status !== 'pending') {
      throw Object.assign(new Error('Transition de statut invalide.'), { status: 409 });
    }
    if (action === 'paid' && row.status !== 'processing') {
      throw Object.assign(new Error('Marquez d’abord la demande en cours de traitement.'), { status: 409 });
    }
    if (action === 'paid' && (cleanReference.length < 3 || cleanReference.length > 160)) {
      throw Object.assign(new Error('Une référence de paiement réelle est obligatoire.'), { status: 400 });
    }
    if (action === 'reject' && cleanNote.length < 3) {
      throw Object.assign(new Error('Indiquez la raison du refus.'), { status: 400 });
    }
    const status = action === 'reject' ? 'rejected' : action;
    const at = now();
    db.prepare(`UPDATE withdrawal_requests SET status=?,admin_id=?,admin_note=?,payout_reference=?,reviewed_at=?,paid_at=?
      WHERE id=?`).run(status, adminId, cleanNote.slice(0, 1000),
      action === 'paid' ? cleanReference : row.payout_reference, at,
      action === 'paid' ? at : row.paid_at, id);
    if (action === 'paid') {
      db.prepare(`INSERT INTO ledger_entries
        (id,user_id,entry_type,direction,amount_xof,related_type,related_id,created_by,created_at)
        VALUES(?,?,'withdrawal','debit',?,'withdrawal',?,?,?)`)
        .run(makeId(), row.user_id, row.amount_xof, id, adminId, at);
    }
    audit(db, adminId, `withdrawal_${action}`, 'withdrawal', id,
      { amountXof: row.amount_xof, reference: action === 'paid' ? cleanReference : undefined });
    return db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(id);
  });
}

export function makeSessionToken(secret) {
  const raw = randomBytes(32).toString('base64url');
  return `${raw}.${createHmac('sha256', secret).update(raw).digest('base64url')}`;
}
export function verifySessionToken(token, secret) {
  if (typeof token !== 'string') return null;
  const [raw, signature, ...extra] = token.split('.');
  if (!raw || !signature || extra.length || !/^[A-Za-z0-9_-]+$/.test(raw) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const actual = Buffer.from(signature, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? raw : null;
}
export function newOpaqueToken() { return randomBytes(32).toString('base64url'); }
