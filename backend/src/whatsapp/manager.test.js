import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppManager } from './manager.js';

test('repeating an active pairing request preserves its current code', async (t) => {
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
  });

  let requests = 0;
  const manager = new WhatsAppManager({ to: () => ({ emit() {} }) });
  manager.connections.set('user-1', {
    status: 'pairing',
    phone: '15551234567',
    pairingCode: 'CURRENT-CODE',
    sock: { requestPairingCode: async () => { requests += 1; return 'NEW-CODE'; } },
    auth: { authFile: 'unused' },
    closed: false,
  });

  assert.deepEqual(await manager.connect('user-1', '15551234567'), { status: 'pairing' });
  assert.equal(manager.getPairingCode('user-1'), 'CURRENT-CODE');
  assert.equal(requests, 0);
});
