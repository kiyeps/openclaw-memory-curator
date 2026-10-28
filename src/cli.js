#!/usr/bin/env node
// OpenClaw Memory Curator CLI
// Subcommands: status, ingest, list, share, publish, recall, daemon

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { parseFileFromDisk, slugify } from './parser.js';
import { redactQuads } from './redaction.js';
import { DkgClient } from './dkg-client.js';
import { writeKaSequence } from './ka-writer.js';
import { MaturityTracker } from './maturity.js';

const MEMORY_DIR = process.env.CURATOR_MEMORY_DIR || join(homedir(), '.openclaw', 'workspace', 'memory');
// State lives outside the repo by default so a curator run never dirties the
// working tree. CURATOR_STATE_DIR overrides it for tests and non-default layouts.
const STATE_DIR = process.env.CURATOR_STATE_DIR ||
  join(homedir(), '.openclaw', 'workspace', 'scripts', 'openclaw-memory-curator', '.state');
const STATE_FILE = join(STATE_DIR, 'maturity.json');
const CG_ID = process.env.CURATOR_CONTEXT_GRAPH || 'openclaw-curator';

function bindingVal(b, key) {
  const v = b[key];
  return typeof v === 'string' ? v : (v && v.value) || '';
}
function getDkg() { return new DkgClient({ contextGraphId: CG_ID }); }
function getTracker() { return new MaturityTracker(STATE_FILE); }

async function cmdStatus() {
  const dkg = getDkg();
  const tracker = getTracker();
  const info = await dkg.info();
  const kas = tracker.list();
  console.log('DKG Node:', info.name || 'unknown', 'v' + info.version);
  console.log('Context Graph:', CG_ID);
  console.log('KAs tracked:', kas.length);
  console.log('  WM:', kas.filter(k => k.status === 'wm').length);
  console.log('  SWM:', kas.filter(k => k.status === 'swm').length);
  console.log('  VM:', kas.filter(k => k.status === 'vm').length);
}

async function cmdIngest({ full = false } = {}) {
  const dkg = getDkg();
  const tracker = getTracker();
  const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} memory files`);

  let ingested = 0, skipped = 0, errors = 0;
  const allSlugs = [];
  const fileContents = {};
  const ts = Date.now();

  for (const f of files) {
    const fp = join(MEMORY_DIR, f);
    const baseSlug = slugify(fp);
    const st = statSync(fp);
    const existing = tracker.get(baseSlug);

    if (!full && existing && existing.mtimeMs >= st.mtimeMs) {
      skipped++;
      continue;
    }

    // Re-ingesting CHANGED data must use a unique (timestamped) name so the
    // DKG node does not collide with the previously sealed KA ("private/public
    // partition differs from its existing seal"). First ingest keeps the clean
    // baseSlug. `ingest --full` always timestamps.
    const changed = existing && existing.mtimeMs < st.mtimeMs;
    const slug = (full || changed) ? `${baseSlug}-${ts}` : baseSlug;

    try {
      const { quads, shareTag, entryCount } = parseFileFromDisk(fp);
      const { quads: redacted, redactedCount } = redactQuads(quads);
      if (redactedCount > 0) console.log(`  ${slug}: redacted ${redactedCount} secrets`);

      // Split into batches if too large
      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < redacted.length; i += batchSize) {
        batches.push(redacted.slice(i, i + batchSize));
      }

      // Draft -> append -> finalize, with discard-on-failure so a failed
      // ingest can never leave a partial KA behind. See src/ka-writer.js.
      if (batches.length > 0) {
        await writeKaSequence(dkg, slug, batches);
      }

      tracker.upsert(baseSlug, {
        entryCount,
        shareTag,
        mtimeMs: st.mtimeMs,
        size: st.size,
        sourceFile: fp,
        slug,
      });
      allSlugs.push(baseSlug);
      fileContents[baseSlug] = readFileSync(fp, 'utf8');
      ingested++;
    } catch (e) {
      console.error(`  ERROR ${slug}: ${e.message}${e.discarded ? ' (partial KA discarded)' : ''}${e.discardError ? ` (discard failed: ${e.discardError})` : ''}`);
      errors++;
    }
  }

  // Update reference counts
  allSlugs.sort();
  tracker.updateReferenceCounts(allSlugs, fileContents);
  tracker.save();

  console.log(`Ingested: ${ingested}, Skipped: ${skipped}, Errors: ${errors}`);
}

async function cmdList({ layer } = {}) {
  const tracker = getTracker();
  let kas = tracker.list();
  if (layer) kas = kas.filter(k => k.status === layer);
  kas.sort((a, b) => a.name.localeCompare(b.name));
  for (const k of kas) {
    console.log(`${k.name}\t${k.status}\trefs=${k.referenceCount}\tentries=${k.entryCount}${k.shareTag ? '\t[share]' : ''}`);
  }
  console.log(`Total: ${kas.length}`);
}

async function cmdShare(kaName, { force = false } = {}) {
  const dkg = getDkg();
  const tracker = getTracker();
  const k = tracker.get(kaName);
  if (!k) { console.error('Unknown KA:', kaName); process.exit(1); }
  if (k.status !== 'wm') { console.error('KA not in WM:', k.status); process.exit(1); }
  if (!force && !tracker.swmEligible(kaName)) {
    console.error('KA not SWM-eligible. Use --force to override.');
    process.exit(1);
  }
  const nodeKa = k.slug || k.name; // actual node KA (timestamped on re-ingest)
  console.log(`Sharing ${nodeKa} to SWM...`);
  const res = await dkg.swmShare(nodeKa);
  tracker.setStatus(kaName, 'swm');
  tracker.save();
  console.log('Shared:', JSON.stringify(res, null, 2));
}

async function cmdPublish(kaName, assumeYes = false) {
  const tracker = getTracker();
  const k = tracker.get(kaName);
  if (!k) { console.error('Unknown KA:', kaName); process.exit(1); }
  if (k.status !== 'swm') { console.error('KA not in SWM:', k.status); process.exit(1); }
  // The tracker key is the stable base slug; the actual node KA name carries a
  // timestamp suffix when the file was re-ingested (see cmdIngest). Resolve to
  // the node name before touching the node, exactly as cmdShare does, so a
  // re-ingested KA publishes under its live name instead of failing.
  const nodeKa = k.slug || k.name;
  console.log(`WARNING: This will publish ${nodeKa} to Verifiable Memory (on-chain).`);
  console.log('This is an explicit, irreversible action. Gas costs apply.');
  if (!assumeYes) {
    // Enforce the explicit human gate the security declaration promises: no
    // publish without an interactive confirmation, or an explicit --yes.
    if (!process.stdin.isTTY) {
      console.error('Refusing to publish without confirmation: stdin is not a TTY.');
      console.error('Re-run interactively, or pass --yes to confirm non-interactively.');
      process.exit(1);
    }
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Type "yes" to publish ${nodeKa} to Verifiable Memory: `))
      .trim().toLowerCase();
    rl.close();
    if (answer !== 'yes') {
      console.error('Aborted. KA left in SWM; nothing was published.');
      process.exit(1);
    }
  }
  console.log('Publishing...');
  const res = await dkg.vmPublish(nodeKa);
  tracker.setStatus(kaName, 'vm');
  tracker.save();
  console.log('Published:', JSON.stringify(res, null, 2));
}

