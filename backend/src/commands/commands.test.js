import test from 'node:test';
import assert from 'node:assert/strict';
import { proto } from '@whiskeysockets/baileys';
import { appConfig } from '../config.js';
import catalog from './catalog.json' with { type: 'json' };
import { findCommandSuggestion, formatActiveCommandMenu, formatCommandUsage, formatUnknownCommand } from './catalog.js';
import { executeCommand, isSafePublicUrl, parseSafeExpression, reactToCommand, sendCommandResponse, stylePremiumText } from './handlers.js';
import { transformText } from './textStyles.js';

test('catalog includes all requested commands and labels non-handled entries honestly', () => {
  assert.ok(catalog.length > 250);
  assert.ok(catalog.some((c) => c.name === '.pair' && c.status === 'implemented'));
  assert.ok(catalog.some((c) => c.name === '.compilepython' && c.status === 'not_implemented'));
  assert.ok(catalog.every((c) => c.description && c.usage && c.permission && c.status));
});

test('active command menu is grouped and uses the account prefix', () => {
  const menu = formatActiveCommandMenu({ botName: 'Test Bot', prefix: '!', uptime: '2h 5m' });

  assert.match(menu, /INFO BOT/);
  assert.match(menu, /Name: Test Bot/);
  assert.match(menu, /Prefix: !/);
  assert.match(menu, /Uptime: 2h 5m/);
  assert.match(menu, /├─〔 CORE COMMANDS 〕\*\n│ • !menu\n│ • !owner/);
  assert.match(menu, /├─〔 AI COMMANDS 〕/);
  assert.doesNotMatch(menu, /├─〔 SPORTS 〕/);
  assert.doesNotMatch(menu, /\.menu/);
});

test('command help suggests likely typos and shows the configured prefix and usage', () => {
  assert.equal(findCommandSuggestion('pign')?.name, '.ping');
  assert.match(formatUnknownCommand('pign', '!'), /Did you mean !ping\?/);
  assert.match(formatUnknownCommand('pign', '!'), /How to use: !ping/);
  assert.match(formatUnknownCommand('compilepythn', '!'), /!compilepython, but it is not available yet/);
  assert.match(formatUnknownCommand('zzzzzzzzzzzz'), /Send \.menu/);
  assert.equal(
    formatCommandUsage(catalog.find((entry) => entry.name === '.ai'), '!'),
    'How to use: !ai <question>\nWhat it does: Ask the configured OpenAI-compatible provider a question.',
  );
});

test('premium reply typography preserves URLs, phone links, command syntax, and whitespace', () => {
  const styled = stylePremiumText('hello\nUse .menu or .ai <question>\nwa.me/2348089034026 https://whatsapp.com/channel/test');

  assert.match(styled, /𝐇𝐄𝐋𝐋𝐎/);
  assert.match(styled, /\n𝐔𝐒𝐄 \.menu 𝐎𝐑 \.ai <𝐐𝐔𝐄𝐒𝐓𝐈𝐎𝐍>/);
  assert.match(styled, /wa\.me\/2348089034026/);
  assert.match(styled, /https:\/\/whatsapp\.com\/channel\/test/);
});

