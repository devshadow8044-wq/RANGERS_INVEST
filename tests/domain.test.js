import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import {
  PAYMENT_METHODS, validateCountryProvider, validAmount, validatePassword,
  normalizePhone, createWithdrawal, availableBalance, reviewDeposit, reviewWithdrawal
} from '../server/domain.js';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const at = '2026-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO users(id,phone,country,password_hash,role,status,invite_code,created_at,updated_at)
    VALUES('u','+221770000000','SN','x','user','active','INVITE',?,?)`).run(at, at);
  db.prepare(`INSERT INTO users(id,login_name,password_hash,role,status,created_at,updated_at)
    VALUES('a','admin','x','admin','active',?,?)`).run(at, at);
  return db;
}
function seedCredit(db, amount = 10000) {
  db.prepare(`INSERT INTO ledger_entries
    (id,user_id,entry_type,direction,amount_xof,related_type,related_id,created_at)
    VALUES('l','u','deposit','credit',10000,'deposit','seed',?)`).run('2026-01-01T00:00:00.000Z');
}

test('méthodes de paiement limitées aux opérateurs sélectionnés par pays', () => {
  assert.deepEqual(PAYMENT_METHODS, {
    SN: ['Orange Money', 'Wave'], CI: ['Orange Money', 'Moov', 'Wave'],
    ML: ['Orange Money', 'Moov'], BJ: ['Moov']
  });
  assert.equal(validateCountryProvider('SN', 'Wave'), true);
  assert.equal(validateCountryProvider('BJ', 'Wave'), false);
  assert.equal(validateCountryProvider('XX', 'Moov'), false);
});

test('normalisation des numéros vers un format international avec le code pays', () => {
  assert.equal(normalizePhone('SN', '+221 77 123 45 67'), '+221771234567');
  assert.equal(normalizePhone('CI', '0102030405'), '+2250102030405');
  assert.equal(normalizePhone('BJ', '12345'), null);
  assert.equal(normalizePhone('XX', '12345678'), null);
});

test('validation des montants et mots de passe', () => {
  assert.equal(validAmount(1), true);
  assert.equal(validAmount(0), false);
  assert.equal(validAmount(1.2), false);
  assert.equal(validAmount(Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(validatePassword('123456789012'), true);
  assert.equal(validatePassword('short'), false);
});

test('retrait idempotent, réservé, insuffisant et débit inscrit une seule fois', () => {
  const db = fixture(); seedCredit(db);
  const args = { userId: 'u', country: 'SN', provider: 'Wave', amountXof: 4000,
    recipientPhone: '+221771111111', idempotencyKey: 'request-key-123' };
  const first = createWithdrawal(db, args);
  const replay = createWithdrawal(db, args);
  assert.equal(first.id, replay.id);
  assert.equal(replay.replay, true);
  assert.deepEqual(availableBalance(db, 'u'), { balanceXof: 10000, reservedXof: 4000, availableXof: 6000 });
  assert.throws(() => createWithdrawal(db, { ...args, amountXof: 3000 }), /clé de demande/i);
  assert.throws(() => createWithdrawal(db, { ...args, idempotencyKey: 'different-key-456', amountXof: 7000 }), /insuffisant/i);
  assert.throws(() => reviewWithdrawal(db, 'a', first.id, 'paid', '', 'PAY-REF'), /d’abord/i);
  reviewWithdrawal(db, 'a', first.id, 'processing', 'Vérification effectuée');
  reviewWithdrawal(db, 'a', first.id, 'paid', 'Virement exécuté', 'PAY-REF-001');
  assert.deepEqual(availableBalance(db, 'u'), { balanceXof: 6000, reservedXof: 0, availableXof: 6000 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE related_type='withdrawal'").get().n, 1);
  assert.throws(() => reviewWithdrawal(db, 'a', first.id, 'paid', '', 'PAY-REF-001'), /introuvable ou déjà traitée/i);
  db.close();
});

test('un dépôt n’est crédité qu’après une note de vérification, une fois', () => {
  const db = fixture();
  db.prepare(`INSERT INTO deposit_requests
    (id,user_id,country,provider,amount_xof,external_reference,status,created_at)
    VALUES('dep','u','SN','Wave',5000,'ref','pending','2026-01-01')`).run();
  assert.throws(() => reviewDeposit(db, 'a', 'dep', 'approve', ''), /preuve de paiement/i);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n, 0);
  reviewDeposit(db, 'a', 'dep', 'approve', 'Réf opérateur vérifiée');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE related_type='deposit'").get().n, 1);
  assert.throws(() => reviewDeposit(db, 'a', 'dep', 'approve', 'Nouvelle preuve'), /déjà traitée/i);
  db.close();
});

test('le refus d’un retrait libère la réserve sans créer de débit', () => {
  const db = fixture(); seedCredit(db);
  const withdrawal = createWithdrawal(db, {
    userId: 'u', country: 'SN', provider: 'Wave', amountXof: 2000,
    recipientPhone: '+221771111111', idempotencyKey: 'request-key-456'
  });
  reviewWithdrawal(db, 'a', withdrawal.id, 'reject', 'Coordonnées à vérifier');
  assert.deepEqual(availableBalance(db, 'u'), { balanceXof: 10000, reservedXof: 0, availableXof: 10000 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE related_type='withdrawal'").get().n, 0);
  db.close();
});
