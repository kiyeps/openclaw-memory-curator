# OpenClaw Memory Curator

Curator daemon + CLI that bridges OpenClaw workspace memory into a DKG V10
node's three-layer verifiable memory system (WM -> SWM -> VM).

This is the differentiator: the first-party OpenClaw adapter only does chat
bridge + read-only memory recall; all writes are delegated to the agent via
SKILL.md (the agent must discipline itself to call HTTP routes). This project
fills that gap with a deterministic, auditable curation layer.

## What it does

1. **Ingest** — scan OpenClaw workspace `memory/*.md` files, convert them to
   Knowledge Assets with provenance + status tags, land them in Working Memory.
2. **Promote to SWM** — auto-share an artifact to Shared Working Memory when it
   is "mature" (referenced >= N times in later memory files, or carries an
   explicit `share:` tag).
3. **Gate VM promotion** — promotion to Verifiable Memory (on-chain publish) is
   explicit-only via a CLI gate command. Never automatic. (Bounty rule: UI
   endorsement is disallowed; gate is conversational/CLI.)
4. **Recall** — SPARQL query helper over WM/SWM for OpenClaw agent consumption.

## Runtime facts (verified 2026-08-22)

- DKG daemon: `http://127.0.0.1:9200` (v10.0.13, edge node, testnet Base Sepolia)
- Auth token: line 2 of `~/.dkg/auth.token` (line 1 is a comment — strip `#` lines)
- Context graph: `openclaw-curator` (already created, subscribed, synced)
- WM lifecycle verified end-to-end: create KA -> wm/write -> swm/share (seals
  by default, EIP-712) -> SPARQL recall on `shared-working-memory` view works
- Quads format: JSON array of `{subject, predicate, object}` — NO per-quad `graph` field
- WM SPARQL view requires `agentAddress`; SWM/VM views do not
- Full `swm/share` (`entities: "all"`) seals by default => publish-ready
- `vm/publish` auto-registers the CG on-chain on first publish (gas cost)
- Reserved subject IRIs: `urn:dkg:file:*` and `urn:dkg:extraction:*` are REJECTED
- SWM gossip cap: 4 MiB per share; HTTP body cap 256 KB for share payloads

## Source corpus

- `~/.openclaw/workspace/memory/*.md` — ~120 files, ~1 MB total.
  Timestamped session logs (`2026-07-21-1701.md`) + daily digests (`2026-07-21.md`).
  Format: markdown with `[HH:MM WIB] [type] context | decision | next` entries.
- `~/.openclaw/workspace/MEMORY.md` — long-term durable memory.
- Content includes security research findings, bounty outcomes, decisions.
  Nothing in the corpus must leak credentials; ingest must redact obvious
  secrets (private keys, tokens, API keys) before writing to any layer.

## Registry deliverable

Final artifact includes `integrations/openclaw-memory-curator.json` for the DKG
integrations registry (schema at
`scripts/dkg-integration/dkg-integrations/schema/integration.schema.json`),
validated by `scripts/validate.mjs`. See DESIGN.md for the entry content.

## Verified example (2026-08-22)

Real ingest against the local DKG node (v10.0.13, testnet):

```bash
curator status
# DKG Node: **IRONCLAW** v10.0.13 | Context Graph: openclaw-curator
# KAs tracked: 120 (WM: 120, SWM: 0, VM: 0)

curator ingest ~/.openclaw/workspace/memory/2026-05.md
# Found 125 memory files
# Ingested: 5, Skipped: 119, Errors: 1
```

5 OpenClaw workspace memory files were converted to Knowledge Assets and
landed in Working Memory. The single error was a DKG node-level
`assertionFinalize` seal-partition conflict on an already-existing KA, not a
curator defect.
