import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import pg from 'pg';
import { closePool } from '../db.js';
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

test('pairing code is requested only after the WhatsApp pairing handshake', async (t) => {
  const originalQuery = pg.Pool.prototype.query;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
  pg.Pool.prototype.query = async () => ({ rowCount: 1 });
  t.after(async () => {
    pg.Pool.prototype.query = originalQuery;
    await closePool();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const events = [];
  const manager = new WhatsAppManager({
    to: () => ({ emit: (event) => events.push(event) }),
  });
  const socketEvents = new EventEmitter();
  socketEvents.on('connection.update', (update) => {
    if (update.qr) events.push('pairing-ready');
  });
  const session = {
    userId: 'user-2',
    phone: '15551234567',
    status: 'pairing',
    closed: false,
    sock: {
      ev: socketEvents,
      waitForSocketOpen: async () => {
        events.push('socket-open');
        socketEvents.emit('connection.update', { qr: 'initialization-complete' });
      },
      requestPairingCode: async () => { events.push('request-code'); return 'REAL-CODE'; },
    },
  };
  manager.connections.set(session.userId, session);

  await manager.requestCode(session);

  assert.deepEqual(events.slice(0, 3), ['socket-open', 'pairing-ready', 'request-code']);
  assert.equal(manager.getPairingCode(session.userId), 'REAL-CODE');
});
