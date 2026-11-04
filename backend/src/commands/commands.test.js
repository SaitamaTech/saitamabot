import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from './catalog.json' with { type: 'json' };
import { isSafePublicUrl, parseSafeExpression } from './handlers.js';
import { transformText } from './textStyles.js';

test('catalog includes all requested commands and labels non-handled entries honestly', () => {
  assert.ok(catalog.length > 250);
  assert.ok(catalog.some((c) => c.name === '.pair' && c.status === 'implemented'));
  assert.ok(catalog.some((c) => c.name === '.compilepython' && c.status === 'not_implemented'));
  assert.ok(catalog.every((c) => c.description && c.usage && c.permission && c.status));
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
