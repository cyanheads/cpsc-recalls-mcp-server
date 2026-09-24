<div align="center">
  <h1>@cyanheads/cpsc-recalls-mcp-server</h1>
  <p><b>Search and retrieve US consumer product recalls from the CPSC (Consumer Product Safety Commission) via MCP. STDIO or Streamable HTTP.</b>
  <div>3 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/cpsc-recalls-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/cpsc-recalls-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/cpsc-recalls-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0+-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/cpsc-recalls-mcp-server/releases/latest/download/cpsc-recalls-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=cpsc-recalls-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvY3BzYy1yZWNhbGxzLW1jcC1zZXJ2ZXIiXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22cpsc-recalls-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fcpsc-recalls-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://cpsc-recalls.caseyjhand.com/mcp](https://cpsc-recalls.caseyjhand.com/mcp)

</div>

---

## Overview

Consumer product recalls from the CPSC [saferproducts.gov](https://www.saferproducts.gov/) database — toys, electronics, furniture, appliances, children's products, tools, and clothing. Search recalls by product, brand, retailer, or hazard, fetch full detail for a specific recall number, or pull a recent-recalls feed for a date window. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `cpsc_search_recalls` | Search consumer product recalls by title, product name, brand, retailer, importer, distributor, hazard, remedy, or description keyword, with optional date filtering and offset paging |
| `cpsc_get_recall` | Full detail for a single recall by recall number — hazards, remedy, products, injuries, images, and the official CPSC page |
| `cpsc_get_recent` | Fetch the most recent recalls ordered newest-first, scoped to a configurable date window |

CPSC jurisdiction is consumer products only — food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), and pesticides (EPA) are not in this database; every response carries a jurisdiction note.

## Capability reference

### `cpsc_search_recalls` <sub>tool</sub>

- Nine text filters — `product_name`, `manufacturer`, `retailer`, `importer`, `distributor`, `title_search`, `description_search`, `remedy` (free-text instructions, not the `remedy_options` categories), and `hazard_search` (hazard text, product names, or remedy instructions; `hazard` is accepted as an alias) — all combine with AND; `title_search` is usually highest-signal
- A search needs at least one criterion — a non-blank text filter or a date bound; `limit`/`offset` alone fail with `missing_criteria`, whose hint points browsing to `cpsc_get_recent`. A blank or whitespace-only filter counts as omitted
- Word matching: every whitespace-separated word of a text filter must appear in that filter's field, in any order and case-insensitively; straight and curly apostrophes match each other, and `%`, `_`, and `[…]` match literally. Words match the plain text the results show, so `Stoopher & Boots` matches a record CPSC stores as `Stoopher &amp; Boots`, and tag markup such as `valign` matches nothing. No stemming or fuzzy matching. Each text filter accepts up to 500 characters
- Two independent date axes: `date_start`/`date_end` bound the recall issue date, `updated_start`/`updated_end` bound the date CPSC last published it; all four must be real calendar dates and a reversed range throws `invalid_date_range`
- `limit` (1–200, default 20) and `offset` (default 0) page through `total_found`, which counts every match before the window; a page returns fewer than `limit` recalls when it reaches the 64,000-byte response size budget, and its notice names the offset to continue from. `has_more` is the paging signal and `truncated` always equals it
- Returns hazard descriptions, remedy options and instructions, products, UPCs, manufacturer/importer/retailer/distributor names, images, `cpsc_url`, and per-recall `data_quality_notes`; manufacturer and importer render as separate roles — try `importer`, `retailer`, or `distributor` when `manufacturer` comes back empty
- Zero matches is an empty success, not an error: `effectiveQuery` echoes the criteria as applied, and a notice says which criterion to relax (the count before `hazard_search` emptied the set, fewer words, another company role, wider dates). An offset past the last match returns an empty page with its own notice. `upstream_rejected` (non-retryable) relays CPSC's own rejection, `upstream_error` (retryable) covers transient outages, including a temporary CPSC data-source failure the server has already retried once

---

### `cpsc_get_recall` <sub>tool</sub>

- Accepts modern 5-digit recall numbers (e.g. `"25043"`) and historical 1998–2001 records with letter suffixes (e.g. `"99003a"`); a malformed number is rejected as invalid input with both forms spelled out
- Returns the complete record — full description, all hazard and remedy detail, every product variant, UPCs, incident/injury narrative, manufacturer/importer/retailer/distributor names, country of manufacture, images, and coordinated-agency recall URLs
- `description` is nullable — a small number of genuine CPSC records carry no description text, and model numbers are usually embedded there rather than in a structured field
- Manufacturer and importer render under separate headings so role attribution survives into `content[]`
- `data_quality_notes` records gaps in the upstream record (absent description, hazard text, or product entries); empty when nothing is missing
- `not_found` when the recall number doesn't exist — resolve one via `cpsc_search_recalls` or `cpsc_get_recent` first; `upstream_rejected` (non-retryable) relays CPSC's own rejection, `upstream_error` (retryable) covers transient outages, including a temporary CPSC data-source failure the server has already retried once

