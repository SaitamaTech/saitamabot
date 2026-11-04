import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { evaluate } from 'mathjs';
import QRCode from 'qrcode';
import ipaddr from 'ipaddr.js';
import { proto } from '@whiskeysockets/baileys';
import { getPool } from '../db.js';
import { appConfig } from '../config.js';
import { logger } from '../logger.js';
import { transformText } from './textStyles.js';
import catalog from './catalog.json' with { type: 'json' };
import { findCommandSuggestion, formatActiveCommandMenu, formatCommandUsage, formatUnknownCommand } from './catalog.js';

const startedAt = Date.now();
const games = new Map();
const commandBuckets = new Map();
const newsletterPostCache = new WeakMap();
let callsSinceSweep = 0;
const supported = new Set(catalog.filter((c) => c.status === 'implemented').map((c) => c.name.slice(1)));
const textCommands = new Set(['acute','allstyles','fullwidth','inverted','smallcaps','tagstyle','circled','circledneg','curvy1','curvy2','curvy3','parenthesized','squared','squaredneg','mathbold','mathboldfraktur','mathbolditalic','mathboldscript','mathdoublestruck','mathfraktur','mathmonospace','mathsans','cjkthai','fauxcyrillic','fauxethiopic','regionalindicator','rockdots','stroked','subscript','superscript']);
const emojiDigits = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗'];
const emojiDigitValues = new Map(emojiDigits.map((emoji, value) => [emoji, value]));
const scienceFacts = [
  'A day on Venus is longer than its year.',
  'Lightning is hotter than the surface of the Sun.',
  'Water expands when it freezes, which makes ice less dense than liquid water.',
  'Octopuses have three hearts.',
  'The International Space Station completes an orbit around Earth about every 90 minutes.',
];

