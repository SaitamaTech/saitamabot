import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { appConfig } from './config.js';
import { getPool } from './db.js';

const cookieName = 'saitama_session';
const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(12).max(128);

function tokenSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  return secret;
}

function setSessionCookie(res, user) {
  const token = jwt.sign({ sub: user.id, email: user.email }, tokenSecret(), { expiresIn: '12h', issuer: 'saitama-bot' });
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export async function register(req, res) {
  const parsed = z.object({ email: emailSchema, name: z.string().trim().min(1).max(80), password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email, name, and password of at least 12 characters.' });
  const { email, name, password } = parsed.data;
  if (process.env.OWNER_EMAIL && email.toLowerCase() === process.env.OWNER_EMAIL.trim().toLowerCase()) {
    return res.status(403).json({ error: 'The configured owner account must be provisioned by the server administrator.' });
  }
  const db = getPool();
  try {
    const hash = await bcrypt.hash(password, 12);
    const client = await db.connect();
    let user;
    try {
      await client.query('BEGIN');
      const result = await client.query('INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id,email,name,created_at', [email.toLowerCase(), name, hash]);
      user = result.rows[0];
      await client.query('INSERT INTO whatsapp_sessions(user_id) VALUES($1)', [user.id]);
      await client.query('INSERT INTO user_settings(user_id,bot_name) VALUES($1,$2)', [user.id, process.env.BOT_NAME || 'SAITAMA BOT']);
      await client.query('INSERT INTO bot_configurations(user_id) VALUES($1)', [user.id]);
      await client.query('INSERT INTO bot_statistics(user_id) VALUES($1)', [user.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    setSessionCookie(res, user);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    console.error('[auth] registration failed', error.message);
    return res.status(500).json({ error: 'Could not create the account.' });
  }
}

export async function login(req, res) {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const db = getPool();
  const result = await db.query('SELECT id,email,name,password_hash,created_at FROM users WHERE email=$1', [parsed.data.email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await db.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  setSessionCookie(res, user);
  return res.json({ user: publicUser(user) });
}

export async function googleLogin(req, res) {
  const parsed = z.object({ accessToken: z.string().min(1).max(16_384) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid Google sign-in session is required.' });
  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }

  let verification;
  try {
    verification = await fetch(`${appConfig.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: appConfig.supabaseAnonKey,
        authorization: `Bearer ${parsed.data.accessToken}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error('[auth] Supabase identity verification failed', error.message);
    return res.status(503).json({ error: 'Google sign-in could not be verified right now. Please try again.' });
  }
  if (!verification.ok) {
    const status = verification.status === 401 || verification.status === 403 ? 401 : 503;
    return res.status(status).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }

  let identity;
  try {
    identity = await verification.json();
  } catch {
    return res.status(502).json({ error: 'The identity provider returned an invalid response.' });
  }
  if (!identity || typeof identity !== 'object') {
    return res.status(502).json({ error: 'The identity provider returned an invalid response.' });
  }
  const isGoogleIdentity = identity.app_metadata?.provider === 'google'
    || (Array.isArray(identity.identities) && identity.identities.some((provider) => provider?.provider === 'google'));
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  if (!isGoogleIdentity || !emailSchema.safeParse(email).success || !(identity.email_confirmed_at || identity.confirmed_at)) {
    return res.status(401).json({ error: 'Use a Google account with a verified email address.' });
  }

  const db = getPool();
  const client = await db.connect();
  let user;
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id,email,name,created_at FROM users WHERE email=$1 FOR UPDATE',
      [email],
    );
    if (email === (process.env.OWNER_EMAIL || '').trim().toLowerCase() && !existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'The configured owner account must be provisioned by the server administrator.' });
    }

    if (existing.rowCount) {
      const updated = await client.query(
        'UPDATE users SET last_login_at=now() WHERE id=$1 RETURNING id,email,name,created_at',
        [existing.rows[0].id],
      );
      user = updated.rows[0];
    } else {
      const metadata = identity.user_metadata || {};
      const displayName = [metadata.full_name, metadata.name]
        .find((value) => typeof value === 'string' && value.trim());
      const name = (displayName || email.split('@')[0]).trim().slice(0, 80) || 'Google user';
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const created = await client.query(
        `INSERT INTO users(email,name,password_hash,last_login_at)
         VALUES($1,$2,$3,now())
         ON CONFLICT(email) DO UPDATE SET last_login_at=now()
         RETURNING id,email,name,created_at`,
        [email, name, passwordHash],
      );
      user = created.rows[0];
      await client.query('INSERT INTO whatsapp_sessions(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user.id]);
      await client.query(
        'INSERT INTO user_settings(user_id,bot_name) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING',
        [user.id, process.env.BOT_NAME || 'SAITAMA BOT'],
      );
      await client.query('INSERT INTO bot_configurations(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user.id]);
      await client.query('INSERT INTO bot_statistics(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user.id]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[auth] Google account sign-in failed', error.message);
    return res.status(500).json({ error: 'Could not sign in with Google.' });
  } finally {
    client.release();
  }

  setSessionCookie(res, user);
  return res.json({ user: publicUser(user) });
}

function publicUser(user) { return { id: user.id, email: user.email, name: user.name, createdAt: user.created_at }; }

export function logout(_req, res) {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.status(204).end();
}

export async function authenticate(req, res, next) {
  try {
    const raw = req.cookies?.[cookieName];
    if (!raw) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(raw, tokenSecret(), { issuer: 'saitama-bot' });
    const result = await getPool().query('SELECT id,email,name,created_at FROM users WHERE id=$1', [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Your account is no longer available.' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

export function requireOwner(req, res, next) {
  const ownerEmail = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!ownerEmail || req.user?.email?.toLowerCase() !== ownerEmail) return res.status(403).json({ error: 'Owner access is not configured for this account.' });
  next();
}

export function verifySocketToken(token) {
  if (!token) throw new Error('No session cookie');
  return jwt.verify(token, tokenSecret(), { issuer: 'saitama-bot' });
}

export const AUTH_COOKIE_NAME = cookieName;
