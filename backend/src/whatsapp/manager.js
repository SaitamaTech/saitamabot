import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, { BufferJSON, Browsers, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { appConfig, decryptJson, encryptJson, getEncryptionKey } from '../config.js';
import { getPool } from '../db.js';
import { logger } from '../logger.js';
import { processIncomingMessage } from '../commands/handlers.js';

const asBaileysValue = (value) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);
const asSerializable = (value) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
const safeDiagnosticText = (value) => String(value || '')
  .replace(/\b\d{7,15}\b/g, '[REDACTED]')
  .replace(/\b[A-Z0-9]{8}\b/g, '[REDACTED]')
  .slice(0, 200);

function disconnectDiagnostics(error, webSocketClose, webSocketError) {
  const message = safeDiagnosticText(error?.message);
  const closeReason = safeDiagnosticText(webSocketClose?.reason);
  const socketError = safeDiagnosticText(webSocketError?.message);
  const protocolReason = safeDiagnosticText(error?.data?.reason);
  const protocolLocation = safeDiagnosticText(error?.data?.location);
  return {
    statusCode: error?.output?.statusCode,
    errorName: error?.name,
    errorMessage: message || undefined,
    errorCode: error?.data?.code || error?.cause?.code || undefined,
    protocolReason: protocolReason || undefined,
    protocolLocation: protocolLocation || undefined,
    webSocketCode: webSocketClose?.code,
    webSocketReason: closeReason || undefined,
    webSocketError: socketError || undefined,
    webSocketErrorCode: webSocketError?.code,
  };
}

export class WhatsAppManager {
  constructor(io, { socketFactory = makeWASocket, versionFetcher = fetchLatestBaileysVersion } = {}) {
    this.io = io;
    this.socketFactory = socketFactory;
    this.versionFetcher = versionFetcher;
    this.protocolVersionCache = null;
    this.protocolVersionPromise = null;
    this.connections = new Map();
    this.connectionStarts = new Map();
    this.reconnectTimers = new Map();
    this.stopping = false;
  }

  notify(userId, status, extra = {}) {
    this.io.to(`user:${userId}`).emit('connection:status', { status, ...extra });
  }

  filePath(userId) { return path.join(appConfig.sessionDir, `${userId}.enc`); }

