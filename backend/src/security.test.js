import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptJson, encryptJson } from './config.js';

test('encrypted session envelopes hide credentials and detect tampering', () => {
  const original = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('hex');
  try {
    const payload = { creds: { privateKey: 'sample-private-value' }, keys: { identity: [1,2,3] } };
    const envelope = encryptJson(payload);
    assert.equal(envelope.includes('sample-private-value'), false);
    assert.deepEqual(decryptJson(envelope), payload);
    const decoded = JSON.parse(envelope);
    decoded.data = `${decoded.data.slice(0,-4)}AAAA`;
    assert.throws(() => decryptJson(JSON.stringify(decoded)));
  } finally {
    if (original === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = original;
  }
});
