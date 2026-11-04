import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { closePool } from '../db.js';
import { WhatsAppManager } from './manager.js';

async function mockDatabase(t) {
  const originalQuery = pg.Pool.prototype.query;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
  pg.Pool.prototype.query = async () => ({ rowCount: 1, rows: [] });
  t.after(async () => {
    pg.Pool.prototype.query = originalQuery;
    await closePool();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
}

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
    auth: { saveCreds: async () => {} },
  };
  manager.connections.set(session.userId, session);

  await manager.requestCode(session);

  assert.deepEqual(events.slice(0, 3), ['socket-open', 'pairing-ready', 'request-code']);
  assert.equal(manager.getPairingCode(session.userId), 'REAL-CODE');
});

test('duplicate pairing requests share one in-flight code request', async (t) => {
  await mockDatabase(t);
  const manager = new WhatsAppManager({ to: () => ({ emit() {} }) });
  const socketEvents = new EventEmitter();
  const session = {
    userId: 'user-3',
    phone: '15551234567',
    status: 'pairing',
    closed: false,
    auth: { saveCreds: async () => {} },
    sock: {
      ev: socketEvents,
      waitForSocketOpen: async () => socketEvents.emit('connection.update', { qr: 'ready' }),
      requestPairingCode: async () => {
        requests += 1;
        await new Promise((resolve) => { finishRequest = resolve; });
        return 'ONCE-CODE';
      },
    },
  };
  let requests = 0;
  let finishRequest;
  manager.connections.set(session.userId, session);

  const first = manager.requestCode(session);
  const second = manager.requestCode(session);
  await new Promise(setImmediate);
  assert.equal(requests, 1);
  finishRequest();
  await Promise.all([first, second]);
  assert.equal(manager.getPairingCode(session.userId), 'ONCE-CODE');
});

test('simultaneous connect calls create only one WhatsApp socket', async (t) => {
  await mockDatabase(t);
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
  });

  let sockets = 0;
  const manager = new WhatsAppManager({ to: () => ({ emit() {} }) }, {
    socketFactory: () => {
      sockets += 1;
      const ev = new EventEmitter();
      return {
        ev,
        ws: new EventEmitter(),
        waitForSocketOpen: async () => ev.emit('connection.update', { qr: 'ready' }),
        requestPairingCode: async () => 'ONE-SOCKET',
        end() {},
      };
    },
  });
  manager.loadAuth = async () => ({
    state: { creds: { registered: false } },
    authFile: 'unused',
    saveCreds: async () => {},
  });

  const results = await Promise.all([
    manager.connect('user-4', '15551234567'),
    manager.connect('user-4', '15551234567'),
  ]);
  await new Promise(setImmediate);

  assert.deepEqual(results, [{ status: 'pairing' }, { status: 'pairing' }]);
  assert.equal(sockets, 1);
  assert.equal(manager.getPairingCode('user-4'), 'ONE-SOCKET');
  await manager.shutdown();
});

test('new pairing resets unregistered credentials left by an interrupted attempt', async (t) => {
  await mockDatabase(t);
  const previousKey = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
  t.after(() => {
    if (previousKey === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previousKey;
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saitama-pairing-reset-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const authFile = path.join(directory, 'pending.enc');
  await fs.writeFile(authFile, 'incomplete');
  let authLoads = 0;
  let socketCreds;
  const manager = new WhatsAppManager({ to: () => ({ emit() {} }) }, {
    socketFactory: (options) => {
      socketCreds = options.auth.creds;
      const ev = new EventEmitter();
      return {
        ev,
        ws: new EventEmitter(),
        waitForSocketOpen: async () => ev.emit('connection.update', { qr: 'ready' }),
        requestPairingCode: async () => 'FRESH-CODE',
        end() {},
      };
    },
  });
  manager.loadAuth = async () => {
    authLoads += 1;
    return {
      state: { creds: authLoads === 1 ? { registered: false, me: { id: 'old@s.whatsapp.net' }, pairingCode: 'OLD-CODE' } : { registered: false } },
      authFile,
      saveCreds: async () => {},
    };
  };

  await manager.connect('user-7', '15551234567');
  await new Promise(setImmediate);

  assert.equal(authLoads, 2);
  assert.equal(socketCreds.me, undefined);
  assert.equal(manager.getPairingCode('user-7'), 'FRESH-CODE');
  await manager.shutdown();
});

test('failed unregistered pairing removes incomplete auth but preserves registered auth', async (t) => {
  await mockDatabase(t);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saitama-pairing-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const manager = new WhatsAppManager({ to: () => ({ emit() {} }) });

  const pendingAuthFile = path.join(directory, 'pending.enc');
  await fs.writeFile(pendingAuthFile, 'incomplete');
  const pending = {
    userId: 'user-5',
    status: 'pairing',
    phone: '15551234567',
    registered: false,
    closed: false,
    auth: { authFile: pendingAuthFile, saveCreds: async () => {} },
    sock: { end() {} },
  };
  manager.connections.set(pending.userId, pending);
  await manager.handleClose(pending, { message: 'Connection Terminated', output: { statusCode: 428 } });
  await assert.rejects(fs.access(pendingAuthFile));

  const registeredAuthFile = path.join(directory, 'registered.enc');
  await fs.writeFile(registeredAuthFile, 'valid');
  const registered = {
    ...pending,
    userId: 'user-6',
    status: 'connected',
    registered: true,
    auth: { authFile: registeredAuthFile, saveCreds: async () => {} },
  };
  manager.stopping = true;
  manager.connections.set(registered.userId, registered);
  await manager.handleClose(registered, { message: 'Connection Terminated', output: { statusCode: 428 } });
  assert.equal(await fs.readFile(registeredAuthFile, 'utf8'), 'valid');
});
