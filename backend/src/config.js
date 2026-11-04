import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env') });
export const appConfig = {
  root,
  port: Number(process.env.PORT || 3000),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  botName: process.env.BOT_NAME || 'SAITAMA BOT',
  prefix: process.env.BOT_PREFIX || '.',
  channelUrl: process.env.WHATSAPP_CHANNEL_URL || '',
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  sessionDir: path.resolve(process.env.SESSION_DIR || path.join(root, 'backend/data/sessions')),
  ownerEmail: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
};

export function getEncryptionKey() {
  const raw = process.env.SESSION_ENCRYPTION_KEY || '';
  if (!raw) return null;
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { return null; }
  }
  return key.length === 32 ? key : null;
}

export function encryptJson(value) {
  const key = getEncryptionKey();
  if (!key) throw new Error('SESSION_ENCRYPTION_KEY must be a 32-byte key (64 hex characters).');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
}

export function decryptJson(serialized) {
  const key = getEncryptionKey();
  if (!key) throw new Error('SESSION_ENCRYPTION_KEY must be a 32-byte key (64 hex characters).');
  const envelope = JSON.parse(serialized);
  if (envelope.v !== 1) throw new Error('Unsupported encrypted session format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}
