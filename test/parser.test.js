import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, slugify } from '../src/parser.js';

test('slugify strips .md and returns basename', () => {
  assert.equal(slugify('/foo/bar/memory-2026-07-21-1701.md'), 'memory-2026-07-21-1701');
  assert.equal(slugify('/foo/2026-07-21.md'), '2026-07-21');
});

test('parseFile: entry lines produce content + entryType + ts quads', () => {
  const content = `# Header

[16:44 WIB] [wallet] Created main_evm | address 0xabc | vault ~/.hermes/vault.enc

[16:50 WIB] [note] Notion free enterprise trick
`;
  const { quads, entryCount } = parseFile('/tmp/test.md', content, 1000, 100);
  assert.equal(entryCount, 2);
  const contents = quads.filter(q => q.predicate === 'urn:openclaw:pred:content').map(q => q.object);
  assert.ok(contents.some(c => c.includes('Created main_evm')));
  assert.ok(contents.some(c => c.includes('Notion free enterprise trick')));
  const types = quads.filter(q => q.predicate === 'urn:openclaw:pred:entryType').map(q => q.object);
  assert.ok(types.includes('wallet'));
  assert.ok(types.includes('note'));
});

test('parseFile: subjects use urn:openclaw:memory: prefix (never urn:dkg:file)', () => {
  const { quads } = parseFile('/tmp/x.md', 'hello world', 1000, 11);
  for (const q of quads) {
    assert.ok(q.subject.startsWith('urn:openclaw:memory:'), 'bad subject: ' + q.subject);
    assert.ok(!q.subject.startsWith('urn:dkg:file:'));
    assert.ok(!q.subject.startsWith('urn:dkg:extraction:'));
  }
});

test('parseFile: no per-quad graph field', () => {
  const { quads } = parseFile('/tmp/x.md', 'hello', 1000, 5);
  for (const q of quads) {
    assert.equal(q.graph, undefined);
    assert.deepEqual(Object.keys(q).sort(), ['object', 'predicate', 'subject']);
  }
});

test('parseFile: provenance quads include sourceFile, ingestedAt, sourceMtime, sourceSize, statusTag, referenceCount', () => {
  const { quads } = parseFile('/tmp/abc.md', 'hello', 12345, 5);
  const fileSubj = 'urn:openclaw:memory:abc';
  const preds = quads.filter(q => q.subject === fileSubj).map(q => q.predicate);
  for (const p of ['urn:openclaw:pred:sourceFile', 'urn:openclaw:pred:ingestedAt',
                    'urn:openclaw:pred:sourceMtime', 'urn:openclaw:pred:sourceSize',
                    'urn:openclaw:pred:statusTag', 'urn:openclaw:pred:referenceCount']) {
    assert.ok(preds.includes(p), 'missing pred: ' + p);
  }
  const sizeQ = quads.find(q => q.subject === fileSubj && q.predicate === 'urn:openclaw:pred:sourceSize');
  assert.equal(sizeQ.object, '5');
});

test('parseFile: share: frontmatter sets shareTag', () => {
  const content = `---
share: true
---
# Body
hello
`;
  const { quads, shareTag } = parseFile('/tmp/x.md', content, 1000, 5);
  assert.equal(shareTag, true);
  const st = quads.find(q => q.predicate === 'urn:openclaw:pred:shareTag');
  assert.ok(st);
  assert.equal(st.object, 'true');
});

test('parseFile: empty file produces only provenance quads', () => {
  const { quads, entryCount } = parseFile('/tmp/empty.md', '', 1000, 0);
  assert.equal(entryCount, 0);
  assert.ok(quads.length >= 6); // provenance only
});
