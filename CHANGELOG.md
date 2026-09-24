# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-09-24

CPSC text reaches both surfaces as plain text, content[] escapes Markdown and encodes addresses so every character and link survives, and a transient CPSC provider failure gets one retry before surfacing as retryable upstream_error.

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-09-24 · ⚠️ Breaking

cpsc_search_recalls now requires a criterion, matches every word of a text filter, and returns zero matches as an empty success; both list tools cap each page at 64,000 bytes, and truncated now equals has_more.

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-09-19 · ⚠️ Breaking

Adopts mcp-ts-core 0.13.6 — the server declares a stateless session posture, cpsc_search_recalls accepts 'hazard' as an alias for hazard_search, and the Bun engine floor rises to 1.4.0, which breaks on older Bun runtimes.

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-08-24

Adopts mcp-ts-core 0.12.3 and MCP SDK v2 — the HTTP endpoint serves protocol revision 2026-07-28 alongside the 2025 era, tool inputs are strict so an undeclared argument key is rejected instead of ignored, and HTTP session mode is now stateless explicitly.

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-07-27

Add title/distributor/remedy/publish-date filters and client-side hazard search to cpsc_search_recalls, offset paging with has_more on search and recent, and a non-retryable upstream_rejected error distinct from transient failures

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-07-27

Reject impossible dates and sentinel error rows, fix null-Description and manufacturer/importer rendering, frame CPSC narrative as source text; mcp-ts-core ^0.11.0, TypeScript ^7.0.2

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-06-20

Maintenance: @cyanheads/mcp-ts-core ^0.10.6 → ^0.10.9; plugin-manifest packaging checks enabled; biome 2.5, @types/node 26, vitest 4.1.9 refresh

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-06-11

Maintenance: @cyanheads/mcp-ts-core ^0.9.19 → ^0.10.6; explicit name/title identity pair; bundle-content guards + agent-doc strip; Dockerfile healthcheck

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-06-02

Public hosted endpoint at cpsc-recalls.caseyjhand.com/mcp

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-06-01 · 🛡️ Security

Initial public release — cpsc_search_recalls, cpsc_get_recall, cpsc_get_recent over the CPSC saferproducts.gov API

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-31

Initial release — CPSC recall search, details, and product lookup via MCP
