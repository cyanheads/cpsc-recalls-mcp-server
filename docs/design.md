# CPSC Recalls MCP Server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `cpsc_search_recalls` | Search consumer product recalls by product name, brand/manufacturer, retailer, hazard description, or date range. Primary lookup tool. | `product_name`, `manufacturer`, `retailer`, `hazard`, `date_start`, `date_end`, `limit` | `readOnlyHint`, `idempotentHint` |
| `cpsc_get_recall` | Full detail for a single recall by recall number. Returns hazard, remedy, all product variants, incident reports, images, and the CPSC recall URL. | `recall_number` | `readOnlyHint`, `idempotentHint` |
| `cpsc_get_recent` | Most recent CPSC recalls, ordered newest-first. Scoped to a date window (defaults last 30 days). Quick feed for "what's been recalled lately?" | `days`, `limit` | `readOnlyHint` |

### Resources

None. All data is reachable via the tool surface. The search/get pattern doesn't benefit from injectable resource URIs — a tool-only agent can accomplish everything this server is for.

### Prompts

None. The domain is narrow enough that tool descriptions and output formatting carry the context an agent needs.

---

## Overview

Keyless REST access to the CPSC (Consumer Product Safety Commission) recall database at `saferproducts.gov`. Covers consumer product recalls — toys, electronics, furniture, appliances, children's products, tools, clothing — everything under CPSC jurisdiction. Complements `openfda-mcp-server` (food/drugs/devices) and `nhtsa-vehicle-safety-mcp-server` (vehicles/tires); together the three servers answer "is this recalled?" across the full consumer landscape.

**Jurisdiction boundary:** CPSC does **not** cover food, drugs, cosmetics (FDA), motor vehicles and tires (NHTSA), boats (USCG), pesticides (EPA), or firearms (ATF/CPSC shared for certain items). The server surfaces this boundary in output so agents route correctly.

**Audience:** Consumers ("is this crib brand safe?"), parents ("any recent baby product recalls?"), journalists, safety researchers, retail buyers, and agents composing a broader product-safety workflow.

---

## Requirements

