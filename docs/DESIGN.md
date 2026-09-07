# Design Brief — OpenClaw Memory Curator

DKG V10 Round 1 submission (`cfi-dkgv10-r1`). Companion to `integrations/openclaw-memory-curator.json`.

## Problem

An OpenClaw agent accumulates memory as local Markdown files. Those memories are
unstructured, unversioned, and invisible to the DKG ecosystem. The curator turns
that static memory into living DKG knowledge with a maturity lifecycle.

## Design

`curator` is a zero-dependency CLI + daemon:

- **Ingest**: scan `~/.openclaw/workspace/memory/*.md`, parse entries, redact
  secret-shaped values, write each file's entries as a KA to WM with provenance
  predicates (source file, entry index, timestamps).
- **Maturity tracking**: each KA's reference count and age drive a maturity
  score persisted in local state.
- **Share**: promote mature KAs to SWM (seals the assertion; publish-ready).
- **Publish (explicit gate)**: the single declared VM operation,
  `POST /api/knowledge-assets/:name/vm/publish`, is reachable **only** through
  the interactive `curator publish <ka>` CLI command with a y/n confirmation.
  It is never invoked automatically or by the daemon. All Round-1 functionality
  (ingest, recall, list, share, daemon) operates purely in WM/SWM.

## Security posture

- All HTTP egress restricted to the local node (`http://127.0.0.1:9200`).
- Reads the DKG auth token from `~/.dkg/auth.token`; never logs it.
- Redaction before any literal leaves the process.
- Recall displays are hardened against string/term binding shape differences.

## Demo

`docs/demo-transcript.txt` — recorded against a live local DKG V10 node
(v10.0.15, Base Sepolia testnet, context graph `openclaw-curator`) with an
isolated demo memory directory: status → ingest → list → recall (WM + SWM).

## Maintenance

Maintained by @kiyeps. Support window: 6 months post-merge minimum.
