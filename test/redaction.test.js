import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactQuads } from '../src/redaction.js';

test('redact: 0x-prefixed 64-char hex -> [REDACTED:hex-private-key]', () => {
  const key = '0x' + 'a'.repeat(64);
  const { text, count } = redact(`my key is ${key} ok`);
  assert.equal(count, 1);
  assert.ok(text.includes('[REDACTED:hex-private-key]'));
  assert.ok(!text.includes(key));
});

test('redact: sk- API token prefix', () => {
  const { text, count } = redact(`here is sk-354a0605032eb611-4qmkz1-bed717a9 done`);
  assert.ok(count >= 1);
  assert.ok(text.includes('[REDACTED:api-token]'));
  assert.ok(!text.includes('sk-354a0605032eb611'));
});

test('redact: ghp_ GitHub token', () => {
  const { text, count } = redact(`ghp_ABCDEFGHIJKLMNOPQRSTa`);
  assert.equal(count, 1);
  assert.ok(text.includes('[REDACTED:api-token]'));
});

test('redact: private_key= line', () => {
  const { text, count } = redact(`private_key: abcdef1234567890`);
  assert.equal(count, 1);
  assert.ok(text.includes('[REDACTED:secret-line]'));
});

test('redact: mnemonic= line', () => {
  const { text, count } = redact(`mnemonic=abandon ability able about above`);
  assert.equal(count, 1);
  assert.ok(text.includes('[REDACTED:secret-line]'));
});

test('redact: no false positive on normal text', () => {
  const { text, count } = redact(`hello world, this is a normal note about nothing sensitive`);
  assert.equal(count, 0);
  assert.equal(text, `hello world, this is a normal note about nothing sensitive`);
});

test('redact: empty string', () => {
  const { text, count } = redact('');
  assert.equal(count, 0);
  assert.equal(text, '');
});

test('redactQuads: redacts object field only, preserves subject/predicate', () => {
  const quads = [
    { subject: 'urn:openclaw:memory:x:0', predicate: 'urn:openclaw:pred:content', object: 'key=0x' + 'b'.repeat(64) },
    { subject: 'urn:openclaw:memory:x:1', predicate: 'urn:openclaw:pred:entryType', object: 'note' },
  ];
  const { quads: out, redactedCount } = redactQuads(quads);
  assert.equal(redactedCount, 1);
  assert.equal(out[0].subject, quads[0].subject);
  assert.equal(out[0].predicate, quads[0].predicate);
  assert.ok(out[0].object.includes('[REDACTED:hex-private-key]'));
  assert.equal(out[1].object, 'note');
});

test('redactQuads: output quads have no graph field', () => {
  const { quads } = redactQuads([
    { subject: 's', predicate: 'p', object: '0x' + 'c'.repeat(64) },
  ]);
  assert.equal(quads[0].graph, undefined);
});
