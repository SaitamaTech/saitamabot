import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, { BufferJSON, Browsers, DisconnectReason, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { appConfig, decryptJson, encryptJson, getEncryptionKey } from '../config.js';
import { getPool } from '../db.js';
import { logger } from '../logger.js';
import { processIncomingMessage } from '../commands/handlers.js';

const asBaileysValue = (value) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);
const asSerializable = (value) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));

export class WhatsAppManager {
  constructor(io) {
    this.io = io;
    this.connections = new Map();
    this.reconnectTimers = new Map();
    this.stopping = false;
  }

  notify(userId, status, extra = {}) {
    this.io.to(`user:${userId}`).emit('connection:status', { status, ...extra });
  }

  filePath(userId) { return path.join(appConfig.sessionDir, `${userId}.enc`); }

  async loadAuth(userId) {
    await fs.mkdir(appConfig.sessionDir, { recursive: true, mode: 0o700 });
    await fs.chmod(appConfig.sessionDir, 0o700).catch(() => {});
    const location = this.filePath(userId);
    let saved = null;
    try { saved = decryptJson(await fs.readFile(location, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not decrypt stored WhatsApp session. Verify SESSION_ENCRYPTION_KEY and restore the matching key.'); }
    const creds = saved?.creds ? asBaileysValue(saved.creds) : initAuthCreds();
    const data = saved?.keys || {};
    const keys = {
      async get(type, ids) {
        const category = data[type] || {};
        const result = {};
        for (const id of ids) {
          let value = category[id];
          if (value && type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
          if (value !== undefined) result[id] = value;
        }
        return result;
      },
      async set(values) {
        for (const [type, entries] of Object.entries(values)) {
          data[type] ||= {};
          for (const [id, value] of Object.entries(entries)) {
            if (value === null || value === undefined) delete data[type][id];
            else data[type][id] = value;
          }
        }
        await persist();
      },
    };
    let writeQueue = Promise.resolve();
    const persist = () => {
      writeQueue = writeQueue.then(async () => {
        const envelope = encryptJson({ creds: asSerializable(creds), keys: asSerializable(data) });
        const temp = `${location}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, envelope, { mode: 0o600, flag: 'w' });
        await fs.rename(temp, location);
        await fs.chmod(location, 0o600).catch(() => {});
      });
      return writeQueue;
    };
    return { state: { creds, keys }, saveCreds: persist, authFile: location };
  }

  async connect(userId, phone, { restoring = false } = {}) {
    if (this.stopping) throw new Error('Service is shutting down.');
    if (!getEncryptionKey()) throw new Error('Secure WhatsApp pairing is unavailable: set SESSION_ENCRYPTION_KEY to a 32-byte key (64 hex characters).');
    const current = this.connections.get(userId);
    if (current && ['connecting','connected'].includes(current.status)) return { status: current.status };
    if (current?.status === 'pairing' && phone && current.phone !== phone) {
      current.closed=true;
      this.connections.delete(userId);
      try { current.sock?.end(undefined); } catch {}
      await fs.unlink(current.auth.authFile).catch(()=>{});
    } else if (current?.status === 'pairing') {
      return { status: 'pairing' };
    }
    clearTimeout(this.reconnectTimers.get(userId));
    this.reconnectTimers.delete(userId);
    const row = await getPool().query('SELECT phone,status FROM whatsapp_sessions WHERE user_id=$1', [userId]);
    const storedPhone = phone || row.rows[0]?.phone;
    if (!storedPhone) throw new Error('A phone number is required for first-time pairing.');
    const auth = await this.loadAuth(userId);
    if (restoring && row.rows[0]?.status === 'connected' && !auth.state.creds.registered) throw new Error('A connected session has no authenticated credentials to restore.');
    const session = { userId, phone: storedPhone, status: auth.state.creds.registered ? 'connecting' : 'pairing', sock: null, auth, attempts: 0, registered: Boolean(auth.state.creds.registered), closed: false, pairingCode: null };
    this.connections.set(userId, session);
    await getPool().query('UPDATE whatsapp_sessions SET phone=$2,status=$3,last_disconnect=NULL,updated_at=now() WHERE user_id=$1', [userId, storedPhone, session.status]);
    this.notify(userId, session.status);

    try {
      const sock = makeWASocket({
        auth: auth.state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 30_000,
      });
      session.sock = sock;
      sock.ev.on('creds.update', async () => {
        try { await auth.saveCreds(); session.registered = Boolean(auth.state.creds.registered); }
        catch (error) { logger.error('Encrypted WhatsApp credential persistence failed', { userId, reason: error.name }); }
      });
      sock.ev.on('connection.update', async (update) => {
        if (this.connections.get(userId) !== session) return;
        if (update.connection === 'open') {
          session.status = 'connected'; session.registered = true; session.pairingCode = null; session.attempts = 0;
          const number = sock.user?.id?.split(':')[0]?.split('@')[0] || session.phone;
          await getPool().query('UPDATE whatsapp_sessions SET phone=$2,status=$3,connected_at=now(),last_disconnect=NULL,updated_at=now() WHERE user_id=$1', [userId, number, 'connected']).catch(()=>{});
          this.notify(userId, 'connected', { phone: number });
          logger.info('WhatsApp session connected', { userId });
        }
        if (update.connection === 'close') await this.handleClose(session, update.lastDisconnect?.error);
      });
      sock.ev.on('messages.upsert', async ({ messages, type, requestId }) => {
        if (type !== 'notify') return;
        for (const message of messages || []) {
          if (requestId || message.requestId || message.key?.requestId) continue;
          try { await processIncomingMessage({ sock, userId, message, io: this.io }); }
          catch (error) { logger.error('Incoming WhatsApp message processing failed', { userId, reason: error.name }); }
        }
      });

      if (!session.registered) this.requestCode(session).catch((error) => {
        logger.warn('WhatsApp pairing code request failed', {
          userId,
          reason: error.message,
          statusCode: error.output?.statusCode,
        });
        session.status = 'error';
        session.closed = true;
        this.connections.delete(userId);
        try { sock.end(undefined); } catch {}
        getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, 'error', 'Pairing code could not be requested.']).catch(()=>{});
        this.notify(userId, 'error', { message: 'Could not request a pairing code. Check the number and try again.' });
      });
      return { status: session.status };
    } catch (error) {
      this.connections.delete(userId);
      await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, 'error', 'Connection initialization failed.']).catch(()=>{});
      this.notify(userId, 'error', { message: 'WhatsApp connection could not be initialized.' });
      throw error;
    }
  }

  async requestCode(session) {
    await session.sock.waitForSocketOpen();
    if (this.connections.get(session.userId)!==session || session.closed) return;
    let lastError;
    for (let attempt=0; attempt<4; attempt++) {
      if (this.connections.get(session.userId)!==session || session.closed) return;
      try {
        const code = await session.sock.requestPairingCode(session.phone);
        if (this.connections.get(session.userId)!==session || session.closed) return;
        session.pairingCode = code;
        this.io.to(`user:${session.userId}`).emit('pairing:code', { code });
        session.status = 'pairing';
        await getPool().query('UPDATE whatsapp_sessions SET status=$2,updated_at=now() WHERE user_id=$1', [session.userId, 'pairing']).catch(()=>{});
        this.notify(session.userId, 'pairing');
        return;
      } catch(error) {
        lastError=error;
        if(attempt<3) await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
      }
    }
    throw lastError || new Error('Pairing code request failed.');
  }

  getPairingCode(userId) {
    const session = this.connections.get(userId);
    return session?.status === 'pairing' ? session.pairingCode || null : null;
  }

  async refreshPairingCode(userId) {
    const session = this.connections.get(userId);
    if (!session || session.status !== 'pairing') {
      throw new Error('There is no active pairing request. Request a pairing code first.');
    }

    try {
      await this.requestCode(session);
    } catch (error) {
      logger.warn('WhatsApp pairing code refresh failed', { userId, reason: error.name });
      session.status = 'error';
      session.closed = true;
      this.connections.delete(userId);
      try { session.sock?.end(undefined); } catch {}
      await getPool().query(
        'UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1',
        [userId,'error','Pairing code could not be refreshed.'],
      ).catch(()=>{});
      this.notify(userId,'error',{message:'Could not refresh the pairing code. Check the number and try again.'});
      throw new Error('Could not refresh the pairing code. Check the number and try again.');
    }
  }

  async handleClose(session, error) {
    if (session.closed || this.connections.get(session.userId) !== session) return;
    session.closed = true;
    session.pairingCode = null;
    const userId = session.userId;
    const statusCode = error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const description = loggedOut
      ? 'WhatsApp logged out this linked device.'
      : `WhatsApp connection closed${statusCode ? ` (status ${statusCode})` : ''}.`;
    this.connections.delete(userId);
    session.status = loggedOut ? 'logged_out' : 'disconnected';
    await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, session.status, description]).catch(()=>{});
    this.notify(userId, session.status, { message: description });
    logger.warn('WhatsApp session disconnected', { userId, statusCode: statusCode || 'unknown' });
    if (loggedOut) {
      await fs.unlink(session.auth.authFile).catch(()=>{});
      return;
    }
    if (this.stopping) return;
    if (!session.registered) {
      await getPool().query(
        'UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1',
        [userId,'error',`WhatsApp closed the connection before pairing completed${statusCode ? ` (status ${statusCode})` : ''}.`],
      ).catch(()=>{});
      this.notify(userId,'error',{message:`WhatsApp closed the pairing connection${statusCode ? ` (status ${statusCode})` : ''}. Check the server logs, then request a new code.`});
      return;
    }
    const next = Math.min(60_000, 1000 * (2 ** Math.min(session.attempts++, 6)));
    const timer = setTimeout(() => this.connect(userId, session.phone, { restoring: true }).catch(() => {}), next);
    timer.unref?.();
    this.reconnectTimers.set(userId, timer);
  }

  async disconnect(userId) {
    clearTimeout(this.reconnectTimers.get(userId));
    this.reconnectTimers.delete(userId);
    const session = this.connections.get(userId);
    this.connections.delete(userId);
    if (session) {
      session.closed = true;
      try { await session.sock.logout(); } catch { try { session.sock.end(undefined); } catch {} }
    }
    await fs.unlink(this.filePath(userId)).catch(()=>{});
    await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, 'disconnected', 'Session deleted by account owner.']);
    this.notify(userId, 'disconnected', { message: 'Session disconnected and deleted.' });
  }

  getStatus(userId) {
    const session = this.connections.get(userId);
    return session ? session.status : null;
  }

  async restore() {
    if (!getEncryptionKey()) {
      await getPool().query("UPDATE whatsapp_sessions SET status='error',last_disconnect='SESSION_ENCRYPTION_KEY is missing or invalid.',updated_at=now() WHERE status IN ('connected','connecting','pairing')").catch(()=>{});
      logger.warn('WhatsApp reconnection disabled because SESSION_ENCRYPTION_KEY is missing or invalid');
      return;
    }
    const pending = await getPool().query(
      "UPDATE whatsapp_sessions SET status='error',last_disconnect='Pairing was interrupted by a server restart. Request a new code.',updated_at=now() WHERE status='pairing' RETURNING user_id",
    );
    if (pending.rowCount) {
      logger.info('Interrupted pending WhatsApp pairings after server restart', { count: pending.rowCount });
    }
    const result = await getPool().query("SELECT user_id,phone FROM whatsapp_sessions WHERE status IN ('connected','connecting') AND phone IS NOT NULL");
    for (const row of result.rows) {
      try { await this.connect(row.user_id, row.phone, { restoring: true }); }
      catch(error) {
        await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1',[row.user_id,'error','Stored session could not be restored.']).catch(()=>{});
        this.notify(row.user_id,'error',{message:'Stored WhatsApp session could not be restored. Check the server encryption key and session volume.'});
        logger.warn('WhatsApp session restoration failed', { userId: row.user_id, reason: error.name });
      }
    }
    logger.info('Queued WhatsApp session restoration', { count: result.rowCount });
  }

  async shutdown() {
    this.stopping = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    for (const session of this.connections.values()) {
      session.closed = true;
      try { session.sock.end(undefined); } catch {}
    }
    this.connections.clear();
  }
}
