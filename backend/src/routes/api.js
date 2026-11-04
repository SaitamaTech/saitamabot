import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, googleLogin, login, logout, register, requireOwner } from '../auth.js';
import { appConfig, getEncryptionKey } from '../config.js';
import { getPool } from '../db.js';
import { getCategories, getLiveCatalogSummary, isCommandConfigured, listCommands } from '../commands/catalog.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15*60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Wait a few minutes and try again.' } });
const pairingLimiter = rateLimit({ windowMs: 10*60_000, limit: 3, keyGenerator: (req) => req.user.id, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many pairing attempts. Wait 10 minutes before trying again.' } });
const phoneSchema = z.string().regex(/^\+?[1-9]\d{6,14}$/, 'Enter a phone number with its country calling code.');

router.get('/health', async (_req,res) => {
  try { await getPool().query('SELECT 1'); res.json({ok:true, database:'connected'}); }
  catch { res.status(503).json({ok:false,database:'unavailable'}); }
});
router.get('/catalog', (_req,res) => res.json({commands:listCommands({search:_req.query.search,category:_req.query.category,status:_req.query.status}).map((item)=>({...item,configured:isCommandConfigured(item)})),categories:getCategories(),summary:getLiveCatalogSummary()}));
router.get('/integrations', (_req,res) => res.json({
  channelConfigured:Boolean(appConfig.channelUrl),
  pairingAvailable:Boolean(getEncryptionKey()),
  supabaseUrl:appConfig.supabaseUrl,
  supabaseAnonKey:appConfig.supabaseAnonKey,
  aiConfigured:Boolean(process.env.OPENAI_API_KEY),
  tmdbConfigured:Boolean(process.env.TMDB_API_KEY),
  weatherConfigured:Boolean(process.env.WEATHER_API_KEY),
  notice:'WhatsApp connectivity uses the unofficial WhatsApp Web protocol and may be affected by WhatsApp restrictions.'
}));
router.post('/auth/register', authLimiter, register);
router.post('/auth/login', authLimiter, login);
router.post('/auth/google', authLimiter, googleLogin);
router.post('/auth/logout', authenticate, logout);
router.get('/auth/me', authenticate, (req,res) => res.json({user:{id:req.user.id,email:req.user.email,name:req.user.name,createdAt:req.user.created_at}}));

router.get('/dashboard', authenticate, async (req,res) => {
  const db=getPool();
  const [session,stats,activity,settings]=await Promise.all([
    db.query('SELECT phone,status,connected_at,last_disconnect,updated_at FROM whatsapp_sessions WHERE user_id=$1',[req.user.id]),
    db.query('SELECT messages_received,commands_executed,last_activity_at FROM bot_statistics WHERE user_id=$1',[req.user.id]),
    db.query('SELECT command,category,succeeded,duration_ms,created_at FROM command_usage WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8',[req.user.id]),
    db.query('SELECT prefix,bot_name FROM user_settings WHERE user_id=$1',[req.user.id]),
  ]);
  const s=session.rows[0]||{status:'disconnected'};
  res.json({user:{id:req.user.id,email:req.user.email,name:req.user.name},ownerAccess:req.user.email.toLowerCase()===appConfig.ownerEmail,session:s,stats:stats.rows[0]||{messages_received:0,commands_executed:0},activity:activity.rows,settings:settings.rows[0]||{prefix:'.',bot_name:appConfig.botName},catalog:getLiveCatalogSummary()});
});

router.get('/whatsapp/status', authenticate, async (req,res) => {
  const result=await getPool().query('SELECT phone,status,connected_at,last_disconnect,updated_at FROM whatsapp_sessions WHERE user_id=$1',[req.user.id]);
  res.json({session:result.rows[0]||{status:'disconnected'}});
});
router.post('/whatsapp/pair', authenticate, pairingLimiter, async (req,res) => {
  const parsed=z.object({phone:phoneSchema}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Use an international phone number with country code (7–15 digits).'});
  if(!getEncryptionKey()) return res.status(503).json({error:'Secure pairing is disabled until the administrator configures SESSION_ENCRYPTION_KEY.'});
  try {
    await req.app.locals.whatsapp.connect(req.user.id, parsed.data.phone.replace(/^\+/,''));
    res.status(202).json({status:'pairing',message:'Pairing requested. The code will arrive over your private real-time connection.'});
  } catch(error) {
    res.status(409).json({error:error.message||'Could not start WhatsApp pairing.'});
  }
});
router.post('/whatsapp/disconnect', authenticate, async (req,res) => {
  try { await req.app.locals.whatsapp.disconnect(req.user.id); res.json({status:'disconnected'}); }
  catch { res.status(500).json({error:'Could not delete the WhatsApp session.'}); }
});

router.get('/owner/overview', authenticate, requireOwner, async (_req,res) => {
  const db=getPool();
  const [users,connections,commands,health]=await Promise.all([
    db.query('SELECT count(*)::int AS total FROM users'),
    db.query("SELECT status,count(*)::int AS count FROM whatsapp_sessions GROUP BY status"),
    db.query('SELECT count(*)::bigint AS total FROM command_usage'),
    db.query('SELECT now() AS database_time'),
  ]);
  res.json({users:users.rows[0].total,connections:connections.rows,commands:commands.rows[0].total,uptimeSeconds:Math.floor(process.uptime()),databaseTime:health.rows[0].database_time,channelConfigured:Boolean(appConfig.channelUrl),providerFlags:{ai:Boolean(process.env.OPENAI_API_KEY),tmdb:Boolean(process.env.TMDB_API_KEY),weather:Boolean(process.env.WEATHER_API_KEY)}});
});
router.get('/owner/users', authenticate, requireOwner, async (_req,res) => {
  const rows=await getPool().query('SELECT u.id,u.email,u.name,u.created_at,s.status,s.phone FROM users u LEFT JOIN whatsapp_sessions s ON s.user_id=u.id ORDER BY u.created_at DESC LIMIT 200');
  res.json({users:rows.rows});
});

export default router;