test('menu command uses channel context without reattaching the local wallpaper', async () => {
  const result = await executeCommand({
    sock: {},
    userId: 'menu-test',
    jid: 'menu-test@s.whatsapp.net',
    senderJid: 'menu-test@s.whatsapp.net',
    message: {},
    command: 'menu',
    args: [],
    prefix: '!',
    startedAt: Date.now(),
  });
  const sent = [];
  const newsletterLookups = [];
  const post = proto.WebMessageInfo.encode({
    key: { remoteJid: '120363012345678901@newsletter', id: 'newsletter-message-key', fromMe: false },
    message: { imageMessage: { caption: 'Channel post image', mimetype: 'image/jpeg' } },
    messageTimestamp: 1,
  }).finish();
  const sock = {
    newsletterMetadata: async (...args) => {
      newsletterLookups.push(args);
      return { id: '120363012345678901@newsletter', name: 'Saitama Updates' };
    },
    newsletterFetchMessages: async (...args) => {
      newsletterLookups.push(args);
      return { tag: 'iq', attrs: {}, content: [{ tag: 'message', attrs: { server_id: String(appConfig.channelPostId) }, content: post }] };
    },
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };
  await sendCommandResponse(sock, 'menu-test@s.whatsapp.net', result.text, { channelAction: true });

  assert.equal(result.image, undefined);
  assert.equal(sent.length, 2);
  assert.deepEqual(newsletterLookups, [
    ['invite', '0029VbEKwbnCXC3EkbjtEW0f'],
    ['120363012345678901@newsletter', 100, 0, Number(appConfig.channelPostId) - 1],
  ]);
  assert.equal(sent[0].payload.forward.message.imageMessage.caption, 'Channel post image');
  assert.equal(sent[0].payload.contextInfo.forwardedNewsletterMessageInfo.newsletterJid, '120363012345678901@newsletter');
  assert.equal(sent[0].payload.contextInfo.forwardedNewsletterMessageInfo.newsletterName, 'Saitama Updates');
  assert.equal(sent[0].payload.contextInfo.forwardedNewsletterMessageInfo.serverMessageId, Number(appConfig.channelPostId));
  assert.match(sent[1].payload.text, /• !menu/);
  assert.doesNotMatch(sent[1].payload.text, /https:\/\/whatsapp\.com\/channel/);
});

test('ordinary command replies do not fetch or attach channel post metadata', async () => {
  const sent = [];
  let lookups = 0;
  const sock = {
    newsletterMetadata: async (type, inviteCode) => {
      lookups += 1;
      assert.equal(type, 'invite');
      assert.equal(inviteCode, '0029VbEKwbnCXC3EkbjtEW0f');
      return { id: '120363012345678901@newsletter', name: 'Saitama Updates' };
    },
    newsletterFetchMessages: async () => {
      lookups += 1;
      throw new Error('ordinary replies must not fetch channel posts');
    },
    sendMessage: async (jid, payload) => sent.push(payload),
  };

  await sendCommandResponse(sock, 'user@s.whatsapp.net', 'Pong.');
  await sendCommandResponse(sock, 'user@s.whatsapp.net', 'Alive.', { channelAction: false });

  assert.equal(lookups, 0);
  assert.equal(sent.length, 2);
  for (const payload of sent) {
    assert.equal(payload.contextInfo, undefined);
    assert.doesNotMatch(payload.text, /https:\/\/whatsapp\.com\/channel/);
  }
});

test('channel command forwards the configured real channel post', async () => {
  const sent = [];
  const post = proto.Message.encode({ conversation: 'Actual channel post' }).finish();
  const sock = {
    newsletterMetadata: async () => ({ id: '120363012345678901@newsletter', name: 'Saitama Updates' }),
    newsletterFetchMessages: async () => ({
      tag: 'iq',
      attrs: {},
      content: [{
        tag: 'messages',
        attrs: {},
        content: [{
          tag: 'message',
          attrs: { message_id: 'newsletter-message-key', server_id: String(appConfig.channelPostId), t: '1' },
          content: [{ tag: 'plaintext', attrs: {}, content: post }],
        }],
      }],
    }),
    sendMessage: async (jid, payload) => sent.push(payload),
  };
  await sendCommandResponse(sock, 'user@s.whatsapp.net', 'Open the official channel.', { channelAction: true });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].forward.message.conversation, 'Actual channel post');
  assert.equal(sent[0].contextInfo.forwardedNewsletterMessageInfo.serverMessageId, Number(appConfig.channelPostId));
});

test('missing channel post sends no fabricated attribution and explains the fallback', async () => {
  const sent = [];
  const sock = {
    newsletterMetadata: async () => ({ id: '120363012345678901@newsletter', name: 'Saitama Updates' }),
    newsletterFetchMessages: async () => ({ tag: 'iq', attrs: {}, content: [] }),
    sendMessage: async (jid, payload) => sent.push(payload),
  };
  await sendCommandResponse(sock, 'user@s.whatsapp.net', 'Open the official channel.', { channelAction: true });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].contextInfo, undefined);
  assert.match(sent[0].text, /𝐂𝐎𝐍𝐅𝐈𝐆𝐔𝐑𝐄𝐃 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 𝐏𝐎𝐒𝐓 𝐂𝐎𝐔𝐋𝐃 𝐍𝐎𝐓 𝐁𝐄 𝐋𝐎𝐀𝐃𝐄𝐃/);
});

