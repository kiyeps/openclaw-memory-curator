import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MaturityTracker } from '../src/maturity.js';

function freshTracker() {
  const dir = mkdtempSync(join(tmpdir(), 'maturity-'));
  const p = join(dir, 'state.json');
  return { tracker: new MaturityTracker(p), dir, path: p };
}

test('upsert + get + list', () => {
  const { tracker, dir } = freshTracker();
  tracker.upsert('ka1', { entryCount: 3, shareTag: false, mtimeMs: 1000, size: 100, sourceFile: '/x/ka1.md' });
  tracker.upsert('ka2', { entryCount: 5, shareTag: true, mtimeMs: 2000, size: 200, sourceFile: '/x/ka2.md' });
  const k1 = tracker.get('ka1');
  assert.equal(k1.entryCount, 3);
  assert.equal(k1.status, 'wm');
  assert.equal(k1.shareTag, false);
  assert.equal(tracker.list().length, 2);
  rmSync(dir, { recursive: true });
});

test('swmEligible: shareTag makes eligible', () => {
  const { tracker, dir } = freshTracker();
  tracker.upsert('ka1', { entryCount: 1, shareTag: true, mtimeMs: 1000, size: 100, sourceFile: '/x.md' });
  assert.equal(tracker.swmEligible('ka1'), true);
  rmSync(dir, { recursive: true });
});

test('swmEligible: referenceCount >= threshold makes eligible', () => {
  const { tracker, dir } = freshTracker();
  tracker.upsert('ka1', { entryCount: 1, shareTag: false, mtimeMs: 1000, size: 100, sourceFile: '/x.md' });
  tracker.get('ka1').referenceCount = 3;
  assert.equal(tracker.swmEligible('ka1', { threshold: 3 }), true);
  assert.equal(tracker.swmEligible('ka1', { threshold: 4 }), false);
  rmSync(dir, { recursive: true });
});

test('swmEligible: not eligible when status != wm', () => {
  const { tracker, dir } = freshTracker();
  tracker.upsert('ka1', { entryCount: 1, shareTag: true, mtimeMs: 1000, size: 100, sourceFile: '/x.md' });
  tracker.setStatus('ka1', 'swm');
  assert.equal(tracker.swmEligible('ka1'), false);
  rmSync(dir, { recursive: true });
});

test('updateReferenceCounts: counts later files referencing slug', () => {
  const { tracker, dir } = freshTracker();
  tracker.upsert('alpha', { entryCount: 1, shareTag: false, mtimeMs: 1000, size: 10, sourceFile: 'a.md' });
  tracker.upsert('beta', { entryCount: 1, shareTag: false, mtimeMs: 2000, size: 10, sourceFile: 'b.md' });
  const contents = {
    alpha: 'first file',
    beta: 'references alpha here',
  };
  tracker.updateReferenceCounts(['alpha', 'beta'], contents);
  assert.equal(tracker.get('alpha').referenceCount, 1);
  assert.equal(tracker.get('beta').referenceCount, 0);
  rmSync(dir, { recursive: true });
});

test('persistence: state survives reload', () => {
  const { tracker, dir, path } = freshTracker();
  tracker.upsert('ka1', { entryCount: 2, shareTag: false, mtimeMs: 1000, size: 100, sourceFile: '/x.md' });
  tracker.save();
  const t2 = new MaturityTracker(path);
  assert.equal(t2.get('ka1').entryCount, 2);
  rmSync(dir, { recursive: true });
});
