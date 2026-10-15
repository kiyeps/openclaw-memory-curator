import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeKaSequence } from '../src/ka-writer.js';

function stubClient({ failOnWrite = null, failOnCreate = false, failOnDiscard = null } = {}) {
  const calls = [];
  return {
    calls,
    async createKA(name, quads) {
      calls.push(['createKA', name, quads.length]);
      if (failOnCreate) throw new Error('create failed');
      return { status: 'draft-open' };
    },
    async wmWrite(name, quads) {
      calls.push(['wmWrite', name, quads.length]);
      if (failOnWrite !== null && calls.filter(c => c[0] === 'wmWrite').length === failOnWrite) {
        throw new Error('write failed');
      }
      return { ok: true };
    },
    async wmFinalize(name) {
      calls.push(['wmFinalize', name]);
      return { status: 'wm-sealed' };
    },
    async wmDiscard(name) {
      calls.push(['wmDiscard', name]);
      if (failOnDiscard) throw new Error(failOnDiscard);
      return { discarded: true };
    },
  };
}

const B = [[{ s: 1 }], [{ s: 2 }]];

test('writeKaSequence: happy path is create -> write x2 -> finalize, no discard', async () => {
  const dkg = stubClient();
  const res = await writeKaSequence(dkg, 'slug-a', B);
  assert.deepEqual(dkg.calls.map(c => c[0]), ['createKA', 'wmWrite', 'wmWrite', 'wmFinalize']);
  assert.deepEqual(res, { draftOpened: true, batches: 2 });
});

test('writeKaSequence: mid-sequence failure discards the partial KA and rethrows', async () => {
  const dkg = stubClient({ failOnWrite: 2 });
  await assert.rejects(() => writeKaSequence(dkg, 'slug-b', B), (e) => {
    assert.equal(e.message, 'write failed');
    assert.equal(e.discarded, true);
    assert.equal(e.discardError, undefined);
    return true;
  });
  const names = dkg.calls.map(c => c[0]);
  assert.deepEqual(names, ['createKA', 'wmWrite', 'wmWrite', 'wmDiscard']);
  assert.equal(dkg.calls[3][1], 'slug-b');
});

test('writeKaSequence: create failure has nothing to discard', async () => {
  const dkg = stubClient({ failOnCreate: true });
  await assert.rejects(() => writeKaSequence(dkg, 'slug-c', B), (e) => {
    assert.equal(e.discarded, undefined);
    return true;
  });
  assert.deepEqual(dkg.calls.map(c => c[0]), ['createKA']);
});

test('writeKaSequence: discard failure is recorded, original error still propagates', async () => {
  const dkg = stubClient({ failOnWrite: 1, failOnDiscard: 'node unreachable' });
  await assert.rejects(() => writeKaSequence(dkg, 'slug-d', B), (e) => {
    assert.equal(e.message, 'write failed');
    assert.equal(e.discarded, undefined);
    assert.equal(e.discardError, 'node unreachable');
    return true;
  });
  assert.deepEqual(dkg.calls.map(c => c[0]), ['createKA', 'wmWrite', 'wmDiscard']);
});

test('writeKaSequence: finalize failure also discards', async () => {
  const dkg = stubClient();
  dkg.wmFinalize = async () => { dkg.calls.push(['wmFinalize']); throw new Error('finalize failed'); };
  await assert.rejects(() => writeKaSequence(dkg, 'slug-e', B), (e) => {
    assert.equal(e.discarded, true);
    return true;
  });
  assert.deepEqual(dkg.calls.map(c => c[0]), ['createKA', 'wmWrite', 'wmWrite', 'wmFinalize', 'wmDiscard']);
});
