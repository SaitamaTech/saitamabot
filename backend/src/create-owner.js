import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { getPool, migrate, closePool } from './db.js';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
dotenv.config({path:path.join(projectRoot,'.env')});

async function readHidden(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write(prompt);
  const original = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (text) => { if (text.includes('\n')) original(text); };
  try { return await new Promise((resolve, reject) => { rl.once('close', () => reject(new Error('Input closed.'))); rl.question('', resolve); }); }
  finally { rl.close(); }
}

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = (emailArg || '').trim().toLowerCase();
  const name = nameParts.join(' ').trim();
  const configured = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run owner:create -- owner@example.com "Owner Name"');
  if (!configured || configured !== email) throw new Error('OWNER_EMAIL in .env must exactly match the account email before owner provisioning.');
  const password = await readHidden('New owner password (12+ characters; input hidden): ');
  if (password.length < 12 || password.length > 128) throw new Error('Password must be 12–128 characters.');
  await migrate();
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email=$1 FOR UPDATE', [email]);
    if (existing.rowCount) throw new Error('That email already has an account. Owner status is based on OWNER_EMAIL; sign in with that account instead.');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query('INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id', [email, name, passwordHash]);
    const id = user.rows[0].id;
    await client.query('INSERT INTO whatsapp_sessions(user_id) VALUES($1)', [id]);
    await client.query('INSERT INTO user_settings(user_id,bot_name) VALUES($1,$2)', [id, process.env.BOT_NAME || 'SAITAMA BOT']);
    await client.query('INSERT INTO bot_configurations(user_id) VALUES($1)', [id]);
    await client.query('INSERT INTO bot_statistics(user_id) VALUES($1)', [id]);
    await client.query('COMMIT');
    console.log('Owner account created. Sign in using the configured owner email.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await closePool(); }
}

main().catch(async (error) => {
  console.error(error.message);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
