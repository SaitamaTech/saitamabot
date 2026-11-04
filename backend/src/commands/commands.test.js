import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from './catalog.json' with { type: 'json' };
import { findCommandSuggestion, formatActiveCommandMenu, formatCommandUsage, formatUnknownCommand } from './catalog.js';
import { executeCommand, isSafePublicUrl, parseSafeExpression, reactToCommand, sendCommandResponse } from './handlers.js';
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
  assert.match(menu, /├─〔 CORE COMMANDS 〕\*\n│ !menu\n│ !owner/);
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

test('menu command includes the supplied display image and sends long menu text separately', async () => {
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
  await sendCommandResponse({ sendMessage: async (jid, payload) => sent.push({ jid, payload }) }, 'menu-test@s.whatsapp.net', result.text, { image: result.image });

  assert.ok(Buffer.isBuffer(result.image));
  assert.ok(result.image.length > 100_000);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.image, result.image);
  assert.ok(sent[0].payload.caption.length <= 900);
  assert.match(sent[1].payload.text, /CORE COMMANDS/);
  assert.match(sent[1].payload.text, /GROUP MANAGEMENT/);
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
