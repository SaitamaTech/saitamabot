import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { appConfig, getEncryptionKey } from './config.js';
import { migrate, getPool, closePool } from './db.js';
import { logger } from './logger.js';
import api from './routes/api.js';
import { configureSocket } from './socket.js';
import { WhatsAppManager } from './whatsapp/manager.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const webDist=path.resolve(here,'../../frontend/dist');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:appConfig.webOrigin,credentials:true},transports:['websocket','polling']});
configureSocket(io);
const whatsapp=new WhatsAppManager(io);
app.locals.whatsapp=whatsapp;
app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.use(helmet({crossOriginEmbedderPolicy:false,contentSecurityPolicy:process.env.NODE_ENV==='production'?undefined:false}));
app.use(cors({origin:appConfig.webOrigin,credentials:true,methods:['GET','POST','PUT','DELETE','OPTIONS']}));
app.use((req,res,next)=>{
  const origin=req.get('origin');
  if(origin && origin!==appConfig.webOrigin) return res.status(403).json({error:'Untrusted request origin.'});
  next();
});
app.use(express.json({limit:'100kb'}));
app.use(cookieParser());
app.use('/api',api);
app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  logger.error('HTTP request failed',{path:req.path,reason:err.name});
  res.status(500).json({error:'The server could not complete that request.'});
});
if(fs.existsSync(webDist)) {
  app.use(express.static(webDist,{index:false,maxAge:process.env.NODE_ENV==='production'?'1h':0}));
  app.use((req,res,next)=>{
    if(req.path.startsWith('/api') || !['GET','HEAD'].includes(req.method)) return next();
    res.sendFile(path.join(webDist,'index.html'));
  });
}

async function start(){
  if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32 || /replace|example|change-me/i.test(process.env.JWT_SECRET)) throw new Error('JWT_SECRET must be replaced with a random secret of at least 32 characters.');
  await migrate();
  if(!getEncryptionKey()) logger.warn('WhatsApp pairing disabled: set SESSION_ENCRYPTION_KEY to exactly 32 random bytes encoded as 64 hex characters');
  if(!appConfig.channelUrl) logger.warn('WhatsApp command channel links are not enabled: WHATSAPP_CHANNEL_URL is unset');
  if(appConfig.channelUrl && !/^https:\/\//i.test(appConfig.channelUrl)) throw new Error('WHATSAPP_CHANNEL_URL must be an HTTPS URL.');
  await fs.promises.mkdir(appConfig.sessionDir,{recursive:true,mode:0o700});
  server.listen(appConfig.port,'0.0.0.0',()=>logger.info('SAITAMA BOT API listening',{port:appConfig.port,environment:process.env.NODE_ENV||'development'}));
  await whatsapp.restore();
}

let closing=false;
async function shutdown(signal){
  if(closing)return;closing=true;logger.info('Shutting down',{signal});
  await whatsapp.shutdown();
  io.close();
  server.close(async()=>{await closePool();process.exit(0);});
  setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
start().catch((error)=>{logger.error('Server startup failed',{reason:error.message});process.exit(1);});