- No API key required
- Single search endpoint: `GET https://www.saferproducts.gov/RestWebServices/Recall?format=json`
- All filters are optional substring matches against their respective fields; filters combine with implicit AND
- No pagination — the API returns all matching records in a single response (verified: 9,828 total records returned with no filters; filtered queries return the full matching set)
- No `limit` or `offset` params on the upstream API — limiting happens client-side after fetch
- Response is a JSON array; empty array `[]` means no matches (not an error)
- The API returns `405 Method Not Allowed` on HEAD requests; GET only
- Ordering of unfiltered response is newest-first by `RecallDate`
- **`RecallDescription` filter searches the `Description` field only** — it does NOT search `Title`, `Hazards[].Name`, or any other field. Verified: searching a term that appears only in Title returns 0 results; searching the same term in Description returns correct results.
- **`RecallNumber` format:** modern records (2002–present) are always 5-digit numeric (e.g., `"25043"`); historical records from 1998–2001 are 6-character alphanumeric with a letter suffix (e.g., `"99003a"`, `"01160c"`). The letter suffix identifies sub-recalls within a single release day. All 9,717 post-2001 records are purely `\d{5}`; 111 records from 1998–2001 follow `\d{5}[a-d]`. The API's `RecallNumber` filter works with both formats.
- `Products` array can have **multiple entries per recall** (817 of 9,828 records in full dataset have 2+ products). `ProductUPCs` is at the recall level (not per-product) — when a multi-product recall has UPCs, those UPCs are ambiguous as to which product they belong to.
- Field sparsity is high: `SoldAtLabel` (always null), `HazardType`/`HazardTypeID` (always empty), `CategoryID` (always empty), `CompanyID` on manufacturer/retailer objects (always empty), `Products[].Model` (almost always empty — rare exceptions exist but weren't found in probing 2020–2025 data), `Products[].Description` (always empty in full dataset), `ProductUPCs` (present on ~4% of records — 13/324 in 2023, 1/25 in Jan 2025 sample)

---

## API Response Shape (verified)

Top-level fields on every recall record:

```
RecallID          integer     internal DB id
RecallNumber      string      5-digit numeric for 2002+ records, e.g. "25043"; 6-char with letter suffix for 1998–2001 records, e.g. "99003a"
RecallDate        string      ISO 8601, e.g. "2024-11-14T00:00:00"
LastPublishDate   string      ISO 8601
Title             string      recall title (always present)
Description       string      full text description (always present)
URL               string      canonical CPSC recall page URL (always present)
ConsumerContact   string|null contact instructions (occasionally null)
SoldAtLabel       null        always null in practice — omit from output schema
Products          array       see below
Inconjunctions    array       [ { URL: string } ] — links to coordinated foreign-agency recalls; populated ~30% of records (verified: 95/305 in 2024, 185/616 in 2022–2023)
Images            array       [ { URL: string, Caption: string } ] — always present (may be empty [])
Injuries          array       [ { Name: string } ] — free-text narrative; "None reported" when no incidents
Manufacturers     array       [ { Name: string, CompanyID: "" } ] — often empty (retailer/importer may be the primary org)
Retailers         array       [ { Name: string, CompanyID: "" } ] — narrative text incl. date + price
Importers         array       [ { Name: string, CompanyID: "" } ]
Distributors      array       [ { Name: string, CompanyID: "" } ]
ManufacturerCountries array   [ { Country: string } ]
ProductUPCs       array       [ { UPC: string } ] — sparse (~4% of records)
Hazards           array       [ { Name: string, HazardType: "", HazardTypeID: "" } ] — Name is the narrative; HazardType/ID always empty
Remedies          array       [ { Name: string } ] — free-text remedy instructions
RemedyOptions     array       [ { Option: string } ] — enum: "Refund" | "Repair" | "Replace" | "Dispose" | "Label" | "New Instructions" — multiple options possible
```

`Products` array item:
```
Name              string      product name (always present)
Description       string      always empty in full dataset — do not expose
Model             string      almost always empty (even for Samsung Note7 — model info is in Description text instead)
Type              string      usually empty
CategoryID        string      always empty
NumberOfUnits     string      narrative, e.g. "About 2,500"
```

**Multi-product recalls:** 817 of 9,828 records in the full dataset have 2+ entries in `Products`. The output schema must support `products` as an array (not a single object). When a multi-product recall also has `ProductUPCs`, those UPCs are at the recall level and cannot be attributed to individual products — callers should treat them as applying to the entire recall.

**Key API surprise:** Model numbers are embedded in the `Description` text field of the recall, not in `Products[].Model`. The model/UPC matching use-case must search the recall description and title text, not a structured field. `ProductUPCs` is a structured array but sparse.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `CpscRecallService` | `saferproducts.gov` REST API | `cpsc_search_recalls`, `cpsc_get_recall`, `cpsc_get_recent` |

Single service, single endpoint. Init fetches nothing — the API is stateless per-request. No auth config.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| _(none)_ | — | API is keyless; no config required |

The service layer uses the mcp-ts-core `fetchWithTimeout` + `withRetry` utilities. No server-specific config schema needed.

---

## Implementation Order

1. `CpscRecallService` — fetch + parse + normalize
2. `cpsc_search_recalls` — primary search tool
3. `cpsc_get_recall` — single recall by number
4. `cpsc_get_recent` — recent feed (thin wrapper over search)

Each is independently testable against the live API or a mock response fixture.

---

## Tool Specifications

### `cpsc_search_recalls`

**Purpose:** Search consumer product recalls by product, brand, retailer, hazard, or date range. The go-to tool for "has this product been recalled?" or "what recalls involve this brand?"

**Upstream endpoint:** `GET https://www.saferproducts.gov/RestWebServices/Recall?format=json&{filters}`

**Upstream params used:**
- `ProductName` → `product_name`
- `Manufacturer` → `manufacturer`
- `Retailer` → `retailer`
- `Importer` → `importer`
- `RecallDescription` → `description_search` (broader text search — searches the recall Description field)
- `RecallDateStart` / `RecallDateEnd` → `date_start` / `date_end`

**Note:** `Hazard` filter was verified to return 0 results even for common terms ("fire", "Fire") despite being a documented parameter. `RecallDescription` with hazard keywords is more reliable — use that for hazard-type filtering.

**Input schema:**
```ts
z.object({
  product_name: z.string().optional()
    .describe('Product name to search for, e.g. "crib", "space heater", "bicycle". Substring match — partial names work.'),
  manufacturer: z.string().optional()
    .describe('Manufacturer name, e.g. "Samsung", "LEGO". Substring match against the Manufacturers array. Note: many recalls list the importer or retailer as the primary org rather than the manufacturer — try `importer` or `retailer` if this returns no results.'),
  retailer: z.string().optional()
    .describe('Retailer name, e.g. "Walmart", "Target", "Amazon". Substring match against the retailer narrative (which includes store name, dates sold, and price).'),
  importer: z.string().optional()
    .describe('Importer company name. Use when searching for recalls by the company that brought the product into the US.'),
  description_search: z.string().optional()
    .describe('Keyword search within the recall Description field only (does not search Title or Hazards text). Use for hazard types like "fire", "choking", "burn", or to find product details not captured in product_name. Note: hazard keywords often appear in the Description field — this is the correct filter for hazard-type searching since the Hazard filter param is non-functional.'),
  date_start: z.string().optional()
    .describe('Include only recalls on or after this date. ISO 8601 format: "YYYY-MM-DD".'),
  date_end: z.string().optional()
    .describe('Include only recalls on or before this date. ISO 8601 format: "YYYY-MM-DD".'),
  limit: z.number().int().min(1).max(200).default(20)
    .describe('Maximum number of results to return (applied client-side — the API returns all matches). Defaults to 20.'),
})
```

**Output schema:**
```ts
z.object({
  recalls: z.array(z.object({
    recall_number: z.string()
      .describe('Recall identifier (5-digit numeric for 2002+ records, e.g. "25043"; 6-char with letter suffix for 1998–2001 records, e.g. "99003a"). Pass to cpsc_get_recall for full detail.'),
    recall_date: z.string()
      .describe('Date the recall was issued, ISO 8601.'),
    title: z.string()
      .describe('Official recall title.'),
    hazards: z.array(z.string())
      .describe('Hazard descriptions — what is dangerous about this product.'),
    remedy_options: z.array(z.string())
      .describe('Remedy types: Refund, Repair, Replace, Dispose, Label, New Instructions. Multiple may apply.'),
    remedy_summary: z.string()
      .describe('Full remedy instructions — what the consumer should do and how to claim.'),
    products: z.array(z.object({
      name: z.string().describe('Product name.'),
      units_recalled: z.string().describe('Estimated number of units recalled, e.g. "About 2,500".'),
      upcs: z.array(z.string()).describe('UPC codes associated with this recall (sparse — ~4% of records). Note: UPCs are stored at the recall level in the API, not per-product; when a recall covers multiple products, all UPCs apply to the recall as a whole.'),
    })).describe('Products covered by this recall.'),
    manufacturers: z.array(z.string())
      .describe('Manufacturer names. Often empty — importer or retailer may be listed instead.'),
    importers: z.array(z.string())
      .describe('Importer company names.'),
    retailers: z.array(z.string())
      .describe('Retailer names and sale details (narrative text including stores, dates, price range).'),
    cpsc_url: z.string()
      .describe('Official CPSC recall page URL for human verification.'),
    images: z.array(z.object({
      url: z.string().describe('Image URL.'),
      caption: z.string().describe('Image caption.'),
    })).describe('Product images from the recall notice.'),
    jurisdiction_note: z.string().optional()
      .describe('Present only when CPSC jurisdiction is ambiguous: states what this recall does NOT cover.'),
  })).describe('Matching recalls, ordered newest-first.'),
  total_found: z.number().describe('Total matching records before limit was applied.'),
  truncated: z.boolean().describe('True when total_found exceeds the limit.'),
  cpsc_jurisdiction: z.string()
    .describe('CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF). For those categories, use the appropriate server.'),
})
```

**Error contract:**
```ts
errors: [
  {
    reason: 'no_results',
    code: JsonRpcErrorCode.NotFound,
    when: 'No recalls matched the search filters',
    recovery: 'Broaden the search — try a shorter product name, fewer filters, or remove the date range. Check CPSC jurisdiction: food, vehicle, and drug recalls are not in this database.',
  },
  {
    reason: 'upstream_error',
    code: JsonRpcErrorCode.ServiceUnavailable,
    when: 'The saferproducts.gov API returned an error or timed out',
    recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
    retryable: true,
  },
]
```

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`

**format() rendering:**
Lead with hazard + remedy for each recall. Structure:
```
## [RecallNumber] — Title (RecallDate)
**Hazard:** {hazards joined}
**Remedy:** {remedy_options} — {remedy_summary}
**Products:** {product names and units}
**UPCs:** {recall-level upcs if present (sparse — ~4% of records)}
**Sold by:** {retailers}
**Manufacturer/Importer:** {manufacturer or importer}
**Images:** {count} — [View recall]({cpsc_url})
---
```
End with: `Showing N of M recalls. | CPSC covers: {jurisdiction note}`

---

### `cpsc_get_recall`

**Purpose:** Full detail for a single recall by recall number. Use after `cpsc_search_recalls` to get complete information: full description, every product variant, all images, incident count, and the exact remedy claim process.

**Upstream endpoint:** `GET https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber={recall_number}`

**Input schema:**
```ts
z.object({
  recall_number: z.string()
    .regex(/^\d{5}([a-d])?$/)
    .describe('CPSC recall number. Modern records (2002–present) are 5-digit numeric, e.g. "25043". Historical records from 1998–2001 may have a letter suffix, e.g. "99003a". Obtain from cpsc_search_recalls results.'),
})
```

**Output schema:**
```ts
z.object({
  recall_number: z.string().describe('Recall identifier.'),
  recall_date: z.string().describe('Date issued, ISO 8601.'),
  last_updated: z.string().describe('Date last published, ISO 8601.'),
  title: z.string().describe('Official recall title.'),
  description: z.string().describe('Full recall description including product identification details.'),
  cpsc_url: z.string().describe('Official CPSC recall page — authoritative source for consumers.'),
  consumer_contact: z.string().nullable().describe('Contact information for claiming the remedy.'),

  hazards: z.array(z.object({
    description: z.string().describe('What is dangerous about this product.'),
  })).describe('Hazards — read this first.'),

  remedy_options: z.array(z.string())
    .describe('Remedy types available: Refund, Repair, Replace, Dispose, Label, New Instructions.'),
  remedy_instructions: z.string()
    .describe('Full remedy instructions — exactly what a consumer should do and how to claim.'),

  products: z.array(z.object({
    name: z.string().describe('Product name.'),
    units_recalled: z.string().describe('Estimated number of units recalled, e.g. "About 2,500".'),
  })).describe('Products covered. A recall may include multiple products. Note: model numbers are often in the description text, not a structured field.'),

  upcs: z.array(z.string()).describe('UPC codes for this recall (sparse — ~4% of records have UPCs). UPCs are stored at the recall level in the API, not per-product; when the recall covers multiple products, UPC-to-product attribution is ambiguous.'),

  injuries: z.string().describe('Injury and incident report narrative, e.g. "None reported" or incident count.'),

  manufacturers: z.array(z.string()).describe('Manufacturer names (often empty — see importers).'),
  importers: z.array(z.string()).describe('Importer company names.'),
  retailers: z.array(z.string()).describe('Retailer names with sale date ranges and price.'),
  distributors: z.array(z.string()).describe('Distributor company names.'),
  manufacturer_countries: z.array(z.string()).describe('Countries of manufacture.'),

  images: z.array(z.object({
    url: z.string().describe('Image URL.'),
    caption: z.string().describe('Caption describing what the image shows.'),
  })).describe('Product and identification images from the recall notice.'),

  coordinated_recalls: z.array(z.string())
    .describe('URLs of coordinated recalls by other agencies (e.g., Canada Health).'),

  cpsc_jurisdiction: z.string()
    .describe('CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).'),
})
```

**Error contract:**
```ts
errors: [
  {
    reason: 'not_found',
    code: JsonRpcErrorCode.NotFound,
    when: 'No recall exists with the given recall number',
    recovery: 'Verify the recall number (e.g. "25043" for modern records, "99003a" for 1998–2001 historical records). Use cpsc_search_recalls to find the correct number.',
  },
  {
    reason: 'upstream_error',
    code: JsonRpcErrorCode.ServiceUnavailable,
    when: 'The saferproducts.gov API returned an error or timed out',
    recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
    retryable: true,
  },
]
```

**Annotations:** `readOnlyHint: true`, `idempotentHint: true`

**format() rendering:**
```
# [RecallNumber] — Title

**⚠️ Hazard:** {hazard descriptions}
**✅ Remedy:** {remedy_options} — {remedy_instructions}
**Contact:** {consumer_contact}

## Products Affected
{for each product: name, units}
**Note:** Model numbers are in the description text below if not listed here.
{if upcs present: **UPCs (recall-level):** {upcs joined} — applies to this recall as a whole}

## Description
{full description}

## Incidents / Injuries
{injuries narrative}

## Sold By
{retailers}

## Manufactured By / Imported By
{manufacturers / importers}
Country of origin: {manufacturer_countries}

## Images ({count})
{for each: caption — URL}

[View official CPSC recall page]({cpsc_url})
CPSC jurisdiction: {cpsc_jurisdiction}
```

---

### `cpsc_get_recent`

**Purpose:** Fetch the most recent CPSC recalls, ordered newest-first. Use for "what's been recalled lately?" or a product safety feed. Optionally scope to a date window.

**Upstream endpoint:** `GET https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={start}&RecallDateEnd={end}`

The no-filter endpoint returns all 9,828 records — too large to be useful. This tool always applies a date window, defaulting to the last 30 days.

**Input schema:**
```ts
z.object({
  days: z.number().int().min(1).max(365).default(30)
    .describe('Look back this many days from today. Defaults to 30. Use 7 for a weekly digest, 90 for a quarterly review.'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum number of recalls to return. Defaults to 20.'),
})
```

**Output schema:**
```ts
z.object({
  recalls: z.array(z.object({
    recall_number: z.string().describe('Recall identifier. Pass to cpsc_get_recall for full detail.'),
    recall_date: z.string().describe('Date issued, ISO 8601.'),
    title: z.string().describe('Recall title.'),
    hazards: z.array(z.string()).describe('What is dangerous.'),
    remedy_options: z.array(z.string()).describe('Remedy types.'),
    products: z.array(z.string()).describe('Product names recalled.'),
    cpsc_url: z.string().describe('Official CPSC recall page URL.'),
  })).describe('Recent recalls, newest-first.'),
  period: z.object({
    start: z.string().describe('Start date of the query window, ISO 8601.'),
    end: z.string().describe('End date (today), ISO 8601.'),
    days: z.number().describe('Window length in days.'),
  }).describe('Date range queried.'),
  total_found: z.number().describe('Total recalls in this period before limit was applied.'),
  truncated: z.boolean().describe('True when total_found exceeds the limit.'),
  cpsc_jurisdiction: z.string()
    .describe('CPSC covers consumer products — toys, electronics, furniture, appliances, tools, clothing. Does NOT cover: food/drugs (FDA), motor vehicles/tires (NHTSA), boats (USCG), pesticides (EPA), firearms (ATF).'),
})
```

**Error contract:**
```ts
errors: [
  {
    reason: 'upstream_error',
    code: JsonRpcErrorCode.ServiceUnavailable,
    when: 'The saferproducts.gov API returned an error or timed out',
    recovery: 'The CPSC API is occasionally unavailable. Retry in a few seconds.',
    retryable: true,
  },
]
```

**Annotations:** `readOnlyHint: true`

**format() rendering:**
```
# Recent CPSC Recalls — {start} to {end}

Found {total_found} recalls{truncation note}.

---
{for each recall:}
**{recall_date}** — [{recall_number}] {title}
Hazard: {hazards}  |  Remedy: {remedy_options}
Products: {product names}
[CPSC page]({cpsc_url})
---

CPSC jurisdiction: {cpsc_jurisdiction}
```

---

## Service Layer Plan

### `CpscRecallService`

**File:** `src/services/cpsc-recall/cpsc-recall-service.ts`

**Pattern:** Init/accessor (no persistent state — the API is stateless). Init just stores the base URL.

```ts
const BASE_URL = 'https://www.saferproducts.gov/RestWebServices/Recall';

// Service methods:
search(params: CpscSearchParams): Promise<RawRecall[]>
getByNumber(recallNumber: string): Promise<RawRecall | null>
getRecent(dateStart: string, dateEnd: string): Promise<RawRecall[]>
```

Each method:
1. Builds query string from params
2. Calls `fetchWithTimeout(url, { signal })` from `@cyanheads/mcp-ts-core/utils`
3. Wraps in `withRetry` — base delay 500ms (API is well-behaved, not heavily rate-limited)
4. Parses JSON array
5. Returns raw array (normalization happens in tool handlers)

**Normalization** (in tool handlers, not the service):
- `RecallDate` → strip time component, keep as ISO date string
- `Hazards[].Name` → extract to `string[]`, drop empty `HazardType`/`HazardTypeID`
- `Remedies[].Name` → join if multiple (observed: always exactly 1 entry in practice — never 0, never >1 across all probed data)
- `RemedyOptions[].Option` → extract to `string[]` (multiple entries are common — up to 2 options per recall; never 0)
- `Products[]` → map to `{ name, units: NumberOfUnits }` — drop empty Model/Type/CategoryID/Description (Description is always empty in full dataset)
- `Manufacturers[].Name`, `Retailers[].Name`, etc. → extract name strings, drop empty CompanyID
- `ManufacturerCountries[].Country` → extract to `string[]`
- `ProductUPCs[].UPC` → extract to `string[]` at the **recall level** (not per-product — the API stores UPCs as a top-level array, unattributed to individual products)
- `Injuries[].Name` → join if multiple (in practice always exactly one entry)
- `Inconjunctions[].URL` → extract to `string[]`
- `SoldAtLabel`, `HazardType`, `HazardTypeID`, `CategoryID`, `CompanyID`, `RecallID`, `Products[].Description` → **omit entirely** from output (always null/empty in full dataset)

---

## Domain Mapping

| Noun | API Filter | Notes |
|:-----|:-----------|:------|
| Recall | `RecallNumber` | Direct lookup — exact recall number string (5-digit for 2002+; `\d{5}[a-d]` for 1998–2001 historical records) |
| Product | `ProductName` | Substring match in product name |
| Brand/Org | `Manufacturer`, `Retailer`, `Importer` | Substring matches against separate arrays; try all three if a brand appears in multiple roles |
| Hazard | `RecallDescription` | `Hazard` param is documented but verified to return 0 results — use description search with hazard keywords instead |
| Date | `RecallDateStart`, `RecallDateEnd` | ISO 8601 date strings |

---

## Known Limitations

1. **No pagination** — the API returns all matching records at once. For broad queries (e.g., `Retailer=Walmart` returns 476 records), the tool applies a client-side `limit`. Agents that need the full set should narrow by date range.

2. **`Products[].Model` is almost always empty** — model numbers are embedded in the recall `Description` text rather than a structured field. Matching by specific model number requires description text search (`description_search`), not a dedicated `model` parameter. The design note to "match by model/UPC" is partially satisfied: UPCs are structured (when present); model matching depends on description search. Make this explicit in the tool description so agents don't assume a structured model lookup is possible.

3. **`Hazard` filter doesn't work** — verified against the live API: `Hazard=fire` and `Hazard=Fire` both return 0 results despite being a documented parameter. Hazard-type filtering must use `RecallDescription` with hazard keywords.

4. **Retailers/manufacturers as narrative strings** — retailer and manufacturer fields contain prose (e.g., "In-store at Target, Macy's, and Snappy and online at Target.com from February 2025 through February 2026 for about $130"). These are not structured, but they contain useful sale date and price context.

5. **~4% UPC coverage** — `ProductUPCs` is sparse. Most recalls won't have UPCs. Agents asking "is my specific product unit recalled?" should check UPCs when available, then fall through to brand+product name matching.

6. **CPSC jurisdiction boundary** — consumer product recalls only. Every tool output includes the `cpsc_jurisdiction` field so agents know to route food/drug/vehicle questions elsewhere.

---

## Workflow Analysis

**`cpsc_search_recalls`** (1 upstream call):

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `GET /Recall?format=json&{filters}` | Returns all matching records (array) |
| — | Client-side `slice(0, limit)` | Apply limit after fetch |

**`cpsc_get_recall`** (1 upstream call):

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `GET /Recall?format=json&RecallNumber={n}` | Returns array; expect length 0 or 1 |

If array is empty → throw `not_found` error.

**`cpsc_get_recent`** (1 upstream call, same shape as search):

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `GET /Recall?format=json&RecallDateStart={start}&RecallDateEnd={today}` | Date-windowed recall list |
| — | Client-side `slice(0, limit)` | Apply limit after fetch |

No tool makes more than one upstream call. The API design makes multi-call workflows unnecessary.

---

## Design Decisions

| Decision | Rationale |
|:---------|:----------|
| Three tools, not one | `search` + `get` + `recent` follow a clear two-hop workflow: discover → detail. `recent` is a distinct UX pattern (heartbeat feed, no search intent) that merits its own ergonomic entry point. Collapsing into one `search` tool with a `mode` enum would add complexity with no gain. |
| Hazard filter uses `description_search` not `Hazard` param | Live API probing confirmed the `Hazard` query param returns 0 results for all tested values ("fire", "Fire", "choking"). `RecallDescription` keyword search works and is documented as such. The dead param is not exposed. |
| No `Hazard` param despite it being documented | Same as above — verified broken, misleading to expose, replaced with `description_search`. |
| Output leads with hazard + remedy | Matches the idea.md design note. An agent parsing a recall summary needs the answer to "what's dangerous and what do I do?" first, not the catalog of model numbers. |
| Model number matching is explicit about its limitations | The idea.md notes to match by "model/UPC, not just product name" — but `Products[].Model` is almost always empty in practice. The tool descriptions and Known Limitations make this explicit so agents use `description_search` for model-level matching. |
| `cpsc_jurisdiction` in every output | Every response includes the jurisdiction boundary string. Agents answering product-safety questions need to know when to route to `openfda` or `nhtsa`. Embedding it in the response (not just the description) ensures it reaches both `structuredContent` and `content[]` surfaces. |
| UPCs at recall level, not per-product | The API's `ProductUPCs` array is at the recall level (not nested under `Products`). Verified with 9 multi-product recalls that also have UPCs — all UPCs appear without per-product attribution. UPCs are surfaced as a top-level recall field in output; agents are told attribution is ambiguous for multi-product recalls. |
| No `Importer` exposed as separate search input from `cpsc_search_recalls` | Added `importer` as an optional input alongside `manufacturer` and `retailer`. Importers are often the primary responsible party (especially for consumer goods from Asia) and are a separate filterable field on the API. Useful to expose since many recalls have empty `Manufacturers` but populated `Importers`. |
| No DataCanvas / MirrorService | 9,828 total records, ~300 per year — small enough that filtered queries fit comfortably in context. The API is fast enough (single GET) that a live query per request is fine. No need for a local mirror or analytical canvas. |
| Client-side limit, not upstream | The API offers no `limit`/`offset` — returns all matching records. The server fetches all matches and slices. `total_found` and `truncated` are included in output so the agent knows when results were cut. |
| `RecallNumber` regex `^\d{5}([a-d])?$` | Full-dataset analysis: 9,717 records are 5-digit numeric (`\d{5}`); 111 records from 1998–2001 are 6-character with a letter suffix (`\d{5}[a-d]`). All post-2001 records are purely numeric. The regex `^\d{5,7}$` in the original design was wrong — it allowed 6- and 7-digit purely numeric strings (which don't exist) but rejected valid historical alphanumeric strings like "99003a". |
| `SoldAtLabel` / `HazardType` / `HazardTypeID` / `CompanyID` / `CategoryID` / `Products[].Description` omitted from output | Verified always null or empty across the full dataset. Including them adds noise without value. If the API populates them in the future, the normalization layer will need updating — noted in service comments. |
| UPCs are recall-level, not per-product — UPC-to-product attribution is ambiguous for multi-product recalls | `ProductUPCs` is a top-level array on the recall record, not nested under individual `Products[]` entries. Verified with 9 multi-product recalls that also have UPCs: all UPCs appear at the top level without per-product attribution. Output design reflects this — UPCs are shown at the recall level, not per-product. |