const fmtDuration = (seconds) => {
  const d = Math.floor(seconds / 86400); const h = Math.floor((seconds % 86400) / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
};
const safeText = (value, max = 1500) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
const timeoutSignal = (ms = 12000) => AbortSignal.timeout(ms);

export function stylePremiumText(value) {
  const text = safeText(value, 3500);
  const protectedPattern = /(https?:\/\/[^\s]+|\bwa\.me\/\d{6,15}\b|[.!#$%&/?:;+=@~_-][a-z][a-z0-9]*)/gi;
  return text.split(protectedPattern).map((part, index) => {
    if (index % 2 === 1 || !part.trim()) return part;
    return transformText('.mathbold', part.toUpperCase());
  }).join('');
}

function getNewsletterMessages(response, newsletterJid) {
  const messages = [];
  const visit = (node) => {
    if (!Array.isArray(node?.content)) return;
    for (const child of node.content) {
      if (child.tag === 'message') {
        const attrs = child.attrs || {};
        let message;
        if (Buffer.isBuffer(child.content) || child.content instanceof Uint8Array) {
          message = proto.WebMessageInfo.decode(child.content);
        } else if (Array.isArray(child.content)) {
          const plaintext = child.content.find((item) => item.tag === 'plaintext')?.content;
          if (Buffer.isBuffer(plaintext) || plaintext instanceof Uint8Array) {
            message = {
              key: {
                id: attrs.message_id || attrs.server_id,
                remoteJid: attrs.from || newsletterJid,
                fromMe: false,
              },
              message: proto.Message.decode(plaintext),
              messageTimestamp: Number(attrs.t) || 0,
            };
          }
        }
        if (message?.message) {
          messages.push({
            ...message,
            key: {
              ...message.key,
              id: message.key?.id || attrs.message_id || attrs.server_id,
              remoteJid: message.key?.remoteJid || attrs.from || newsletterJid,
              server_id: message.key?.server_id || attrs.server_id,
            },
          });
        }
      }
      visit(child);
    }
  };
  visit(response);
  return messages;
}

async function getNewsletterPost(sock) {
  if (!appConfig.channelUrl) throw new Error('WhatsApp channel URL is not configured');
  if (typeof sock.newsletterMetadata !== 'function') {
    throw new Error('This Baileys socket does not support newsletter metadata');
  }
  if (typeof sock.newsletterFetchMessages !== 'function') {
    throw new Error('This Baileys socket does not support fetching newsletter posts');
  }
  const postId = Number(appConfig.channelPostId);
  if (!Number.isSafeInteger(postId) || postId < 1) {
    throw new Error('WHATSAPP_CHANNEL_POST_ID must identify a post in WHATSAPP_CHANNEL_URL');
  }
  const cached = newsletterPostCache.get(sock);
  if (cached) return cached;

  const inviteCode = new URL(appConfig.channelUrl).pathname.match(/\/channel\/([^/]+)/i)?.[1];
  if (!inviteCode) throw new Error('WhatsApp channel URL has no invite code');
  const postPromise = (async () => {
    const metadata = await sock.newsletterMetadata('invite', inviteCode);
    if (!/^\d+@newsletter$/.test(metadata?.id || '') || !metadata?.name) {
      throw new Error('WhatsApp returned incomplete channel metadata');
    }
    const response = await sock.newsletterFetchMessages(metadata.id, 100, 0, postId - 1);
    const message = getNewsletterMessages(response, metadata.id).find((candidate) =>
      String(candidate.key?.server_id || candidate.key?.id || '') === String(postId)
    );
    if (!message?.message) {
      throw new Error(`WhatsApp did not return channel post ${postId}`);
    }
    return { message, newsletterJid: metadata.id, newsletterName: safeText(metadata.name, 100), postId };
  })().catch((error) => {
    newsletterPostCache.delete(sock);
    throw error;
  });
  newsletterPostCache.set(sock, postPromise);
  return postPromise;
}

async function sendNewsletterPost(sock, jid) {
  const post = await getNewsletterPost(sock);
  await sock.sendMessage(jid, {
    forward: post.message,
    force: true,
    contextInfo: {
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: post.newsletterJid,
        serverMessageId: post.postId,
        newsletterName: post.newsletterName,
      },
    },
  });
}

export async function reactToCommand(sock, jid, message) {
  try {
    await sock.sendMessage(jid, { react: { text: '⚡', key: message.key } });
  } catch (error) {
    logger.warn('WhatsApp command reaction failed', { reason: error.name });
  }
}

export async function isSafePublicUrl(raw) {
  let url;
  try { url = raw instanceof URL ? raw : new URL(raw); } catch { return false; }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return false;
  const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if(!host || host.includes('%') || host.length>253 || host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.example') || host.endsWith('.invalid') || host.endsWith('.onion') || !host.includes('.')) return false;
  const publicAddress=(address)=>{
    try { return ipaddr.process(address).range()==='unicast'; }
    catch { return false; }
  };
  if(ipaddr.isValid(host)) return publicAddress(host);
  try {
    const records=await dns.lookup(host,{all:true,verbatim:true});
    return records.length>0 && records.every((record)=>publicAddress(record.address));
  } catch { return false; }
}

async function openAi(prompt) {
  if (!process.env.OPENAI_API_KEY) return 'AI provider is not configured. Set OPENAI_API_KEY on the server.';
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: timeoutSignal(30000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: safeText(prompt, 6000) }], max_tokens: 700, temperature: 0.6 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return `AI provider error (${response.status}). Check the server key, model, or quota.`;
    return safeText(data.choices?.[0]?.message?.content || 'The AI provider returned no text.');
  } catch (error) {
    logger.warn('AI provider request failed', { reason: error.name });
    return 'AI provider is temporarily unavailable. Please try again later.';
  }
}

export function parseSafeExpression(expression) {
  const value = safeText(expression, 160);
  if (!value || !/^[0-9+\-*/%^().,\sA-Za-z]+$/.test(value)) throw new Error('Use numbers, arithmetic operators, parentheses, and supported math functions only.');
  const symbols = value.match(/[A-Za-z]+/g) || [];
  const allowed = new Set(['sqrt','sin','cos','tan','asin','acos','atan','log','log10','abs','ceil','floor','round','exp','pi','e','min','max','pow']);
  if (symbols.some((symbol) => !allowed.has(symbol.toLowerCase()))) throw new Error('Unsupported name in expression.');
  const result = evaluate(value);
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('Expression did not produce a finite number.');
  return Number.isInteger(result) ? String(result) : String(Number(result.toPrecision(10)));
}

async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return { error: 'Movie search is not configured. Set TMDB_API_KEY on the server.' };
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set('api_key', key);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: timeoutSignal() });
    if (!res.ok) return { error: `TMDB request failed (${res.status}).` };
    return await res.json();
  } catch { return { error: 'TMDB is temporarily unavailable.' }; }
}