  getProtocolVersion() {
    if (this.protocolVersionCache && this.protocolVersionCache.expiresAt > Date.now()) {
      return Promise.resolve(this.protocolVersionCache.version);
    }
    if (!this.protocolVersionPromise) {
      const pending = this.versionFetcher({ timeout: 5_000 }).then((result) => {
        const isLatest = Boolean(result.isLatest);
        const message = isLatest
          ? 'Using current WhatsApp Web protocol version'
          : 'Could not fetch current WhatsApp Web protocol version; using Baileys bundled fallback';
        const details = isLatest ? { version: result.version } : { reason: result.error?.message };
        (isLatest ? logger.info : logger.warn)(message, details);
        this.protocolVersionCache = {
          version: result.version,
          expiresAt: Date.now() + (isLatest ? 60 * 60_000 : 60_000),
        };
        return result.version;
      }).finally(() => {
        this.protocolVersionPromise = null;
      });
      this.protocolVersionPromise = pending;
    }
    return this.protocolVersionPromise;
  }

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
      writeQueue = writeQueue.catch(() => {}).then(async () => {
        const envelope = encryptJson({ creds: asSerializable(creds), keys: asSerializable(data) });
        const temp = `${location}.${process.pid}.${Date.now()}.tmp`;
        try {
          await fs.writeFile(temp, envelope, { mode: 0o600, flag: 'w' });
          await fs.rename(temp, location);
          await fs.chmod(location, 0o600).catch(() => {});
        } catch (error) {
          await fs.unlink(temp).catch(() => {});
          throw error;
        }
      });
      return writeQueue;
    };
    return { state: { creds, keys }, saveCreds: persist, authFile: location };
  }

  async connect(userId, phone, options = {}) {
    const pending = this.connectionStarts.get(userId);
    if (pending) {
      if (pending.phone !== (phone || null)) {
        throw new Error('A WhatsApp connection is already starting. Wait for it to finish before changing the phone number.');
      }
      return pending.promise;
    }

    const entry = {
      phone: phone || null,
      promise: Promise.resolve().then(() => this.startConnection(userId, phone, options)),
    };
    this.connectionStarts.set(userId, entry);
    try {
      return await entry.promise;
    } finally {
      if (this.connectionStarts.get(userId) === entry) this.connectionStarts.delete(userId);
    }
  }

  async startConnection(userId, phone, { restoring = false } = {}) {
    if (this.stopping) throw new Error('Service is shutting down.');
    if (!getEncryptionKey()) throw new Error('Secure WhatsApp pairing is unavailable: set SESSION_ENCRYPTION_KEY to a 32-byte key (64 hex characters).');
    const normalizedPhone = String(phone || '').replace(/^\+/, '');
    if (phone && !/^[1-9]\d{6,14}$/.test(normalizedPhone)) {
      throw new Error('Use an international phone number with country code (7–15 digits).');
    }
    const current = this.connections.get(userId);
    if (current && ['connecting','connected'].includes(current.status)) return { status: current.status };
    if (current?.status === 'pairing' && phone && current.phone !== normalizedPhone) {
      current.closed=true;
      this.connections.delete(userId);
      try { current.sock?.end(undefined); } catch {}
      await current.auth.saveCreds().catch((error) => {
        logger.error('Could not flush credentials for replaced pairing', { userId, reason: error.message });
      });
      if (!current.registered) await fs.unlink(current.auth.authFile).catch(()=>{});
    } else if (current?.status === 'pairing') {
      return { status: 'pairing' };
    }
    clearTimeout(this.reconnectTimers.get(userId));
    this.reconnectTimers.delete(userId);
    const row = await getPool().query('SELECT phone,status FROM whatsapp_sessions WHERE user_id=$1', [userId]);
    const storedPhone = normalizedPhone || row.rows[0]?.phone;
    if (!storedPhone) throw new Error('A phone number is required for first-time pairing.');
    let auth = await this.loadAuth(userId);
    if (!auth.state.creds.registered && (auth.state.creds.me || auth.state.creds.pairingCode)) {
      await fs.unlink(auth.authFile).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      auth = await this.loadAuth(userId);
    }
    if (restoring && row.rows[0]?.status === 'connected' && !auth.state.creds.registered) throw new Error('A connected session has no authenticated credentials to restore.');
    const session = {
      userId,
      phone: storedPhone,
      status: auth.state.creds.registered ? 'connecting' : 'pairing',
      sock: null,
      auth,
      attempts: 0,
      registered: Boolean(auth.state.creds.registered),
      closed: false,
      pairingCode: null,
      pairingRequest: null,
      webSocketClose: null,
    };
    this.connections.set(userId, session);

    try {
      await getPool().query('UPDATE whatsapp_sessions SET phone=$2,status=$3,last_disconnect=NULL,updated_at=now() WHERE user_id=$1', [userId, storedPhone, session.status]);
      if (this.stopping) throw new Error('Service is shutting down.');
      this.notify(userId, session.status);
      const version = await this.getProtocolVersion();
      const sock = this.socketFactory({
        auth: auth.state,
        version,
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
      sock.ws.on('close', (code, reason) => {
        session.webSocketClose = {
          code,
          reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
        };
      });
      sock.ws.on('error', (error) => {
        session.webSocketError = {
          name: error?.name,
          message: safeDiagnosticText(error?.message),
          code: error?.code,
        };
      });
      sock.ev.on('creds.update', async () => {
        if (this.connections.get(userId) !== session || session.closed) return;
        session.registered = Boolean(auth.state.creds.registered);
        try { await auth.saveCreds(); }
        catch (error) { logger.error('Encrypted WhatsApp credential persistence failed', { userId, reason: error.message }); }
      });
      sock.ev.on('connection.update', async (update) => {
        if (this.connections.get(userId) !== session) return;
        if (update.qr) logger.info('WhatsApp pairing handshake ready', { userId });
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

      if (!session.registered) this.requestCode(session).catch((error) => this.failPairing(session, error));
      return { status: session.status };
    } catch (error) {
      if (this.connections.get(userId) === session) this.connections.delete(userId);
      session.closed = true;
      try { session.sock?.end(undefined); } catch {}
      await auth.saveCreds().catch((saveError) => {
        logger.error('Could not flush WhatsApp credentials after connection setup failed', { userId, reason: saveError.message });
      });
      await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, 'error', 'Connection initialization failed.']).catch(()=>{});
      this.notify(userId, 'error', { message: 'WhatsApp connection could not be initialized.' });
      throw error;
    }
  }

  requestCode(session, { replace = false } = {}) {
    if (session.pairingRequest) return session.pairingRequest;
    if (session.pairingCode && !replace) return Promise.resolve(session.pairingCode);
    const request = this.performCodeRequest(session);
    session.pairingRequest = request;
    return request.finally(() => {
      if (session.pairingRequest === request) session.pairingRequest = null;
    });
  }

  async performCodeRequest(session) {
    let resolveReady;
    let rejectReady;
    const pairingReady = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const onUpdate = (update) => {
      if (update.qr) resolveReady();
      else if (update.connection === 'close') {
        rejectReady(update.lastDisconnect?.error || new Error('WhatsApp closed before pairing initialization completed.'));
      }
    };
    session.sock.ev.on('connection.update', onUpdate);
    const timeout = setTimeout(() => {
      rejectReady(new Error('Timed out waiting for WhatsApp pairing initialization.'));
    }, 30_000);
    try {
      await Promise.all([session.sock.waitForSocketOpen(), pairingReady]);
    } finally {
      clearTimeout(timeout);
      session.sock.ev.off('connection.update', onUpdate);
    }
    if (this.connections.get(session.userId)!==session || session.closed) return;
    const code = await session.sock.requestPairingCode(session.phone);
    if (this.connections.get(session.userId)!==session || session.closed) return;
    session.pairingCode = code;
    await session.auth.saveCreds();
    this.io.to(`user:${session.userId}`).emit('pairing:code', { code });
    session.status = 'pairing';
    await getPool().query('UPDATE whatsapp_sessions SET status=$2,updated_at=now() WHERE user_id=$1', [session.userId, 'pairing']).catch(()=>{});
    this.notify(session.userId, 'pairing');
    logger.info('WhatsApp pairing code issued', { userId: session.userId });
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
      await this.requestCode(session, { replace: true });
    } catch (error) {
      await this.failPairing(session, error);
      throw new Error('Could not refresh the pairing code. The connection was closed; start a fresh pairing attempt.');
    }
  }

  async failPairing(session, error) {
    if (session.closed || this.connections.get(session.userId) !== session) return;
    session.closed = true;
    session.status = 'error';
    this.connections.delete(session.userId);
    try { session.sock?.end(undefined); } catch {}
    await session.auth.saveCreds().catch((saveError) => {
      logger.error('Could not flush credentials after pairing failure', { userId: session.userId, reason: saveError.message });
    });
    if (!session.registered) await fs.unlink(session.auth.authFile).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') logger.error('Could not remove incomplete WhatsApp pairing credentials', { userId: session.userId, reason: unlinkError.message });
    });
    const details = disconnectDiagnostics(error, session.webSocketClose, session.webSocketError);
    const reason = safeDiagnosticText(error?.message) || 'Unknown connection error';
    const protocolContext = [
      details.protocolReason && `protocol reason ${details.protocolReason}`,
      details.protocolLocation && `location ${details.protocolLocation}`,
    ].filter(Boolean).join(', ');
    await getPool().query(
      'UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1',
      [session.userId, 'error', `Pairing failed: ${reason}${details.statusCode ? ` (status ${details.statusCode})` : ''}${protocolContext ? `, ${protocolContext}` : ''}.`],
    ).catch(()=>{});
    logger.warn('WhatsApp pairing attempt failed', { userId: session.userId, ...details });
    this.notify(session.userId, 'error', {
      message: `WhatsApp pairing failed${details.statusCode ? ` (status ${details.statusCode})` : ''}${protocolContext ? `, ${protocolContext}` : ''}: ${reason}. Start a fresh pairing attempt.`,
    });
  }

  async handleClose(session, error) {
    if (session.closed || this.connections.get(session.userId) !== session) return;
    session.closed = true;
    const userId = session.userId;
    const statusCode = error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const details = disconnectDiagnostics(error, session.webSocketClose, session.webSocketError);
    const reason = safeDiagnosticText(error?.message);
    const description = loggedOut
      ? 'WhatsApp logged out this linked device.'
      : `WhatsApp connection closed${statusCode ? ` (status ${statusCode})` : ''}${reason ? `: ${reason}` : '.'}`;
    this.connections.delete(userId);
    session.status = loggedOut ? 'logged_out' : 'disconnected';
    await session.auth.saveCreds().catch((saveError) => {
      logger.error('Could not flush credentials after WhatsApp disconnect', { userId, reason: saveError.message });
    });
    await getPool().query('UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1', [userId, session.status, description]).catch(()=>{});
    this.notify(userId, session.status, { message: description });
    logger.warn('WhatsApp session disconnected', { userId, ...details });
    if (loggedOut) {
      await fs.unlink(session.auth.authFile).catch(()=>{});
      return;
    }
    if (this.stopping) return;
    if (!session.registered) {
      await fs.unlink(session.auth.authFile).catch((unlinkError) => {
        if (unlinkError.code !== 'ENOENT') logger.error('Could not remove incomplete WhatsApp pairing credentials', { userId, reason: unlinkError.message });
      });
      const protocolContext = [
        details.protocolReason && `, protocol reason ${details.protocolReason}`,
        details.protocolLocation && `, location ${details.protocolLocation}`,
      ].filter(Boolean).join('');
      await getPool().query(
        'UPDATE whatsapp_sessions SET status=$2,last_disconnect=$3,updated_at=now() WHERE user_id=$1',
        [userId,'error',`WhatsApp closed the connection before pairing completed${statusCode ? ` (status ${statusCode})` : ''}${protocolContext}${reason ? `: ${reason}` : ''}.`],
      ).catch(()=>{});
      this.notify(userId,'error',{message:`WhatsApp closed the pairing connection${statusCode ? ` (status ${statusCode})` : ''}${protocolContext}${reason ? `: ${reason}` : ''}. Start a fresh pairing attempt.`});
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
      try {
        if (session.registered) await session.sock.logout();
        else session.sock.end(undefined);
      } catch {
        try { session.sock.end(undefined); } catch {}
      }
      await session.auth.saveCreds().catch((error) => {
        logger.error('Could not flush WhatsApp credentials before session deletion', { userId, reason: error.message });
      });
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
    await Promise.all([...this.connectionStarts.values()].map((entry) => entry.promise.catch((error) => {
      logger.warn('WhatsApp connection start stopped during shutdown', { reason: error.message });
    })));
    const sessions = [...this.connections.values()];
    for (const session of sessions) {
      session.closed = true;
      try { session.sock.end(undefined); } catch {}
    }
    this.connections.clear();
    await Promise.all(sessions.map((session) => session.auth.saveCreds().catch((error) => {
      logger.error('Could not flush WhatsApp credentials during shutdown', { userId: session.userId, reason: error.message });
    })));
  }
}
