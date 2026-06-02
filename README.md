<div align="center">
  <h1>@cyanheads/cpsc-recalls-mcp-server</h1>
  <p><b>Search and retrieve US consumer product recalls from the CPSC (Consumer Product Safety Commission) via MCP. STDIO or Streamable HTTP.</b>
  <div>3 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/cpsc-recalls-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/cpsc-recalls-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/cpsc-recalls-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.0+-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/cpsc-recalls-mcp-server/releases/latest/download/cpsc-recalls-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=cpsc-recalls-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvY3BzYy1yZWNhbGxzLW1jcC1zZXJ2ZXIiXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22cpsc-recalls-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fcpsc-recalls-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://cpsc-recalls.caseyjhand.com/mcp](https://cpsc-recalls.caseyjhand.com/mcp)

</div>

---

## Tools

3 tools for searching and retrieving CPSC consumer product recall data:

| Tool | Description |
|:---|:---|
| `cpsc_search_recalls` | Search consumer product recalls by product name, brand, retailer, importer, or description keyword, with optional date filtering |
| `cpsc_get_recall` | Full detail for a single recall by recall number — hazards, remedy, products, injuries, images, and the official CPSC page |
| `cpsc_get_recent` | Fetch the most recent recalls ordered newest-first, scoped to a configurable date window |

**CPSC jurisdiction:** Consumer products only — toys, electronics, furniture, appliances, children's products, tools, and clothing. Food and drugs (FDA), motor vehicles and tires (NHTSA), boats (USCG), and pesticides (EPA) are not in this database. Every response includes a jurisdiction note.

Data sourced from the [U.S. Consumer Product Safety Commission](https://www.saferproducts.gov/) via the CPSC public recalls API.

### `cpsc_search_recalls`

Search recalls with flexible filtering across product, organization, and description fields.

- Filter by product name, manufacturer, retailer, importer, or description keyword — all fields are optional substring matches that combine with AND
- Date range filtering via `date_start` / `date_end` (ISO 8601)
- Client-side limit (1–200, default 20) applied after fetching all matching records
- Returns hazard descriptions, remedy options, remedy instructions, product list, UPCs, manufacturer/importer/retailer names, images, and the CPSC recall page URL
- Includes `total_found` and `truncated` fields for pagination awareness
- Note: the `Hazard` filter param is non-functional in the upstream API — use `description_search` for hazard-type keywords like "fire", "choking", or "burn"
- When `manufacturer` returns no results, try `importer` or `retailer` — many recalls list the importer as the primary organization

---

### `cpsc_get_recall`

Full detail for a single CPSC recall by recall number.

- Accepts modern 5-digit recall numbers (e.g. `"25043"`) and historical 1998–2001 records with letter suffixes (e.g. `"99003a"`)
- Returns the complete record: full description, all hazard descriptions, remedy type and instructions, all product variants with unit counts, UPCs, incident/injury narrative, manufacturer and importer names, retailer names with sale date ranges, country of manufacture, images, and coordinated agency recall URLs
- Model numbers are typically embedded in the description text, not in a structured field
- Use `cpsc_search_recalls` or `cpsc_get_recent` to find a recall number first

---

### `cpsc_get_recent`

Fetch the most recent CPSC recalls, ordered newest-first.

- Configurable look-back window of 1–365 days (default 30)
- Limit of 1–100 results (default 20)
- Always applies a date window — without one, the upstream API returns 9,800+ records
- Returns a lightweight record per recall: number, date, title, hazards, remedy types, product names, and CPSC URL
- Use `cpsc_get_recall` to retrieve full detail for any result

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

CPSC-specific:

- Full integration with the CPSC saferproducts.gov public recalls API
- Client-side filtering applied over complete API result sets for accurate `total_found` counts
- Jurisdiction boundary documented in every response — prevents misattribution of food, vehicle, or drug recalls

Agent-friendly output:

- Jurisdiction note on every response — agents can route callers to the correct agency (FDA, NHTSA, USCG, EPA) when the product is out of scope
- `total_found` + `truncated` fields on search/recent responses — agents can detect when results are clipped and suggest narrowing filters
- `cpsc_url` on every recall — authoritative source link for consumer verification

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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+).
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
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Three tools: search, get-recall, get-recent |
| `src/services/cpsc-recall` | CPSC recall service — API client, types, normalization |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) / [`AGENTS.md`](./AGENTS.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools in the `createApp()` arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