function getText(message) {
  const m = message.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}
function chatKey(userId, jid) { return `${userId}:${jid}`; }
function isGroup(jid) { return jid.endsWith('@g.us'); }
function parseDigits(jid='') { return jid.split('@')[0].split(':')[0]; }

async function participantInfo(sock, jid, senderJid) {
  const group = await sock.groupMetadata(jid);
  const admins = new Set(group.participants.filter((p) => p.admin).map((p) => p.id));
  const botJid = sock.user?.id;
  const callerIsAdmin = admins.has(senderJid) || parseDigits(senderJid) === parseDigits(sock.user?.id);
  const botIsAdmin = admins.has(botJid) || group.participants.some((p) => parseDigits(p.id) === parseDigits(botJid) && p.admin);
  return { group, admins, callerIsAdmin, botIsAdmin };
}

function mentionedJids(message, text, participants = []) {
  const explicit = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (explicit.length) return explicit;
  const digits = [...text.matchAll(/@([0-9]{5,16})/g)].map((m) => m[1]);
  return digits.map((number) => participants.find((p) => parseDigits(p.id) === number)?.id).filter(Boolean);
}

export async function executeCommand({ sock, userId, jid, senderJid, message, command, args, prefix = appConfig.prefix, startedAt: messageTime }) {
  const messageText = getText(message).trim();
  const commandText = messageText.startsWith(prefix)
    ? messageText.slice(prefix.length).trimStart()
    : '';
  const commandToken = commandText.split(/\s/, 1)[0].toLowerCase();
  const argText = commandToken === command
    ? commandText.slice(commandToken.length).trimStart()
    : args.join(' ').trim();
  const latency = Math.max(1, Date.now() - messageTime);
  if (!supported.has(command)) {
    const catalogEntry = catalog.find((item) => item.name === `.${command}`);
    if (catalogEntry) {
      return {
        text: catalogEntry.status === 'implemented'
          ? formatCommandUsage(catalogEntry, prefix)
          : `${prefix}${command} is not available yet. See its status in the dashboard command catalogue.`,
      };
    }
    return { text: formatUnknownCommand(command, prefix) };
  }
  if (textCommands.has(command)) return { text: transformText(`.${command}`, argText) };

  switch (command) {
    case 'menu': {
      return {
        text: formatActiveCommandMenu({
          botName: appConfig.botName,
          prefix,
          uptime: fmtDuration(Math.floor((Date.now() - startedAt) / 1000)),
        }),
      };
    }
    case 'tqto': return { text: `Thanks for using ${safeText(appConfig.botName, 80)}.\nBuilt by ${safeText(process.env.OWNER_NAME || 'Saitama Tech', 80)}.` };
    case 'owner': return {
      text: [
        '*👑 OWNER INFO*',
        `NAME: ${safeText(process.env.OWNER_NAME || 'Saitama Tech', 80)}`,
        appConfig.ownerNumber ? `WHATSAPP: wa.me/${appConfig.ownerNumber}` : 'WHATSAPP: NOT CONFIGURED',
        'ROLE: BOT OWNER',
      ].join('\n'),
    };
    case 'ping': case 'ping2': case 'ping3': return { text: `Pong. Message processing took ${latency} ms.` };
    case 'alive': case 'runtime': case 'uptime': return { text: `*${appConfig.botName} is running*\nProcess uptime: ${fmtDuration(Math.floor((Date.now() - startedAt) / 1000))}\nSession: ${sock.user?.id ? 'connected' : 'reconnecting'}` };
    case 'channel': return { text: appConfig.channelUrl ? 'Open the official channel using the WhatsApp button below.' : 'The official WhatsApp channel is not configured.' };
    case 'jid': return { text: `Chat JID: ${jid}` };
    case 'idch': return { text: `Chat ID: ${jid}` };
    case 'pair': return { text: 'Open the SAITAMA BOT dashboard, choose Connect WhatsApp, and enter your number to request a pairing code. Never share your code with anyone.' };
    case 'emojiencrypt': {
      if (!argText) return { text: 'Usage: .emojiencrypt <text>.' };
      const bytes = Buffer.from(safeText(argText, 400), 'utf8');
      if (Buffer.byteLength(argText, 'utf8') > 400) return { text: 'Keep the text to 400 UTF-8 bytes or fewer.' };
      const encoded = [...bytes.toString('hex')].map((digit) => emojiDigits[Number.parseInt(digit, 16)]).join('');
      return { text: encoded };
    }
    case 'emojidecrypt': {
      if (!argText) return { text: 'Usage: .emojidecrypt <emoji sequence>.' };
      const symbols = [...argText.replace(/\s/g, '')];
      if (!symbols.length || symbols.length % 2 !== 0 || symbols.length > 800) {
        return { text: 'Provide an even-length emoji sequence from .emojiencrypt (up to 400 UTF-8 bytes).' };
      }
      const values = symbols.map((emoji) => emojiDigitValues.get(emoji));
      if (values.some((value) => value === undefined)) return { text: 'That sequence contains an unsupported emoji.' };
      const hex = values.map((value) => value.toString(16)).join('');
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(hex, 'hex')) };
      } catch {
        return { text: 'That emoji sequence does not contain valid encoded text.' };
      }
    }
    case 'sciencefact': return { text: `🔬 ${scienceFacts[crypto.randomInt(scienceFacts.length)]}` };
    case 'ai': case 'gpt': {
      if (!argText) return { text: `Usage: .${command} <question>` };
      return { text: await openAi(argText) };
    }
    case 'shortdagd': case 'shortrandom': case 'shortspoo': case 'shortspooemoji': case 'shorttinub': case 'shortvgd': {
      let source;
      try { source = new URL(argText); } catch { return { text: 'Usage: .shortspoo https://example.com — provide a valid URL.' }; }
      if (!['http:','https:'].includes(source.protocol) || source.username || source.password) return { text: 'Only public HTTP(S) URLs without embedded credentials are accepted.' };
      if(!(await isSafePublicUrl(source))) return { text:'Private, local, reserved, or unresolvable hostnames cannot be shortened.' };
      const endpoint = process.env.SHORTENER_API_URL || 'https://cleanuri.com/api/v1/shorten';
      try {
        const target = new URL(endpoint);
        if (target.protocol !== 'https:' || !(await isSafePublicUrl(target))) return { text: 'Shortener endpoint configuration is unsafe; ask the server owner to review it.' };
        const res = await fetch(target, { method:'POST', signal:timeoutSignal(), headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({url:source.href}) });
        const data = await res.json().catch(()=>({}));
        if (!res.ok || !(data.result_url || data.url)) return { text:'The shortening service could not create a link right now.' };
        return { text:`Shortened URL: ${data.result_url || data.url}` };
      } catch { return { text:'The shortening service is unavailable.' }; }
    }
    case 'moviesearch': case 'moviesearch2': case 'tmdb': {
      if (!argText) return { text:`Usage: .${command} <movie title>` };
      const data = await tmdb('search/movie', { query: safeText(argText, 100), include_adult: 'false' });
      if (data.error) return { text:data.error };
      const results = (data.results || []).slice(0, 5);
      if (!results.length) return { text:'No matching films found.' };
      return { text:results.map((movie,i)=>`${i+1}. *${safeText(movie.title,120)}* (${movie.release_date?.slice(0,4)||'year unknown'})\nRating: ${movie.vote_average ?? 'n/a'}/10 · TMDB ID: ${movie.id}\n${safeText(movie.overview || 'No summary available.',350)}`).join('\n\n') };
    }
    case 'moviedetail': {
      const id = Number(argText);
      if (!Number.isSafeInteger(id) || id < 1) return { text:'Usage: .moviedetail <TMDB numeric id>' };
      const data = await tmdb(`movie/${id}`);
      if (data.error) return { text:data.error };
      return { text:`*${safeText(data.title,120)}* (${data.release_date?.slice(0,4)||'unknown'})\nRating: ${data.vote_average ?? 'n/a'}/10\nRuntime: ${data.runtime ? `${data.runtime} min` : 'unknown'}\nGenres: ${(data.genres||[]).map(g=>safeText(g.name,40)).join(', ')||'unknown'}\n\n${safeText(data.overview || 'No synopsis available.',900)}` };
    }
    case 'coin': return { text:`🪙 ${crypto.randomInt(0,2) ? 'Heads' : 'Tails'}` };
    case 'dice': return { text:`🎲 You rolled ${crypto.randomInt(1,7)}.` };
    case 'guess': {
      const key=chatKey(userId,jid); const state=games.get(key);
      if (!argText) { const secret=crypto.randomInt(1,21); games.set(key,{secret,expires:Date.now()+5*60_000}); return { text:'I picked a number from 1 to 20. Reply with .guess <number>. You have 5 minutes.' }; }
      if (!/^(?:[1-9]|1\d|20)$/.test(argText)) return { text:'Enter a whole number from 1 to 20.' };
      if (!state || state.expires < Date.now()) { games.delete(key); return { text:'No active game. Send .guess to start one.' }; }
      const n=Number(argText); if(n===state.secret){games.delete(key);return {text:'Correct. You got it.'};}
      return { text:n<state.secret?'Too low. Try again.':'Too high. Try again.' };
    }
    case 'math': case 'calculate': {
      if (!argText) return { text:`Usage: .${command} <expression>, e.g. .${command} sqrt(81) + 4^2` };
      try { return { text:`Result: ${parseSafeExpression(argText)}` }; } catch (error) { return { text:error.message || 'Could not evaluate that expression.' }; }
    }
    case 'rps': {
      const choices=['rock','paper','scissors']; const user=argText.toLowerCase();
      if (!choices.includes(user)) return { text:'Usage: .rps <rock|paper|scissors>' };
      const bot=choices[crypto.randomInt(0,3)]; const outcome=user===bot?'Tie.':((user==='rock'&&bot==='scissors')||(user==='paper'&&bot==='rock')||(user==='scissors'&&bot==='paper')?'You win.':'I win.');
      return { text:`You: ${user}\nBot: ${bot}\n${outcome}` };
    }
    case 'time': {
      const zone=argText || 'UTC';
      try { return { text:`${zone}: ${new Intl.DateTimeFormat('en', { dateStyle:'full', timeStyle:'long', timeZone:zone }).format(new Date())}` }; }
      catch { return { text:'Use a valid IANA time zone, e.g. Africa/Lagos.' }; }
    }
    case 'weather': {
      if (!argText) return { text:'Usage: .weather <city>' };
      if (!process.env.WEATHER_API_KEY) return { text:'Weather is not configured. Set WEATHER_API_KEY on the server.' };
      const url=new URL('https://api.openweathermap.org/data/2.5/weather'); url.searchParams.set('q',safeText(argText,100)); url.searchParams.set('appid',process.env.WEATHER_API_KEY); url.searchParams.set('units','metric');
      try { const res=await fetch(url,{signal:timeoutSignal()}); const data=await res.json(); if(!res.ok) return {text:res.status===404?'City not found.':'Weather provider request failed.'}; return {text:`*${safeText(data.name,80)}, ${safeText(data.sys?.country||'',8)}*\n${safeText(data.weather?.[0]?.description||'Current conditions',100)}\nTemperature: ${Math.round(data.main.temp)}°C (feels like ${Math.round(data.main.feels_like)}°C)\nHumidity: ${data.main.humidity}% · Wind: ${data.wind.speed} m/s`}; }
      catch{return {text:'Weather provider is temporarily unavailable.'};}
    }
    case 'genpass': {
      const length=argText ? Number(argText) : 20;
      if(!Number.isInteger(length)||length<12||length>64) return {text:'Usage: .genpass [length 12–64].'};
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
      return {text:`Generated password (${length} characters):\n${Array.from({length},()=>alphabet[crypto.randomInt(alphabet.length)]).join('')}`};
    }
    case 'qrcode': {
      if(!argText) return {text:'Usage: .qrcode <text or URL>.'};
      try { const image=await QRCode.toBuffer(safeText(argText,1000),{type:'png',width:640,margin:2}); return {text:'QR code generated:',image}; }
      catch{return {text:'Could not encode that content as a QR code.'};}
    }
    case 'groupinfo': case 'listadmin': case 'grouplink': case 'open': case 'close': case 'promote': case 'demote': case 'kick': case 'tagall': case 'hidetag': case 'setnamegc': case 'setdesc': {
      if(!isGroup(jid)) return {text:`.${command} can only be used in a WhatsApp group.`};
      let info; try { info=await participantInfo(sock,jid,senderJid); } catch { return {text:'Could not read group metadata. Try again later.'}; }
      if(command==='groupinfo') return {text:`*${safeText(info.group.subject,120)}*\nParticipants: ${info.group.participants.length}\nCreated: ${info.group.creation ? new Date(info.group.creation*1000).toLocaleString() : 'unknown'}\nDescription: ${safeText(info.group.desc||'No description',500)}`};
      if(command==='listadmin') { const admins=info.group.participants.filter(p=>p.admin); return {text:`*Group admins (${admins.length})*\n${admins.map((p,i)=>`${i+1}. @${parseDigits(p.id)}`).join('\n')||'None'}`,mentions:admins.map(p=>p.id)}; }
      if(command==='grouplink') {
        if(!info.callerIsAdmin) return {text:'Only group admins can retrieve an invite link.'};
        if(!info.botIsAdmin) return {text:'The bot must be a group admin to retrieve the invite link.'};
        try { const code=await sock.groupInviteCode(jid); return {text:`Group invite link: https://chat.whatsapp.com/${code}`}; } catch {return {text:'Could not retrieve the group invite link.'};}
      }
      if(!info.callerIsAdmin) return {text:'Only group admins can use this action.'};
      if(['open','close','promote','demote','kick','setnamegc','setdesc'].includes(command) && !info.botIsAdmin) return {text:'The bot must be a group admin to perform this action.'};
      try {
        if(command==='open'||command==='close') { await sock.groupSettingUpdate(jid,command==='open'?'not_announcement':'announcement'); return {text:command==='open'?'Group is open to all participants.':'Group is now admin-only.'}; }
        if(command==='setnamegc'||command==='setdesc') {
          if(!argText) return {text:`Usage: .${command} <${command==='setnamegc'?'title':'description'}>`};
          if(command==='setnamegc') await sock.groupUpdateSubject(jid,safeText(argText,100)); else await sock.groupUpdateDescription(jid,safeText(argText,2048));
          return {text:command==='setnamegc'?'Group name updated.':'Group description updated.'};
        }
        const mentions=mentionedJids(message,argText,info.group.participants);
        if(command==='tagall'||command==='hidetag') {
          const all=info.group.participants.map(p=>p.id);
          return {text:`${safeText(argText,400)||'Attention everyone'}`,mentions:all,withoutPrefix:true};
        }
        if(!mentions.length) return {text:`Mention at least one participant. Usage: .${command} @member`};
        const isProtected=(id)=>info.admins.has(id)&&command==='kick';
        if(mentions.some(isProtected)) return {text:'Cannot kick a group admin.'};
        const result=await sock.groupParticipantsUpdate(jid,mentions,command==='promote'?'promote':command==='demote'?'demote':'remove');
        const failed=result.filter(r=>r.status && r.status!=='200');
        return {text:failed.length?`Action completed with ${failed.length} participant update(s) rejected by WhatsApp.`:`${command[0].toUpperCase()+command.slice(1)} action completed for ${mentions.length} participant(s).`};
      } catch(error) { logger.warn('Group command failed',{command,reason:error.name}); return {text:'WhatsApp rejected the group action. Check the bot’s role and try again.'}; }
    }
    default: return { text:'This command is not available yet.' };
  }
}

