# CLAUDE.md — OpenClaw Memory Curator

## Quick Start

```bash
# Install (no npm deps needed — pure Node.js v24)
# Just ensure you're in the project directory

# Run tests
node --test test/*.test.js

# Ingest memory files
node src/cli.js ingest --full

# Check status
node src/cli.js status

# List KAs
node src/cli.js list

# Recall from SWM
node src/cli.js recall "wallet"

# Share to SWM (force if not auto-eligible)
node src/cli.js share <ka-name> --force

# Publish to VM (explicit gate)
node src/cli.js publish <ka-name>
```

## Key Files

- `src/cli.js` — CLI entry point (bin: curator)
- `src/parser.js` — Markdown → RDF quads
- `src/redaction.js` — Secret redaction gate
- `src/dkg-client.js` — DKG HTTP client
- `src/maturity.js` — Maturity tracker
- `test/*.test.js` — Unit tests (node:test)
- `integrations/openclaw-memory-curator.json` — Registry entry

## Architecture

The curator ingests OpenClaw workspace memory files, parses them into RDF quads, redacts secrets, and writes them to DKG V10's Working Memory. Mature artifacts (referenced ≥3 times or explicitly tagged) are promoted to Shared Working Memory. Verifiable Memory promotion is explicit-only via CLI gate.

### Data Flow

```
~/.openclaw/workspace/memory/*.md
  ↓ parser.js (Markdown → quads)
  ↓ redaction.js (secret redaction)
  ↓ dkg-client.js (HTTP POST to DKG node)
  ↓ DKG node (WM → SWM → VM)
```

### Quad Format

```javascript
{
  subject: "urn:openclaw:memory:<slug>:<idx>",  // or <slug> for provenance
  predicate: "urn:openclaw:pred:<type>",
  object: "<literal>"  // wrapped in double-quotes for SPARQL
}
```

**Constraints:**
- NO per-quad `graph` field
- Subjects must NOT match `urn:dkg:file:*` or `urn:dkg:extraction:*`
- Object literals must be wrapped in double-quotes (bare strings are treated as IRIs)

## DKG API Endpoints

- `POST /api/knowledge-assets` — Create KA with initial quads
- `POST /api/knowledge-assets/:name/wm/write` — Write quads to WM
- `POST /api/knowledge-assets/:name/wm/finalize` — Finalize WM assertion
- `POST /api/knowledge-assets/:name/swm/share` — Share to SWM (seals by default)
- `POST /api/knowledge-assets/:name/vm/publish` — Publish to VM (explicit gate)
- `POST /api/query` — SPARQL query (requires `view` param: "working-memory" or "shared-working-memory")

### SPARQL Query

```javascript
// SWM view (no agentAddress needed)
{
  sparql: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
  contextGraphId: "openclaw-curator",
  view: "shared-working-memory"
}

// WM view (requires agentAddress)
{
  sparql: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
  contextGraphId: "openclaw-curator",
  view: "working-memory",
  agentAddress: "0xebDc3D25487E5B28bbd5eD4d5cF59A9c7c46395A"
}
```

## Maturity Rules

An artifact becomes SWM-eligible when ANY of:
1. Explicit `share:` frontmatter tag in source file
2. Reference count ≥ 3 (filename appears in ≥3 later memory files)
3. CLI force: `curator share <ka-name> --force`

Auto-share runs on daemon tick (5 min interval). Share always seals.

## Secret Redaction

Before any quad leaves the process, scan literals for:
- 0x-prefixed 64-char hex (private keys)
- Base58 solana keys (32-44 chars, high entropy)
- `sk-`/`ghp_`/`xox` API token prefixes
- Lines matching `(private[_ ]?key|secret|token|mnemonic|seed)\s*[:=]`

Redacted span → `[REDACTED:<kind>]`. Redaction events logged with count only (never content).

## Testing

```bash
# Run all tests
node --test test/*.test.js

# Run specific test file
node --test test/parser.test.js

# Tests cover:
# - Parser: entry parsing, provenance quads, subject IRI constraints, no graph field
# - Redaction: hex keys, API tokens, secret lines, no false positives
# - Maturity: upsert/get/list, SWM eligibility, reference counting, persistence
```

## Registry Validation

```bash
cd /home/chovy/.openclaw/workspace/scripts/dkg-integration/dkg-integrations
node scripts/validate.mjs /home/chovy/.openclaw/workspace/scripts/openclaw-memory-curator/integrations/openclaw-memory-curator.json
```

## Common Pitfalls

1. **"expected IRI parsing failed"** — Object literals need double-quote wrapping. The `escapeLiteral()` function handles this.
2. **"private/public partition differs"** — KA already exists with different data. Use unique names (append timestamp).
3. **SPARQL returns empty** — Check `view` parameter. WM requires `agentAddress`; SWM does not.
4. **Redaction false positives** — `sk-` regex matches `token=sk-...` lines. Adjust test expectations.
5. **Daemon auto-share** — Only shares if SWM-eligible (shareTag OR referenceCount ≥ 3).

## Runtime Environment

- Node.js v24 (uses native fetch, node:test)
- DKG node: `http://127.0.0.1:9200` (v10.0.13)
- Auth token: `~/.dkg/auth.token` line 2
- Context graph: `openclaw-curator`
- Source corpus: `~/.openclaw/workspace/memory/*.md` (~120 files)

## Zero Dependencies

The project uses only Node.js built-ins:
- `node:fs`, `node:path`, `node:os` — Filesystem and OS
- `node:test` — Unit testing
- Native `fetch` — HTTP client (Node.js v24)

No npm install needed.