test('owner command shows the configured WhatsApp contact as a wa.me link', async () => {
  const result = await executeCommand({
    sock: {},
    userId: 'owner-test',
    jid: 'owner-test@s.whatsapp.net',
    senderJid: 'owner-test@s.whatsapp.net',
    message: {},
    command: 'owner',
    args: [],
    startedAt: Date.now(),
  });

  assert.ok(result.text.includes(`wa.me/${appConfig.ownerNumber}`));
});

test('recognized and unknown commands can be acknowledged with a reaction', async () => {
  const sent = [];
  const message = { key: { id: 'command-1', remoteJid: 'user@s.whatsapp.net' } };
  await reactToCommand({ sendMessage: async (jid, payload) => sent.push({ jid, payload }) }, message.key.remoteJid, message);

  assert.deepEqual(sent, [{
    jid: message.key.remoteJid,
    payload: { react: { text: '⚡', key: message.key } },
  }]);

  await assert.doesNotReject(() => reactToCommand({ sendMessage: async () => { throw new Error('offline'); } }, message.key.remoteJid, message));
});

test('new local utilities are registered and work without external credentials', async () => {
  const command = async (name, args = [], message = {}) => executeCommand({
    sock: {},
    userId: 'utility-test',
    jid: 'utility-test@g.us',
    senderJid: 'utility-test@s.whatsapp.net',
    message,
    command: name,
    args,
    startedAt: Date.now(),
  });

  const original = 'Hello,  Saitama!\n👋';
  const encoded = await command('emojiencrypt', ['Hello,', 'Saitama!', '👋'], {
    message: { conversation: `.emojiencrypt ${original}` },
  });
  assert.ok([...encoded.text].every((emoji) => '😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗'.includes(emoji)));
  assert.deepEqual(await command('emojidecrypt', [encoded.text], {
    message: { conversation: `.emojidecrypt ${encoded.text}` },
  }), { text: original });
  assert.match((await command('emojidecrypt', ['not emoji'])).text, /unsupported emoji|even-length/i);
  assert.equal((await command('fullwidth', ['A', 'B'], {
    message: { conversation: '.fullwidth A   B' },
  })).text, 'Ａ\u3000\u3000\u3000Ｂ');
  assert.match((await command('idch')).text, /utility-test@g\.us/);
  assert.match((await command('sciencefact')).text, /^🔬 /);
  assert.match((await command('tqto')).text, /Thanks for using/);

  for (const name of ['.tqto', '.emojiencrypt', '.emojidecrypt', '.idch', '.sciencefact']) {
    assert.equal(catalog.find((entry) => entry.name === name)?.status, 'implemented');
  }
});

test('text converters preserve spaces and transform basic input', () => {
  assert.equal(transformText('.fullwidth', 'A B'), 'Ａ　Ｂ');
  assert.equal(transformText('.smallcaps', 'bot'), 'ʙᴏᴛ');
  assert.equal(transformText('.mathbold', 'Hi'), '𝐇𝐢');
  assert.equal(transformText('.tagstyle', 'hello'), '『 hello 』');
});

test('calculator evaluates arithmetic without JavaScript execution', () => {
  assert.equal(parseSafeExpression('sqrt(81) + 4^2'), '25');
  assert.equal(parseSafeExpression('2 * (3 + 4)'), '14');
  assert.throws(() => parseSafeExpression('process.exit()'));
  assert.throws(() => parseSafeExpression('1/0'));
});

test('public URL guard rejects private and unsafe shortener targets', async () => {
  assert.equal(await isSafePublicUrl('http://127.0.0.1'), false);
  assert.equal(await isSafePublicUrl('http://10.0.0.8/path'), false);
  assert.equal(await isSafePublicUrl('http://[::1]/'), false);
  assert.equal(await isSafePublicUrl('https://user:pass@example.com/'), false);
  assert.equal(await isSafePublicUrl('file:///etc/passwd'), false);
  assert.equal(await isSafePublicUrl('http://8.8.8.8'), true);
});