export async function processIncomingMessage({ sock, userId, message, io }) {
  const jid=message.key?.remoteJid;
  if(!jid || jid==='status@broadcast' || message.key?.fromMe && !sock.user?.id) return;
  const raw=getText(message).trim();
  if(!raw) return;
  const db=getPool();
  await db.query('UPDATE bot_statistics SET messages_received=messages_received+1,last_activity_at=now() WHERE user_id=$1',[userId]).catch(()=>{});
  const settings=await db.query('SELECT prefix FROM user_settings WHERE user_id=$1',[userId]);
  const prefix=settings.rows[0]?.prefix || appConfig.prefix;
  const senderJid=message.key.fromMe ? sock.user?.id : message.key.participant || message.key.remoteJid;

  if(!raw.startsWith(prefix)) {
    // Exact-match auto-replies are opt-in and stored per account.
    const reply=await db.query('SELECT response FROM auto_replies WHERE user_id=$1 AND enabled=true AND lower(trigger)=lower($2) LIMIT 1',[userId,safeText(raw,120)]).catch(()=>({rows:[]}));
    if(reply.rows[0]) await sendCommandResponse(sock,jid,reply.rows[0].response);
    return;
  }
  const [commandRaw,...args]=raw.slice(prefix.length).trim().split(/\s+/);
  const command=(commandRaw||'').toLowerCase();
  if(!command) return;
  await reactToCommand(sock,jid,message);
  const now=Date.now();
  const rateKey=userId;
  let bucket=commandBuckets.get(rateKey);
  if(!bucket||now-bucket.startedAt>=60_000){bucket={startedAt:now,count:0,aiCount:0};commandBuckets.set(rateKey,bucket);}
  bucket.count++;
  if(command==='ai'||command==='gpt')bucket.aiCount++;
  if(++callsSinceSweep%200===0){for(const [key,value] of commandBuckets)if(now-value.startedAt>5*60_000)commandBuckets.delete(key);}
  if(bucket.count>24 || bucket.aiCount>5){
    await sendCommandResponse(sock,jid,bucket.aiCount>5?'AI command limit reached. Wait a minute before trying again.':'Command rate limit reached. Wait a minute before trying again.');
    return;
  }
  const started=Date.now();
  let output;
  try { output=await executeCommand({sock,userId,jid,senderJid,message,command,args,prefix,startedAt:started}); }
  catch(error) { logger.error('Command handler error',{command,reason:error.name}); output={text:'The command failed unexpectedly. Please try again later.'}; }
  const record=catalog.find(c=>c.name===`.${command}`);
  const isKnown=Boolean(record);
  if(!isKnown) output={text:formatUnknownCommand(command,prefix)};
  else if(output.text?.startsWith('Usage:')) output.text=formatCommandUsage(record,prefix);
  const elapsed=Date.now()-started;
  const category=record?.category || 'Unknown';
  const succeeded=record?.status==='implemented'&&!/not configured|temporarily unavailable|request failed|could not/i.test(output.text||'');
  await db.query('INSERT INTO command_usage(user_id,command,category,succeeded,duration_ms) VALUES($1,$2,$3,$4,$5)',[userId,command,category,succeeded,elapsed]).catch(()=>{});
  await db.query('UPDATE bot_statistics SET commands_executed=commands_executed+1,last_activity_at=now() WHERE user_id=$1',[userId]).catch(()=>{});
  await sendCommandResponse(sock,jid,output.text||'Done.',{
    image:output.image,
    mentions:output.mentions,
    withoutPrefix:output.withoutPrefix,
    channelAction: command === 'menu' || command === 'channel',
  });
  io?.to(`user:${userId}`).emit('command:activity',{command,category,at:new Date().toISOString()});
}

