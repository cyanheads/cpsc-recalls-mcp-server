---
name: cpsc-recalls-guide
description: Find and confirm US consumer product recalls with the cpsc_* tools. Use when checking whether a specific product, model, serial, or UPC was recalled, sweeping a brand's or retailer's recall history, monitoring new or republished recalls for a hazard, or deciding whether a product is CPSC's at all. Covers search formulation, recall-number quirks, and when an empty result proves nothing.
license: Apache-2.0
metadata:
  author: cyanheads
  version: "1.0"
---

## Scope

CPSC recall records from saferproducts.gov, 1973 to the present, keyless. The server reads recall records only, so an empty result means no recall matched, never that a product is safe.

The jurisdiction note on every successful response names the agencies that own food, drugs, on-road vehicles, boats, pesticides, and firearms. CPSC still holds recalls for products next to those lines: drugs and dietary supplements recalled for failing child-resistant packaging rules, all-terrain vehicles and snowmobiles, e-bikes and bicycle tires, gun safes and locks, and car-seat adapters and accessories (some car seat recalls were announced jointly with NHTSA). Search here before routing such a product away. For a car seat or a tire, check the vehicle-safety agency's recalls as well.

## Identifiers

- **Recall number.** Comes from cpsc_search_recalls or cpsc_get_recent. Pass five digits with no separator; a hyphenated form such as `25-043` fails validation. The first two digits are almost always the federal fiscal year the recall was issued in, which starts October 1 (`27xxx` numbers begin in October 2026, `03064` was issued in late 2002). Use that to bound a date search when a number is all you have.
- **Lettered numbers.** Some 1998–2001 releases are split into lettered records (`01160a`, `01160b`, `01160c`) that are unrelated recalls issued the same day. The bare base number is not a record, and cpsc_get_recall on it returns one of the lettered siblings instead of failing. Check that the returned recall number equals the one you asked for; to see every sibling, search with date_start and date_end both set to that day.
- **Model numbers, serials, UPCs.** No filter matches them as fields. They live in the description text that cpsc_get_recall returns; see the unit-level gate below.

## Gates

1. **One empty search is not "not recalled".** Before telling a user no recall exists, run title_search with brand plus product, then a company-role filter (manufacturer, importer, or retailer) with product_name, and merge the two result sets by recall number. They diverge: for Graco strollers, title_search found a recall where Graco is listed only as importer, and the role search found a recall whose title names activity trays while a product name says stroller. Report "no CPSC recall found" and the searches you ran, never "safe".

2. **Matching is substring, with no stemming.** A filter word matches inside longer words and misses other inflections. `fire` returns firearm safes, fireworks, and fireplace products; `burn` matches "burner"; `battery` misses hazard text that only says "batteries". Search the shortest distinctive stem (`batter`, `ingest`, `strangul`) and read each hit's hazard text before counting it toward a hazard class.

3. **hazard_search never reads the title, and the hazard field can be wrong.** One toy recall titled for battery ingestion carries "None reported." as its hazard text, and its data_quality_notes are empty, because those notes flag only fields CPSC left blank. For a hazard sweep, run the same stem through title_search too and merge by recall number.

4. **Pair hazard_search with something narrower.** A hazard_search with no other criterion downloads the whole recall history before filtering, which can take many seconds when CPSC's cache is cold. Add a date bound or a product, title, or company filter when the question allows.

5. **Unit-level checks happen by reading.** Descriptions state models, serials, and date codes as ranges or masks (`1HFVE05**K4000003` to `1HFVE05**K4003902`, `111522DXXXXXX`, serial runs like `3591767-3591769`), so a specific serial rarely matches as text. Search a model family or a distinctive digit run with description_search, open the candidates with cpsc_get_recall, and compare the user's unit against the stated ranges yourself.

6. **A UPC is findable only as the description prints it.** Most UPC-bearing descriptions repeat the code, but formatting varies: `082294319754` found nothing where the description prints `0-82294-319754`, while `319754` found it. Search a run of six or more trailing digits, then confirm the full code in the record.

7. **units_recalled is narrative, not a count.** It is approximate ("About 61,000"), often adds Canadian or Mexican sales in parentheses, and on an expanded or re-announced recall it can cite or already include units from the earlier recall ("About 569,000 (In August 2018, 105,000 of the 569,000 blending containers and blade bases were previously recalled)"). Read the parenthetical before summing across recalls, and present totals as approximate.

8. **Issue date and last-published date are separate axes.** cpsc_get_recent windows on issue date. A record CPSC republishes keeps its original issue date, so a recent window or an issue-date search misses it and updated_start and updated_end find it; 1998 recalls republished in October 2026 appear that way. Search rows don't carry the last-published date. cpsc_get_recall shows it as last_updated, but nothing says what changed.

## Workflows

**Is this product recalled?** Run gate 1's searches, narrow the candidates by title and issue date against when the user bought the product, open each with cpsc_get_recall, and compare model, serial, UPC, and the retailers' sale-date and price narrative against the user's unit (gates 5 and 6). Answer with the remedy text, the consumer contact, and cpsc_url so the user can verify.

**A company's or retailer's history.** The retailer filter matches CPSC's free-text sale narrative ("Amazon.com from March 2025 through August 2026 for about $13 to $14"), so it also reaches online marketplaces. For a brand, combine title_search with the manufacturer and importer filters (gate 1). Expansions and re-announcements are separate recalls with their own numbers, titled "Expands Recall" or "Reannounces"; title_search on brand plus product returns the original next to them.

**Tracing one recall's history.** Start from a title_search on brand plus product, not a model number. A model named in the original recall's description can appear in the expansion only inside units_recalled: `2551W` returns the original BISSELL wet-dry vacuum recall from January 2023 through description_search, while title_search "BISSELL Wet Dry" returns both it and the April 2023 expansion.

**Monitoring.** For a calendar window ("this month"), call cpsc_search_recalls with date_start and date_end; a date bound alone satisfies its criterion requirement, and it accepts a hazard or company filter. cpsc_get_recent covers only a rolling window ending today and takes no filters. Key stored results by recall number, and add an updated_start pass to catch records CPSC republishes after the fact.