async function cmdRecall(query) {
  const dkg = getDkg();
  const escapedQuery = query.replace(/"/g, '\\"');

  // Query SWM view (no agentAddress needed)
  const swmSparql = `
    SELECT ?s ?p ?o WHERE {
      ?s ?p ?o .
      FILTER(CONTAINS(STR(?o), "${escapedQuery}"))
    } LIMIT 20
  `;

  // Query WM view (requires agentAddress)
  const wmSparql = swmSparql;

  try {
    console.log('SWM results:');
    const swmRes = await dkg.sparql(swmSparql, { view: 'shared-working-memory' });
    if (swmRes.result && swmRes.result.bindings) {
      for (const b of swmRes.result.bindings) {
        console.log(`  ${bindingVal(b, 's')} ${bindingVal(b, 'p')} ${bindingVal(b, 'o')}`);
      }
      console.log(`SWM total: ${swmRes.result.bindings.length}`);
    }
  } catch (e) {
    console.error('SWM recall error:', e.message);
  }

  try {
    console.log('\nWM results:');
    const wmRes = await dkg.sparql(wmSparql, {
      view: 'working-memory',
      agentAddress: '0xebDc3D25487E5B28bbd5eD4d5cF59A9c7c46395A'
    });
    if (wmRes.result && wmRes.result.bindings) {
      for (const b of wmRes.result.bindings) {
        console.log(`  ${bindingVal(b, 's')} ${bindingVal(b, 'p')} ${bindingVal(b, 'o')}`);
      }
      console.log(`WM total: ${wmRes.result.bindings.length}`);
    }
  } catch (e) {
    console.error('WM recall error:', e.message);
  }
}

async function cmdDaemon() {
  console.log('Starting curator daemon (tick=5min)...');
  const tick = async () => {
    console.log(`[${new Date().toISOString()}] tick`);
    await cmdIngest({ full: false });
    // Auto-share eligible KAs
    const tracker = getTracker();
    const dkg = getDkg();
    for (const k of tracker.list()) {
      if (tracker.swmEligible(k.name)) {
        const nodeKa = k.slug || k.name; // actual node KA (timestamped on re-ingest)
        console.log(`Auto-sharing ${nodeKa} to SWM`);
        try {
          await dkg.swmShare(nodeKa);
          tracker.setStatus(k.name, 'swm');
          tracker.save();
        } catch (e) {
          console.error(`  ERROR sharing ${nodeKa}: ${e.message}`);
        }
      }
    }
  };
  await tick();
  setInterval(tick, 5 * 60 * 1000);
}

const [,, cmd, ...args] = process.argv;
switch (cmd) {
  case 'status': cmdStatus().catch(e => { console.error(e); process.exit(1); }); break;
  case 'ingest':
    const full = args.includes('--full');
    cmdIngest({ full }).catch(e => { console.error(e); process.exit(1); });
    break;
  case 'list':
    const layer = args.includes('--layer') ? args[args.indexOf('--layer') + 1] : null;
    cmdList({ layer }).catch(e => { console.error(e); process.exit(1); });
    break;
  case 'share':
    if (!args[0]) { console.error('Usage: curator share <ka-name> [--force]'); process.exit(1); }
    cmdShare(args[0], { force: args.includes('--force') }).catch(e => { console.error(e); process.exit(1); });
    break;
  case 'publish':
    if (!args[0]) { console.error('Usage: curator publish <ka-name> [--yes]'); process.exit(1); }
    cmdPublish(args[0], args.includes('--yes')).catch(e => { console.error(e); process.exit(1); });
    break;
  case 'recall':
    if (!args[0]) { console.error('Usage: curator recall "<query>"'); process.exit(1); }
    cmdRecall(args[0]).catch(e => { console.error(e); process.exit(1); });
    break;
  case 'daemon': cmdDaemon().catch(e => { console.error(e); process.exit(1); }); break;
  default:
    console.log('Usage: curator <command>');
    console.log('Commands: status, ingest [--full], list [--layer wm|swm], share <ka> [--force], publish <ka>, recall "<query>", daemon');
    process.exit(1);
}