export async function sendCommandResponse(sock,jid,result,{image,mentions,withoutPrefix=false,channelAction=false}={}) {
  let body=safeText(result,3500);
  if (channelAction) {
    try {
      await sendNewsletterPost(sock, jid);
    } catch (error) {
      logger.warn('WhatsApp channel post forwarding failed', {
        postId: appConfig.channelPostId || 'unset',
        reason: error.message,
      });
      body = `${body}\n\nThe configured channel post could not be loaded right now.`;
    }
  }
  const formatted=withoutPrefix ? `${body}\n\n━━━━━━━━━━━━━━━━━━\n⚡ POWERED BY SAITAMA TECH\n━━━━━━━━━━━━━━━━━━` : `━━━━━━━━━━━━━━━━━━\n🔥 SAITAMA BOT\n━━━━━━━━━━━━━━━━━━\n\n${body}\n\n━━━━━━━━━━━━━━━━━━\n⚡ POWERED BY SAITAMA TECH\n━━━━━━━━━━━━━━━━━━`;
  const premiumFormatted = stylePremiumText(formatted);
  if(image) {
    const caption = premiumFormatted.length > 900 ? '🔥 SAITAMA BOT' : premiumFormatted;
    await sock.sendMessage(jid,{image,caption,mentions});
    if(caption !== premiumFormatted) await sock.sendMessage(jid,{text:premiumFormatted,mentions});
  } else await sock.sendMessage(jid,{text:premiumFormatted,mentions});
}
