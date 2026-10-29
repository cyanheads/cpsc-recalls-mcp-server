# CPSC Recalls MCP Server — Design

This records the design as reasoned before the build, kept for its rationale. Where a decision has since been revisited, the entry carries a **Superseded** note rather than being rewritten. The tool schemas in `src/mcp-server/tools/definitions/` are the authority on as-built behavior.

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `cpsc_search_recalls` | Search consumer product recalls by product name, brand/manufacturer, retailer, hazard description, or date range. Primary lookup tool. | `product_name`, `manufacturer`, `retailer`, `hazard`, `date_start`, `date_end`, `limit` — as built, `hazard` is `hazard_search` (client-side) and the tool also takes `importer`, `description_search`, `title_search`, `distributor`, `remedy`, `updated_start`, `updated_end`, `offset` | `readOnlyHint`, `idempotentHint` |
| `cpsc_get_recall` | Full detail for a single recall by recall number. Returns hazard, remedy, all product variants, incident reports, images, and the CPSC recall URL. | `recall_number` | `readOnlyHint`, `idempotentHint` |
| `cpsc_get_recent` | Most recent CPSC recalls, ordered newest-first. Scoped to a date window (defaults last 30 days). Quick feed for "what's been recalled lately?" | `days`, `limit` | `readOnlyHint` |

### Resources

None defined. All data is reachable via the tool surface. The search/get pattern doesn't benefit from injectable resource URIs — a tool-only agent can accomplish everything this server is for.

**Superseded in part:** the one resource is the published skill below, served as `skill://cpsc-recalls-guide/SKILL.md`.

### Skills

One published skill, `cpsc-recalls-guide` (`skills/cpsc-recalls-guide/SKILL.md`), served over MCP through `createApp({ skills: 'skills' })`. It exists because search-formulation gates and identifier quirks (one empty search is not "not recalled", substring matching, lettered recall numbers, model and UPC matching by description text, issue date versus last-published date) are too long and too cross-tool for tool descriptions, and an agent that skips them draws wrong conclusions from empty or partial results.

### Prompts

None. The domain is narrow enough that tool descriptions and output formatting carry the context an agent needs.

---

## Overview

Keyless REST access to the CPSC (Consumer Product Safety Commission) recall database at `saferproducts.gov`. Covers consumer product recalls — toys, electronics, furniture, appliances, children's products, tools, clothing — everything under CPSC jurisdiction. Complements `openfda-mcp-server` (food/drugs/devices) and `nhtsa-vehicle-safety-mcp-server` (vehicles/tires); together the three servers answer "is this recalled?" across the full consumer landscape.