---

### `cpsc_get_recent` <sub>tool</sub>

- Look-back window of 1–365 days (default 30), anchored to today; older recalls are reachable through `cpsc_search_recalls` date bounds
- `limit` (1–100, default 20) and `offset` (default 0) page through `total_found`; a page returns fewer than `limit` recalls when it reaches the 64,000-byte response size budget. Narrowing `days` cannot page further back — the window is anchored to today, so shrinking it drops the oldest records rather than advancing past the newest
- `has_more` is the paging signal and `truncated` always equals it; an empty window, an offset past the last recall, and a budget-cut page each carry a notice saying what to do next
- Returns a lightweight record per recall — number, date, title, hazards, remedy types, product names, `cpsc_url` — plus `data_quality_notes` for gaps CPSC left empty
- Use `cpsc_get_recall` to retrieve full detail for any result

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

CPSC-specific:

- Full client for the CPSC saferproducts.gov public recalls API — search, single-recall detail, and a recent-recalls feed
- Every-word matching on all nine text filters, applied over the complete result set before paging so `total_found` and `has_more` stay accurate
- Handles both modern 5-digit recall numbers and historical 1998–2001 records with letter suffixes
- Jurisdiction boundary documented in every response — flags food, vehicle, and drug recalls as out of scope before an agent misattributes them

Agent-friendly output:

- Provenance on every response — `source_note`, `cpsc_url`, and `(CPSC source text)` blockquote labels distinguish relayed CPSC narrative from the server's own guidance
- Plain text on both surfaces — the HTML markup and character codes CPSC stores in some records (`&amp;`, `<br>`, stray table tags) are converted to plain text before matching and output, and `content[]` escapes Markdown so model and serial numbers such as `1HFVE05**K4000003` keep every character; recall page, image, and coordinated-recall addresses that contain spaces are percent-encoded in `content[]` so each renders as one working link, while `structuredContent` carries them as CPSC stores them
- Pagination discriminators — `total_found`, `offset`, `has_more`, and `truncated` on every search/recent response so agents can tell when results are clipped and page with `offset`; each surface of a page stays within a 64,000-byte budget, and a notice gives the next offset when the budget ends a page early
- `data_quality_notes` on every response — gaps observed in the upstream record (missing hazard text, no product entries), derived from which fields CPSC left blank rather than any judgment call
- Jurisdiction note (`cpsc_jurisdiction`) on every response — lets agents route callers to the correct agency (FDA, NHTSA, USCG, EPA) when a product is out of scope

## Getting started

### Public Hosted Instance

A public instance is available at `https://cpsc-recalls.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "cpsc-recalls-mcp-server": {
      "type": "streamable-http",
      "url": "https://cpsc-recalls.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "cpsc-recalls-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/cpsc-recalls-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "cpsc-recalls-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/cpsc-recalls-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "cpsc-recalls-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/cpsc-recalls-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No API key required — the CPSC public recalls API is freely accessible.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/cpsc-recalls-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd cpsc-recalls-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env if needed — no required API keys
```

## Configuration

All configuration is validated at startup via Zod schemas. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_HOST` | HTTP server host | `127.0.0.1` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin for TLS-terminating reverse-proxy deployments | — |
| `MCP_SESSION_MODE` | Session handling: `auto`, `stateful`, or `stateless`. The server declares `stateless` in `src/index.ts`; setting this overrides it. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`) | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

No server-specific API keys are required. See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run the production version:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck  # Lint, format, typecheck, security
  bun run test      # Vitest test suite
  ```

### Docker

```sh
docker build -t cpsc-recalls-mcp-server .
docker run --rm -p 3010:3010 cpsc-recalls-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/cpsc-recalls-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools and inits the CPSC service |
| `src/mcp-server/tools` | Tool definitions (`definitions/*.tool.ts`) — search, get-recall, get-recent — plus `response-budget.ts`, the page size budget the two list tools share, and `markdown-escape.ts`, the escaping applied to CPSC text in `content[]` |
| `src/services/cpsc-recall` | CPSC recall service — API client, types, and `normalize-text.ts`, which converts CPSC's HTML markup and character codes to plain text |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) / [`AGENTS.md`](./AGENTS.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools in the `createApp()` arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
