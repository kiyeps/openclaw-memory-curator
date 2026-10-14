# Design Brief - OpenClaw Memory Curator

DKG V10 Call for Integrations, Round 1 submission (`cfi-dkgv10-r1`). Human-readable
companion to `integrations/openclaw-memory-curator.json`.

## Problem

An OpenClaw agent accumulates memory as local Markdown files. Those files are
unstructured, unversioned, and invisible to the DKG ecosystem. The curator turns
that static memory into DKG knowledge with an explicit maturity lifecycle, so an
agent's own history becomes queryable, provenance-tagged knowledge that survives
the process - and can mature toward shared, publish-ready state.

Target users: OpenClaw operators (the primary deployment) and any agent framework
that keeps durable local memory files.

## Layers touched

- Working Memory (WM): primary write target. Each memory file's entries are
  written as a KA (draft-open, provenance predicates attached).
- Shared Working Memory (SWM): explicit or daemon-gated promotion. `curator share`
  and the daemon's auto-share tick both call swm/share, which seals the assertion
  (publish-ready).
- Verifiable Memory (VM): implemented but strictly human-gated. The single VM
  operation (vm/publish) is reachable ONLY via the interactive `curator publish`
  command with a y/n confirmation, never automatically. Round-1 flows operate
  in WM/SWM.

## DKG V10 interfaces and primitives used

- Context Graph: `openclaw-curator` (configurable).
- Knowledge Asset: one per memory file (name epoch-pid-<file>); created + written
  via `POST /api/knowledge-assets` and `POST /api/knowledge-assets/{name}/wm/write`.
- Assertion: sealed by SHARE; the curator reads the node's identifiers from the
  responses and stores them in local state.
- SubGraph: not used; no subgraph admin operations are performed.
- Operations: create KA, wm/write, swm/share, vm/publish (interactive, human-gated
  - declared and documented, not exercised by default), POST /api/query (SPARQL).
- Recall: SPARQL over WM/SWM with display hardening for OpenClaw memory displays.

## How this advances LLM-Wiki and autoresearch

An agent's memory files are exactly the raw material an LLM-Wiki wants to cite:
the curator gives each memory file a KA identity with provenance predicates
(source file, entry index, timestamps) and a maturity state, so wiki entries can
link to sealed assertions instead of copying text. Autoresearch loops benefit in
the same way - they can query "what did this agent learn last month" against
provenance-tagged KAs rather than grepping mutable markdown.

## Terminology (v10 vocabulary)

- "Ingest" = write memory entries to WM (no share).
- "Share" = the DKG SHARE operation (swm/share, seals by default).
- "Publish" = VM promotion via vm/publish; reserved for the explicit interactive
  command. The word is never used for SHARE.

## Promotion path (current behavior)

1. Ingest writes the file's entries into WM as a draft KA.
2. Maturity: a KA becomes SWM-eligible when its reference count reaches the
   threshold (default 3) or the source frontmatter carries an explicit `share:`
   tag; eligibility is tracked in local state.
3. The daemon tick (default every 5 minutes, overridable) auto-shares eligible
   KAs to SWM (sealed). The operator can also share any KA explicitly.
4. VM publishing is never automatic: only `curator publish <ka>` with interactive
   confirmation can call vm/publish.

## Provenance, identifiers, and oracle input

- KAs carry provenance predicates: source file, entry index, timestamps, plus the
  node-issued identifiers returned by the DKG node (never constructed locally).
- Local state records KA names and node responses (including assertion URIs once
  sealed) so later runs can re-verify.
- Context oracles: a sealed, shared KA is a publish-ready candidate input for
  context oracle workflows; the curator is the producer of such KAs, it does not
  call oracles itself.

## Security posture

- Egress: local DKG node only (`http://127.0.0.1:9200` by default); https enforced
  for any non-loopback URL.
- Credentials: DKG auth token from `~/.dkg/auth.token` (or env); never logged.
- Redaction: every entry passes the secret redaction gate before it is written.
- Write authority: wm/write + swm/share; vm/publish exists but requires explicit
  interactive human confirmation.
- Zero runtime dependencies (Node.js built-ins only; Node >= 20).

## Round 1 checklist

- Demo: `docs/demo-transcript.txt` - status, ingest, list, recall (WM + SWM)
  against a live local DKG V10 node (Base Sepolia testnet).
- Tests: `node --test test/*.test.js` (ingest/maturity/share/recall integration +
  publish-gate).

## Maintainer

@kiyeps (https://github.com/kiyeps) - 6 months post-merge support minimum.
