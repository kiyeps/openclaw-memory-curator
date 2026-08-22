# AGENTS.md — OpenClaw Memory Curator

## Project Overview

OpenClaw Memory Curator is a Node.js daemon + CLI that bridges OpenClaw workspace memory (`~/.openclaw/workspace/memory/*.md`) into the DKG V10 three-layer verifiable memory system (Working Memory → Shared Working Memory → Verifiable Memory).

## Architecture

```
memory/*.md → parser.js → redaction.js → dkg-client.js → DKG node (WM/SWM/VM)
                          ↑
                    maturity.js (JSON state in .state/)
```

### Core Modules

- **src/parser.js** — Markdown parser. Converts memory files to RDF quads. Subjects use `urn:openclaw:memory:<slug>:<idx>` (never `urn:dkg:file:*` or `urn:dkg:extraction:*`). No per-quad `graph` field.
- **src/redaction.js** — Secret redaction gate. Scans literals for private keys (0x hex64, solana base58), API tokens (sk-, ghp_, xox-), and secret lines (private_key=, mnemonic=, etc.). Replaces with `[REDACTED:<kind>]`.
- **src/dkg-client.js** — DKG HTTP client. Token from `~/.dkg/auth.token` line 2 (strips `#` comment lines). Object literals are wrapped in double-quotes for SPARQL compatibility. Endpoints: `/api/knowledge-assets`, `/api/knowledge-assets/:name/wm/write`, `/api/knowledge-assets/:name/swm/share`, `/api/knowledge-assets/:name/vm/publish`, `/api/query`.
- **src/maturity.js** — Maturity tracker. JSON state file in `.state/maturity.json`. Tracks per-KA: status (wm|swm|vm), referenceCount, shareTag, entryCount. SWM-eligible when shareTag=true OR referenceCount >= 3.
- **src/cli.js** — CLI entry point. Subcommands: status, ingest, list, share, publish, recall, daemon.

## Key Constraints

- **Quads format**: JSON array of `{subject, predicate, object}` — NO per-quad `graph` field
- **Subject IRIs**: Must NOT match `urn:dkg:file:*` or `urn:dkg:extraction:*` (reserved by DKG)
- **Object literals**: Must be wrapped in double-quotes (`"value"`) to force SPARQL literal treatment (bare strings are treated as IRIs by the DKG node's serializer)
- **SWM share**: Uses `entities: "all"` (seals by default, publish-ready)
- **VM publish**: Explicit CLI gate only — never automatic (bounty rule)
- **SPARQL views**: WM view requires `agentAddress`; SWM/VM views do not
- **Payload size**: Keep under 256 KB per share; batch quads if needed

## Runtime Facts

- DKG node: `http://127.0.0.1:9200` (v10.0.13, edge node, testnet Base Sepolia)
- Auth token: line 2 of `~/.dkg/auth.token`
- Context graph: `openclaw-curator`
- Source corpus: `~/.openclaw/workspace/memory/*.md` (~120 files, ~1 MB)

## Build & Test

```bash
# Run unit tests (node:test, zero deps)
node --test test/*.test.js

# Ingest memory files into WM
node src/cli.js ingest --full

# List tracked KAs
node src/cli.js list

# Recall from SWM
node src/cli.js recall "wallet"

# Share a KA to SWM (must be SWM-eligible)
node src/cli.js share <ka-name> --force

# Publish to VM (explicit gate, never automatic)
node src/cli.js publish <ka-name>
```

## Registry Entry

`integrations/openclaw-memory-curator.json` — validates against the DKG integrations schema. Run:

```bash
cd /home/chovy/.openclaw/workspace/scripts/dkg-integration/dkg-integrations
node scripts/validate.mjs /home/chovy/.openclaw/workspace/scripts/openclaw-memory-curator/integrations/openclaw-memory-curator.json
```

## Common Issues

- **"expected IRI parsing failed"** — Object literals need double-quote wrapping. The `escapeLiteral()` function in `dkg-client.js` handles this.
- **"private/public partition differs from its existing seal"** — KA already exists with different data. Use unique KA names (e.g., append timestamp) for fresh ingest.
- **SPARQL returns empty** — Check the `view` parameter. WM view requires `agentAddress`; SWM view does not.
- **Redaction false positives** — The `sk-` token regex also matches `token=sk-...` lines. Adjust test expectations accordingly.

## File Structure

```
src/
  parser.js        # Markdown → quads
  redaction.js     # Secret redaction
  dkg-client.js    # DKG HTTP API client
  maturity.js      # Maturity tracker (JSON state)
  cli.js           # CLI entry point
test/
  parser.test.js   # Parser unit tests
  redaction.test.js # Redaction unit tests
  maturity.test.js # Maturity unit tests
integrations/
  openclaw-memory-curator.json  # Registry entry
.state/
  maturity.json    # Maturity state (gitignored)
package.json       # bin: curator → src/cli.js
```
