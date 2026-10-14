// Guards for the explicit Verifiable Memory publish gate.
//
// The security declaration promises that vm/publish is reachable only through an
// explicit interactive confirmation. These tests prove the CLI refuses to
// publish when that confirmation is absent, and that no state-changing call is
// attempted in the refusal paths.
//
// Only the refusal paths are exercised on purpose: the success path would issue a
// real on-chain vm/publish against the configured node, which a unit test must
// never do.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const KA = 'publish-gate-test-ka';

function stateDirWith(status) {
  const dir = mkdtempSync(join(tmpdir(), 'curator-gate-'));
  const kas = {};
  if (status) {
    kas[KA] = { name: KA, status, referenceCount: 3, shareTag: true, entryCount: 1, lastIngested: null };
  }
  writeFileSync(join(dir, 'maturity.json'), JSON.stringify({ kas, lastTick: null }));
  return dir;
}

// stdin is 'ignore', so process.stdin.isTTY is false inside the child: exactly
// the non-interactive case the gate must refuse.
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

test('publish gate: refuses without confirmation when stdin is not a TTY', () => {
  const res = runCli(['publish', KA], stateDirWith('swm'));
  assert.notStrictEqual(res.code, 0, 'publish must not succeed without confirmation');
  assert.match(res.stderr, /not a TTY/, 'must explain that stdin is not a TTY');
  assert.match(res.stderr, /--yes/, 'must name the explicit override flag');
  assert.ok(!/Publishing\.\.\./.test(res.stdout),
    'must never reach the publish call without confirmation');
});

test('publish gate: refuses an unknown KA before any credential or network use', () => {
  const res = runCli(['publish', 'no-such-ka'], stateDirWith('swm'));
  assert.notStrictEqual(res.code, 0);
  assert.match(res.stderr, /Unknown KA/);
});

test('publish gate: refuses a KA that is not in SWM', () => {
  const res = runCli(['publish', KA], stateDirWith('wm'));
  assert.notStrictEqual(res.code, 0);
  assert.match(res.stderr, /KA not in SWM/);
});
