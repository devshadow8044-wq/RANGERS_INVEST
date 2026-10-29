import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches, validBootstrapInput } from '../server/admin-bootstrap.js';

const token = '0123456789abcdef0123456789abcdef';

test('le jeton admin exige une longueur élevée et une égalité exacte', () => {
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(`${token}x`, token), false);
  assert.equal(tokenMatches('court', 'court'), false);
  assert.equal(tokenMatches(undefined, token), false);
});

test('la création admin refuse un identifiant, un mot de passe ou un jeton faible', () => {
  assert.deepEqual(validBootstrapInput({ username: 'rangers.admin', password: 'un mot de passe solide 2026', bootstrapToken: token }), {
    username: 'rangers.admin', password: 'un mot de passe solide 2026', token
  });
  assert.equal(validBootstrapInput({ username: 'x', password: 'un mot de passe solide 2026', bootstrapToken: token }), null);
  assert.equal(validBootstrapInput({ username: 'admin', password: 'tropcourt', bootstrapToken: token }), null);
  assert.equal(validBootstrapInput({ username: 'admin', password: 'un mot de passe solide 2026', bootstrapToken: 'petit' }), null);
});