**Jurisdiction boundary:** food, drugs, and cosmetics belong to FDA, on-road vehicles and their tires to NHTSA, boats to USCG, pesticides to EPA, and firearms to ATF. CPSC still holds recalls right next to those lines: child-resistant packaging for drugs and supplements (`23154`, `23227`), ATVs and snowmobiles (`23790`, `24722`), bicycle tires (`23276`), and gun safes and locks (`26607`, `25458`). The server surfaces this boundary in output, naming those products as CPSC's, so agents route the rest elsewhere without routing these away.

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
- **`RecallNumber` format:** five digits (`"25043"`, `"99162"`, `"83028"`), with a letter suffix `a`–`d` on some 1998–2001 records (`"99003a"`, `"01160c"`). Of 10,058 records (2026-10-29), 111 follow `\d{5}[a-d]`, all from 1998–2001; the other 614 records from those years and all 1,423 from 1973–1997 are plain `\d{5}`, like every record since. The 111 form 50 families that share a five-digit base: each member is a separate recall, usually issued the same day (three families span two dates), and no base number is itself a record. The API's `RecallNumber` filter is a case-insensitive substring match returned in no stable order, so the bare base of a family returns every lettered member.
- `Products` array can have **multiple entries per recall** (817 of 9,828 records in full dataset have 2+ products). `ProductUPCs` is at the recall level (not per-product) — when a multi-product recall has UPCs, those UPCs are ambiguous as to which product they belong to.
- Field sparsity is high: `SoldAtLabel` (always null), `HazardType`/`HazardTypeID` (always empty), `CategoryID` (always empty), `CompanyID` on manufacturer/retailer objects (always empty), `Products[].Model` (almost always empty — rare exceptions exist but weren't found in probing 2020–2025 data), `Products[].Description` (always empty in full dataset), `ProductUPCs` (present on ~4% of records — 13/324 in 2023, 1/25 in Jan 2025 sample)

---

## API Response Shape (verified)

Top-level fields on every recall record:

```
RecallID          integer     internal DB id
RecallNumber      string      5 digits, e.g. "25043"; a letter a–d follows on some 1998–2001 records, e.g. "99003a"
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

**Superseded:** `limit` accepts 1–10,000. A page holds at most 200 recalls, so a larger `limit` returns 200 with a notice naming the offset to continue from (see *Design Decisions*). Every text filter matches each of its words as a case-insensitive substring, with no stemming.

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

**Superseded:** each row also carries `last_updated` (the last-published date) and `distributors`, with the same values `cpsc_get_recall` returns, from the same single upstream request. `recall_number` is described as five digits with a letter `a`–`d` on some 1998–2001 records, not split at 2002. `cpsc_jurisdiction` names the products CPSC recalls next to other agencies' lines, and its last sentence tells the caller to search here before routing such a product to another agency instead of pointing to another server.

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

**Superseded:** zero matches is no longer an error. `no_results` is gone; an empty result is a success with `total_found: 0`, an `effectiveQuery` echo, and a notice that says which criterion to relax, because a zero-match search is a valid empty collection and the error envelope hid `total_found` from `structuredContent` readers. The contract as built: `missing_criteria` (no text filter or date bound — browsing belongs to `cpsc_get_recent`), `invalid_date_range`, `upstream_error` (retryable), and `upstream_rejected` (CPSC rejects the same request every time).

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

**Superseded:** the footer's last line reads `CPSC jurisdiction: {cpsc_jurisdiction}`, the same label the other two tools render, and all three tools carry one jurisdiction string (the search copy adds a sentence telling the caller to search here before routing a product near another agency's line away). Each record block also carries `**Last updated:** {last_updated}` after `CPSC source fields:`, and `**Distributor:** {distributors joined with '; '}` after the manufacturer/importer line when the recall has distributors.

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

**Superseded:** the `recall_number` text and the `not_found` recovery describe five digits with a letter `a`–`d` on some 1998–2001 records, not a 2002 split. The tool returns only the record whose number equals the request; for the bare base of a lettered family it fails `not_found` with a hint naming the separate lettered recalls (see *Design Decisions*). `cpsc_jurisdiction` names the products CPSC recalls next to other agencies' lines.

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

**Superseded:** `limit` accepts 1–10,000 and the tool also takes `offset`. A page holds at most 100 recalls, so a larger `limit` returns 100 with a notice naming the offset to continue from (see *Design Decisions*). `cpsc_jurisdiction` names the products CPSC recalls next to other agencies' lines.

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

**Superseded:** the service now converts the HTML residue in CPSC text to plain text before returning. Every string field, nested entries included, has its character references decoded and its tags removed (`normalize-text.ts`), so all three tools and the search word check see the same text. The field shaping below still happens in the tool handlers. A transient provider-failure error row also gets one retry in the service (see *Design Decisions*).

**Superseded:** every method takes the request `Context` as its last argument. `getByNumber(recallNumber, ctx)` returns `Promise<RecallLookup>`: `{ recall }` for the row whose `RecallNumber` equals the request case-insensitively, or `{ recall: null, otherNumbers }` with the numbers of the other rows CPSC returned, sorted. `withRetry` (up to 3 retries, backoff from 500 ms) runs under one 50 s deadline per call that also bounds each attempt's 30 s timeout and the reordered provider-failure query (see *Design Decisions*).

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
| Recall | `RecallNumber` | Lookup by recall number — five digits, with a letter `a`–`d` on some 1998–2001 records (`\d{5}[a-d]?`). CPSC matches the filter as a case-insensitive substring, so the service keeps only the row whose number equals the request |
| Product | `ProductName` | Substring match in product name |
| Brand/Org | `Manufacturer`, `Retailer`, `Importer` | Substring matches against separate arrays; try all three if a brand appears in multiple roles |
| Hazard | `RecallDescription` | `Hazard` param is documented but verified to return 0 results — use description search with hazard keywords instead. **Superseded:** hazard matching is now the client-side `hazard_search` input over hazard names, product names, and remedy text; `description_search` remains the narrow `RecallDescription` filter |
| Date | `RecallDateStart`, `RecallDateEnd` | ISO 8601 date strings |

---

## Known Limitations

1. **No pagination** — the API returns all matching records at once. For broad queries (e.g., `Retailer=Walmart` returns 476 records), the tool applies a client-side `limit`. Agents that need the full set should narrow by date range. **Superseded:** the upstream API still has no pagination, but `cpsc_search_recalls` and `cpsc_get_recent` take an `offset` and report `has_more`, so the full matching set is reachable by paging the client-side window instead of guessing a date boundary.

2. **`Products[].Model` is almost always empty** — model numbers are embedded in the recall `Description` text rather than a structured field. Matching by specific model number requires description text search (`description_search`), not a dedicated `model` parameter. The design note to "match by model/UPC" is partially satisfied: UPCs are structured (when present); model matching depends on description search. Make this explicit in the tool description so agents don't assume a structured model lookup is possible.

3. **`Hazard` filter doesn't work** — verified against the live API: `Hazard=fire` and `Hazard=Fire` both return 0 results despite being a documented parameter. Hazard-type filtering must use `RecallDescription` with hazard keywords. **Superseded:** the upstream param is still dead, but hazard filtering no longer routes through `RecallDescription` — `hazard_search` matches client-side against hazard names, product names, and remedy text.

4. **Retailers/manufacturers as narrative strings** — retailer and manufacturer fields contain prose (e.g., "In-store at Target, Macy's, and Snappy and online at Target.com from February 2025 through February 2026 for about $130"). These are not structured, but they contain useful sale date and price context.

5. **~4% UPC coverage** — `ProductUPCs` is sparse. Most recalls won't have UPCs. Agents asking "is my specific product unit recalled?" should check UPCs when available, then fall through to brand+product name matching.

6. **CPSC jurisdiction boundary** — consumer product recalls, including products next to other agencies' lines: child-resistant packaging for drugs and supplements, ATVs and snowmobiles, bicycle tires, and gun safes and locks. Every tool output includes the `cpsc_jurisdiction` field so agents route food, drug, on-road vehicle, boat, pesticide, and firearm questions elsewhere without routing those products away.

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

**Superseded:** the array is not always 0 or 1 long. The filter is a substring match, so the bare base of a lettered family (`01160`) returns every lettered member. The tool keeps only the row whose number equals the request; when none does, it throws `not_found`, with a hint naming the other numbers when there are any.

**`cpsc_get_recent`** (1 upstream call, same shape as search):

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `GET /Recall?format=json&RecallDateStart={start}&RecallDateEnd={today}` | Date-windowed recall list |
| — | Client-side `slice(0, limit)` | Apply limit after fetch |

No tool makes more than one upstream call. The API design makes multi-call workflows unnecessary.

**Superseded:** a call that CPSC answers with its provider-failure error row makes one more upstream call, the same query with `format` moved last.

---

## Design Decisions

| Decision | Rationale |
|:---------|:----------|
| Three tools, not one | `search` + `get` + `recent` follow a clear two-hop workflow: discover → detail. `recent` is a distinct UX pattern (heartbeat feed, no search intent) that merits its own ergonomic entry point. Collapsing into one `search` tool with a `mode` enum would add complexity with no gain. |
| Hazard filter uses `description_search` not `Hazard` param | Live API probing confirmed the `Hazard` query param returns 0 results for all tested values ("fire", "Fire", "choking"). `RecallDescription` keyword search works and is documented as such. The dead param is not exposed. **Superseded:** the dead param stays unexposed, but `description_search` is no longer the hazard path — `hazard_search` filters client-side, which reaches hazard names and product names that `RecallDescription` cannot. |
| No `Hazard` param despite it being documented | Same as above — verified broken, misleading to expose, replaced with `description_search`. **Superseded:** replaced with `hazard_search`. |
| Output leads with hazard + remedy | Matches the idea.md design note. An agent parsing a recall summary needs the answer to "what's dangerous and what do I do?" first, not the catalog of model numbers. |
| Model number matching is explicit about its limitations | The idea.md notes to match by "model/UPC, not just product name" — but `Products[].Model` is almost always empty in practice. The tool descriptions and Known Limitations make this explicit so agents use `description_search` for model-level matching. |
| `cpsc_jurisdiction` in every output | Every response includes the jurisdiction boundary string. Agents answering product-safety questions need to know when to route to `openfda` or `nhtsa`. Embedding it in the response (not just the description) ensures it reaches both `structuredContent` and `content[]` surfaces. **Superseded (wording):** the note no longer says CPSC does not cover drugs, tires, vehicles, or firearms, since CPSC recalls child-resistant packaging for drugs and supplements, ATVs and snowmobiles, bicycle tires, and gun safes and locks, and an agent reading the old note literally routed those away. It names those products as CPSC's and still names FDA, NHTSA, USCG, EPA, and ATF; the search copy's extra sentence tells the caller to search here before routing such a product to another agency. |
| UPCs at recall level, not per-product | The API's `ProductUPCs` array is at the recall level (not nested under `Products`). Verified with 9 multi-product recalls that also have UPCs — all UPCs appear without per-product attribution. UPCs are surfaced as a top-level recall field in output; agents are told attribution is ambiguous for multi-product recalls. |
| No `Importer` exposed as separate search input from `cpsc_search_recalls` | Added `importer` as an optional input alongside `manufacturer` and `retailer`. Importers are often the primary responsible party (especially for consumer goods from Asia) and are a separate filterable field on the API. Useful to expose since many recalls have empty `Manufacturers` but populated `Importers`. |
| No DataCanvas / MirrorService | 9,828 total records, ~300 per year — small enough that filtered queries fit comfortably in context. The API is fast enough (single GET) that a live query per request is fine. No need for a local mirror or analytical canvas. **Superseded (rationale only):** a filtered result does not fit in context by row count alone — a 200-record search page measured 376 KB, and the heaviest record is over 7× the median — so the list tools cap each page at 64,000 bytes (see *Response size budget*). Live per-request queries still stand; no mirror or canvas was added. |
| Client-side limit, not upstream | The API offers no `limit`/`offset` — returns all matching records. The server fetches all matches and slices. `total_found` and `truncated` are included in output so the agent knows when results were cut. **Superseded:** the slice now honors `offset`, and a page also stops at the 64,000-byte response budget, so it can hold fewer than `limit` records. `truncated` equals `has_more` — true exactly when matching records remain past the page — rather than tracking `total_found > limit`, which reported truncation on final and exhausted pages. |
| Every-word matching on text filters | CPSC matches each upstream parameter as one contiguous, case-insensitive substring, so `"Graco crib"` found nothing though two Graco crib recalls exist. Each text filter now requires every whitespace-separated word in its own field, in any order. The filter sends only its longest fragment free of apostrophes and brackets upstream, cut to 200 URL-encoded bytes (one word narrows the fetch; an apostrophe splits CPSC matches between `'` and `’`, and CPSC reads `[…]` as a character class that can exclude the record holding the brackets literally — `RecallDescription=[mm][dd][yy]` omits the one description containing that text), and every word — that one included — is checked locally, which makes CPSC's `%`, `_`, and `[…]` wildcards match literally. Straight and curly apostrophes fold together; no stemming or fuzzy matching. |
| `RecallDateStart=1970-01-01` floor when nothing else is sent | A request with no filter parameter has been observed to receive a snapshot that lagged filtered requests by a day's recalls (10,023 vs 10,027 records on 2026-09-24; the gap did not reproduce later that day), so a `hazard_search`-only search sends a date floor that precedes the oldest recall (1973-06-08) and takes the filtered path. The cost: the full 27.7 MB dataset still comes back, and the first request for the floor URL after the upstream cache expires is slow — 10.6 s cold, 0.26 s warm on 2026-09-24 — under the 30 s per-attempt timeout. |
| Response size budget | Row caps cannot bound bytes, because record size varies over 7×. Each list-tool page stops before either surface (`structuredContent` JSON, or `content[]` text with the enrichment trailer) would pass 64,000 UTF-8 bytes. A record is charged the larger of its two sizes, the page overhead reserves the worst-case header, footer, and notice, and a page always returns at least one record when any remain. A budget-cut page carries a notice naming the next offset. 64,000 keeps default 20-record pages whole. |
| Text filters capped at 500 characters | Without a cap, one oversized value became an oversized upstream URL and was echoed back in `effectiveQuery`, so a 70,000-character title search produced a 71 KB response with zero records. The longest CPSC recall title is 268 characters, so 500 refuses no realistic query; a longer value is rejected as invalid input (`-32602`) before any upstream request, and `tools/list` advertises `maxLength: 500`. The character cap alone does not bound the URL: CPSC answers a query string over 2,048 bytes with HTTP 404, and one 500-character value in a script that URL-encodes to nine bytes a character is 4,500 bytes. So the one word each filter forwards is also cut to its first 200 URL-encoded bytes (whole code points); eight such words plus every date bound stay near 1,830 bytes, and the local every-word check still applies the full word. |
| CPSC text normalized to plain text in the service | Of 10,027 records (2026-09-24), 15 carry HTML residue: `&amp;` in three retailer entries, and `br`/`p`/`td`/`tr` tags in 11 descriptions and one image caption, two of them cut off at the end of the string. The service decodes character references and removes tags once, after the error-row check, so both surfaces and the search word check see the same text. This removes false word matches on markup (`valign`, `amp`) and misses none. The pass is normalization, not correction: an unknown reference (`C&T;`), a reference to a control character other than tab, line feed, or carriage return (invisible once decoded, and HTML reads 128–159 as Windows-1252 punctuation), a bare `&`, `<` before a digit (`<5mW`), and residue with no `<` all stay as they are, a removed tag leaves a space or line break rather than joining its neighbours, and caller input is never decoded. It is one linear scan per string, and a full-dataset fetch spends about 20 ms normalizing. |
| Markdown escaped where CPSC text enters `content[]` | Rendered as CommonMark, 43 records lost characters. Literal `*` in serial and model patterns became emphasis in 41 of them and dropped the asterisks. The tools backslash-escape CPSC text as they interpolate it. A bare web address GFM autolinks stays bare only when it holds nothing to escape and no escaped `<` follows it. Otherwise it renders as `markdownLink(span, href)` over GFM's own link span (href = the span, or `http://` before a `www.` span), and the characters GFM trims from an autolink's end by cmark-gfm's rule (`? ! . , : * _ ~ " '`, an unbalanced `)`, an `&name;` entity, `;`) are escaped after the link, as is a `!` right before it. CommonMark has no extended autolinks, so a bare address there lost `*` and `_` to emphasis and decoded `&amp;`, while a backslash inside a GFM autolink shows literally and ends the link; backslashes inside the address were rejected for that reason, and `<…>` autolinks because they need a scheme and cannot carry `www.`. An address GFM leaves as plain text (a `www.` address after punctuation such as `"`, or a host with `_` in its last two labels), or whose href is not `http(s)`, is escaped like the text around it. Across the corpus (2026-10-29), 9 address-bearing text fields change encoding, 929 bytes in all. A carriage return becomes a line feed first, since CommonMark ends a line at either and an unescaped marker after one would open a block outside the quote. After that, every text field of every record renders unaltered under CommonMark and GFM. `cpsc_url` goes through as a percent-encoded link destination, since seven CPSC recall URLs contain spaces, with any backslash or character reference in it backslash-escaped so the destination is not decoded into a different address. Image and coordinated-recall addresses render bare, encoded the same way: 1,282 image URLs across 420 records contain spaces, and nine end in `.` or `_`, which GFM leaves out of an autolink, so that final character is percent-encoded too. Each rendered link then resolves to its stored address. An image entry that is not a web address (26796 holds a sentence) is escaped as text instead. The list tools escape inside `renderRecallBlock`, so the page budget charges the escaped bytes (up to 56 more on one search block). `structuredContent` stays unescaped. |
| One reordered retry on a CPSC provider failure | CPSC answers a transient data-source failure (`The underlying provider failed on Open.`) with an HTTP 200 error row, then serves that row from a server-side cache keyed on the exact query string. On 2026-09-24 the row held for 23085, 10208, and 09283 for over 24 minutes, while the same query with its parameters reordered, or a parameter name in a different case, returned the record at once. That error row gets one immediate retry with `format` moved last. A second failure surfaces as retryable `upstream_error` rather than a deterministic rejection that tells the caller to doubt a valid recall number. The fetch returns the failure as a value, so the retry loop never repeats a cached URL. Every other error row (`String was not recognized as a valid DateTime.`) stays non-retryable, with no retry. |
| `RecallNumber` regex `^\d{5}([a-d])?$` | Full-dataset analysis (10,058 records, 2026-10-29): every number matches. 111 records, all from 1998–2001, carry a letter suffix (`\d{5}[a-d]`); every other record is plain `\d{5}`, including 614 from 1998–2001 and all 1,423 from 1973–1997, so the suffix marks neither an era nor every record in one. The regex `^\d{5,7}$` in the original design was wrong — it allowed 6- and 7-digit purely numeric strings (which don't exist) but rejected valid historical alphanumeric strings like "99003a". |
| `cpsc_get_recall` matches the recall number exactly | CPSC's `RecallNumber` filter is a case-insensitive substring match returned in no stable order, so the bare base of a lettered family (`01160`) returned whichever separate lettered recall came first. Every one of the 50 lettered families has two or more members and no base number is itself a record, so a base is never the caller's recall. The service keeps only the row whose number equals the request, compared case-insensitively; when none does, `not_found` carries a hint naming the other numbers CPSC returned (`01160a, 01160b, 01160c are separate recalls, not parts of one recall`) from the same response, with no extra request. The declared `not_found` contract is unchanged. |
| One 50 s deadline per tool call | Each attempt had its own 30 s timeout, and `withRetry` (up to 3 retries, 500/1,000/2,000 ms backoff ±25%) plus the reordered provider-failure query could hold a call for about 249 s, far past the MCP SDK's default 60 s client timeout, so the caller saw a transport timeout instead of this server's error. One 50 s budget, measured from the start of the fetch, now covers every attempt, every backoff, and the reordered query, which gets what remains; each attempt's timeout is the lesser of 30 s and that remainder, and its signal also bounds the body read. Expiry surfaces from all three tools as retryable `upstream_error`, 10 s inside the client default. Caller cancellation stays a cancellation, never an expiry or a result, and a query that returned a provider-failure row is still never requested again. |
| Oversized `limit` served at the page ceiling | `limit` accepts 1–10,000 on both list tools. A page holds at most 200 search or 100 recent recalls; a `limit` between the page ceiling and 10,000 is served at the ceiling, with a notice (`Returned 200 of the 500 requested recalls: a page holds at most 200 recalls. Continue with offset 200 for the rest.`) only when the ceiling ended a page that has more after it. Rejecting a value with one clear reading costs the caller a retry; an unbounded value accepts absurd input, so 10,000 stays a hard ceiling (`-32602` above it, as for 0, negatives, and fractions). The 64,000-byte budget usually cuts a page first, and its notice keeps naming the caller's `limit`; the two notices never co-occur. `ctx.enrich.truncated()` is not used for this, because it collides with the output's `truncated` field. |
| `SoldAtLabel` / `HazardType` / `HazardTypeID` / `CompanyID` / `CategoryID` / `Products[].Description` omitted from output | Verified always null or empty across the full dataset. Including them adds noise without value. If the API populates them in the future, the normalization layer will need updating — noted in service comments. |
| UPCs are recall-level, not per-product — UPC-to-product attribution is ambiguous for multi-product recalls | `ProductUPCs` is a top-level array on the recall record, not nested under individual `Products[]` entries. Verified with 9 multi-product recalls that also have UPCs: all UPCs appear at the top level without per-product attribution. Output design reflects this — UPCs are shown at the recall level, not per-product. |
