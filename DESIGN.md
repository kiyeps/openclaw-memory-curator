# Design — OpenClaw Memory Curator

## Problem

The first-party OpenClaw adapter for DKG V10 is a chat bridge + read-only
`memory_search` recall. All write operations are delegated to the agent via
SKILL.md prose — the agent must discipline itself to call HTTP routes at the
right moments. That is lossy: memory files accumulate in
`~/.openclaw/workspace/memory/` (currently ~120 files / ~1 MB) with no
provenance, no maturity tracking, no path into Shared or Verifiable Memory.

## Architecture

```
~/.openclaw/workspace/memory/*.md          MEMORY.md
        |  (1) ingest                          |
        v                                      v
 +------------------------------------------------------+
 | openclaw-memory-curator daemon (Node.js, zero-deps   |
 | where possible; state in a local JSON/SQLite file)   |
 |                                                      |
 |  - Markdown parser -> RDF quads + provenance         |
 |  - Secret redaction gate (keys/tokens never leave)   |
 |  - Maturity tracker (reference counts, share tags)   |
 +----------------------+-------------------------------+
                        |
        DKG HTTP API (Bearer token from ~/.dkg/auth.token line 2)
                        |
   (2) wm/write     (3) swm/share        (4) vm/publish
        v                v                     v
   Working Memory   Shared Working       Verifiable Memory
   (per-KA drafts)  Memory (sealed)      (on-chain, gated)
                        ^
                        |
              (5) recall: POST /api/query (SPARQL)
```

## Knowledge Asset mapping

One KA per source file. KA name = slugified filename
(e.g. `memory-2026-07-21-1701`).

Quad shape per memory entry:

```
subject:   urn:openclaw:memory:<file-slug>:<entry-index>
predicate: urn:openclaw:pred:entryType | :content | :decision | :ts
object:    literal (redacted)
```

Provenance triples per file:

```
subject:   urn:openclaw:memory:<file-slug>
predicate: urn:openclaw:pred:sourceFile | :ingestedAt | :sourceMtime
           | :sourceSize | :statusTag | :referenceCount
```

Constraints honored:
- No per-quad `graph` field
- Subjects must NOT match `urn:dkg:file:*` or `urn:dkg:extraction:*`
- Share payloads kept under 256 KB; split by entry batch if a file exceeds
- Full share uses `entities: "all"` (seals by default -> publish-ready)

## Maturity rules (WM -> SWM)

An artifact becomes SWM-eligible when ANY of:
1. Explicit `share:` frontmatter/inline tag in the source file
2. Reference count >= N (default 3): filename or its top decision string
   appears in N or more LATER memory files
3. CLI force: `curator share <ka-name>`

Auto-share runs on the daemon tick (default 5 min). Share always seals.

## VM gate (explicit only)

`curator publish <ka-name>` — interactive confirmation, prints the seal's
merkle root + expected gas cost before calling `vm/publish`. NEVER called
automatically by the daemon. This satisfies the bounty rule that promotion
to Verifiable Memory must be an explicit human/CLI act.

## Secret redaction

Before any quad leaves the process, scan literals against:
- 0x-prefixed 64-char hex (private keys)
- base58 solana keys (32-44 chars, high entropy heuristic)
- `sk-`/`ghp_`/`xox` API token prefixes
- lines matching `(?i)(private[_ ]?key|secret|token|mnemonic|seed)\s*[:=]`

Redacted span -> `[REDACTED:<kind>]`. Redaction events are logged with count
only (never the content).

## CLI surface

```
curator status                  # daemon + node health, ingest stats
curator ingest [--full]         # incremental (mtime) or full re-ingest
curator list [--layer wm|swm]   # KAs with status tags + maturity
curator share <ka> [--force]    # promote to SWM
curator publish <ka>            # gated VM publish
curator recall "<query>"        # SPARQL search over WM+SWM
curator daemon                  # run the background loop
```

## Registry entry plan

`integrations/openclaw-memory-curator.json`:
- slug: `openclaw-memory-curator`
- memoryLayers: WM, SWM, VM
- v10PrimitivesUsed: ContextGraph, KnowledgeAsset, SubGraph
- publicInterfacesUsed: http-api
- targetAgents: OpenClaw, generic-CLI, generic-HTTP
- install.kind: cli
- security.writeAuthority: wm/write, swm/share, vm/publish (explicit-gate)
- security.networkEgress: ["http://127.0.0.1:9200"] only
- trustTier: community
- promotionPath: WM -> SWM auto (maturity) -> VM explicit CLI gate
