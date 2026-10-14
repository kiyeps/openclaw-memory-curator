// Live-node integration tests.
//
// These drive a REAL DKG V10 node over HTTP and are skipped unless one answers,
// so ordinary CI (no DKG node) skips them instead of failing.
//
//   node --test test/integration.test.js
//
// Overrides:
//   DKG_BASE_URL            default http://127.0.0.1:9200
//   DKG_TEST_CONTEXT_GRAPH  default openclaw-curator (a v10 node refuses unknown
//                           context graphs, so the suite reuses the graph the
//                           curator targets and prefixes everything it writes
//                           with itest-curator-)
//
// Side effect: the round-trip test creates one Knowledge Asset and shares it to
// Shared Working Memory. That is the point -- it proves the curator's
// create -> share -> recall path end to end -- and it is why the suite is gated
// behind a reachable node.
import { test } from 'node:test';
import assert from 'node:assert';
import { DkgClient } from '../src/dkg-client.js';

const BASE = process.env.DKG_BASE_URL || 'http://127.0.0.1:9200';
const CONTEXT_GRAPH = process.env.DKG_TEST_CONTEXT_GRAPH || 'openclaw-curator';
const PRED = 'http://127.0.0.1:7878/itest';

async function nodeAvailable() {
  try {
    const res = await fetch(BASE + '/api/status', { signal: AbortSignal.timeout(3000) });
    return res.status > 0 && res.status < 500; // 200 or 401 both prove reachability
  } catch {
    return false;
  }
}

const hasNode = await nodeAvailable();
const skip = !hasNode && 'no local DKG node reachable at ' + BASE;

// The node returns binding values as strings holding the raw SPARQL literal.
function unwrap(value) {
  return String(value && typeof value === 'object' ? value.value : value).replace(/^"|"$/g, '');
}

test('integration: node reports a v10 build', { skip }, async () => {
  const dkg = new DkgClient({ baseUrl: BASE, contextGraphId: CONTEXT_GRAPH });
  const info = await dkg.info();
  assert.match(String(info.version || ''), /^10\./, 'expected a DKG v10 node');
  assert.ok(info.commit, 'node should report its build commit');
});

test('integration: unauthenticated query is rejected', { skip }, async () => {
  const res = await fetch(BASE + '/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sparql: 'SELECT * WHERE { ?s ?p ?o } LIMIT 1', view: 'shared-working-memory' }),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(res.status === 401 || res.status === 403,
    'an unauthenticated /api/query must be rejected, got HTTP ' + res.status);
});

test('integration: create -> share -> recall round-trip', { skip }, async () => {
  const dkg = new DkgClient({ baseUrl: BASE, contextGraphId: CONTEXT_GRAPH });
  const suffix = String(process.pid) + '-' + Date.now().toString(36);
  const kaName = 'itest-curator-' + suffix;
  const subject = 'urn:openclaw:memory:itest:' + suffix;
  // Raw values: DkgClient.createKA applies escapeLiteral() itself, so passing an
  // already-quoted value would double-wrap it.
  const quads = [
    { subject, predicate: PRED, object: 'curator-value' },
    { subject, predicate: PRED + 'Kind', object: 'itest' },
  ];

  const created = await dkg.createKA(kaName, quads);
  assert.ok(created && (created.assertionUri || created.name),
    'createKA should return an assertion reference, got: ' + JSON.stringify(created));

  const shared = await dkg.swmShare(kaName, { entities: 'all' });
  assert.strictEqual(shared.swmShared, true, 'share should report swmShared=true');
  assert.ok(shared.publishReady, 'a sealed share should be publish-ready');

  const sparql = 'SELECT ?s ?o WHERE { BIND(<' + subject + '> AS ?s) ?s <' + PRED + '> ?o } LIMIT 5';
  const res = await dkg.sparql(sparql, { view: 'shared-working-memory' });
  const bindings = res?.result?.bindings || res?.results?.bindings || [];
  assert.ok(bindings.length > 0, 'shared assertion must be recallable');
  assert.strictEqual(unwrap(bindings[0].o), 'curator-value', 'value should round-trip');
});
