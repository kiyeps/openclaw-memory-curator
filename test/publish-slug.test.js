// Regression guard for the publish slug-resolution bug.
//
// Defect: cmdPublish called dkg.vmPublish(kaName) with the TRACKER key, while
// cmdShare correctly resolved `k.slug || k.name` before calling the node. For a
// KA that was re-ingested under a timestamped slug, publish therefore targeted
// the un-timestamped name and failed with a node error instead of publishing
// the live KA.
//
// These tests prove the publish path resolves the node KA name from tracker
// state, and that the resolution is observable in the user-facing output
// without ever issuing a state-changing call.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const KA = 'publish-slug-regression-ka';
const NODE_KA = 'publish-slug-regression-ka-1787398447058';

// A tracker entry whose live node KA name differs from the tracker key: this is
// exactly the shape produced by cmdIngest when a memory file is re-ingested.
function stateDirWithReingestedSlug(status) {
  const dir = mkdtempSync(join(tmpdir(), 'curator-slug-'));
  const kas = {};
  if (status) {
    kas[KA] = {
      name: KA,
      slug: NODE_KA,
      status,
      referenceCount: 3,
      shareTag: true,
      entryCount: 1,
      lastIngested: null,
    };
  }
  writeFileSync(join(dir, 'maturity.json'), JSON.stringify({ kas, lastTick: null }));
  return dir;
}

function runCli(args, stateDir) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      env: { ...process.env, CURATOR_STATE_DIR: stateDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status === undefined ? -1 : err.status,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || ''),
    };
  }
}

test('publish slug: the warning names the resolved node KA, not the tracker key', () => {
  // Non-TTY refusal still prints the WARNING banner first, which is enough to
  // observe which name the publish path resolved.
  const res = runCli(['publish', KA], stateDirWithReingestedSlug('swm'));
  assert.notStrictEqual(res.code, 0, 'publish must still refuse without confirmation');
  assert.match(res.stderr, /not a TTY/, 'must refuse on non-TTY stdin');
  assert.ok(
    res.stdout.includes(NODE_KA),
    `WARNING must name the resolved node KA (${NODE_KA}); got: ${res.stdout.trim()}`
  );
  assert.ok(
    !res.stdout.includes(`publish ${KA} to`),
    'WARNING must not name the bare tracker key as the publish target'
  );
});

test('publish slug: the non-TTY refusal still names the resolved node KA', () => {
  // A piped stdin is not a TTY, so the human gate refuses before readline ever
  // opens. That is the correct behaviour; what this test proves is that the
  // refusal path has already resolved the node KA name, not the tracker key.
  const dir = stateDirWithReingestedSlug('swm');
  const res = spawnSync(process.execPath, [cli, 'publish', KA], {
    env: { ...process.env, CURATOR_STATE_DIR: dir },
    input: 'no\n',
    timeout: 20000,
    encoding: 'utf8',
  });
  const combined = String(res.stdout || '') + String(res.stderr || '');
  assert.notStrictEqual(res.status, 0, 'publish must refuse on non-TTY stdin');
  assert.match(combined, /not a TTY/, 'must explain the refusal');
  assert.ok(
    combined.includes(NODE_KA),
    `refusal output must name the resolved node KA (${NODE_KA}); got: ${combined.trim()}`
  );
  assert.ok(
    !combined.includes(`publish ${KA} to`),
    'must not name the bare tracker key as the publish target'
  );
});

test('publish slug: tracker state is untouched by an aborted publish', () => {
  const dir = stateDirWithReingestedSlug('swm');
  spawnSync(process.execPath, [cli, 'publish', KA], {
    env: { ...process.env, CURATOR_STATE_DIR: dir },
    input: 'no\n',
    timeout: 20000,
    encoding: 'utf8',
  });
  const after = JSON.parse(readFileSync(join(dir, 'maturity.json'), 'utf8'));
  assert.strictEqual(after.kas[KA].status, 'swm', 'status must remain swm after an abort');
  assert.strictEqual(after.kas[KA].slug, NODE_KA, 'slug must be preserved in tracker state');
});
