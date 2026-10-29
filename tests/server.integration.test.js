import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

test('sans DATABASE_URL, le serveur échoue fermé et ne bascule pas vers SQLite', async t => {
  const port = 31000 + Math.floor(Math.random() * 12000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port) };
  delete env.DATABASE_URL;
  delete env.DB_PATH;
  const child = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  let response;
  for (let i = 0; i < 40; i++) {
    try { response = await fetch(`${baseUrl}/api/health`); break; } catch { await delay(75); }
  }
  assert.ok(response, 'le processus Express démarre');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'unavailable', database: 'not_ready' });
  const setupPage = await fetch(`${baseUrl}/admin-setup.html`);
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /Créer le premier administrateur/);
  const setup = await fetch(`${baseUrl}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ bootstrapToken: '0123456789abcdef0123456789abcdef', username: 'rangers', password: 'une phrase secrète longue 2026' })
  });
  assert.equal(setup.status, 503);
  assert.equal((await setup.json()).error, 'configuration_incomplete');
  const bootstrap = await fetch(`${baseUrl}/api/bootstrap`);
  assert.equal(bootstrap.status, 503);
  assert.equal((await bootstrap.json()).error, 'database_indisponible');
});
