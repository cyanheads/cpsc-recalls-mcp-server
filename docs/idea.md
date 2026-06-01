# cpsc-recalls-mcp-server — idea

US consumer product recalls from the [Consumer Product Safety Commission](https://www.cpsc.gov/Recalls) — the official record of recalled products with their hazards, remedies, affected units, incidents, and images. Keyless.

CPSC is the authoritative source for recalls across consumer products — toys, electronics, furniture, appliances, children's products, tools — the categories not covered by food/drug or vehicle recall systems.

**Audience:** Parents, consumers, retailers, safety researchers, journalists, and agents answering "has this product been recalled?", "what baby products were recalled this year?", or "is this brand of space heater safe?"

## User Goals

- Search recalls by product, brand/manufacturer, or hazard
- Get full detail on a specific recall (hazard, remedy, units, incidents)
- See recent recalls (general or by category)
- Check whether a product/brand has a recall history

## API Surface

Keyless REST at `saferproducts.gov/RestWebServices/Recall` (JSON via `format=json`). One flexible search endpoint with many optional filters.

| Param group | Examples |
|:------------|:---------|
| Text / product | `ProductName`, `RecallTitle`, `RecallDescription` |
| Org | `Manufacturer`, `Retailer`, `Importer` |
| Hazard | `Hazard` (fire, laceration, choking, fall, ...) |
| Time / ID | `RecallDateStart`, `RecallDateEnd`, `RecallNumber` |

Each recall returns: recall number, date, title, description, the products involved (name, model, UPC, units), hazards, remedies (refund/repair/replace), reported incidents/injuries, manufacturers/retailers, and image URLs.

## Tool Surface (sketch)

```
cpsc_search_recalls   — search consumer-product recalls. Filters: product name, brand/
                        manufacturer, retailer, hazard type, date range. Returns recall
                        number, date, title, affected products (name/model/units),
                        hazard, and remedy. The primary tool — "any recalls for this
                        crib brand?"

cpsc_get_recall       — full detail for a recall by recall number: complete description,
                        every product variant (model, UPC, sold-at, units), all hazards,
                        the remedy and how to claim it, reported incidents and injuries,
                        manufacturers/importers, and image URLs.

cpsc_get_recent       — most recent recalls, optionally scoped by hazard or product
                        category. Returns summaries with date + hazard. The heartbeat
                        tool — "what's been recalled lately?"
```

## Design Notes

- Low-medium complexity — keyless single-endpoint REST. The work is **filter ergonomics** (one endpoint, many optional params — map friendly inputs cleanly) and **reshaping the nested recall object** (products, hazards, remedies, incidents are arrays) into something an agent reads at a glance.
- **Lead with hazard + remedy.** The two things a person needs are "what's dangerous about it" and "what do I do" (refund/repair/replace + how to claim) — surface those first, ahead of the catalog of model numbers.
- Match by **model/UPC**, not just product name — recalls scope to specific units/lots, so a brand match isn't a recall match. Make that distinction explicit so the agent doesn't over-warn.
- Return recall images and the CPSC recall URL for human verification.
- Coverage is **CPSC jurisdiction** — consumer products excluding food/drugs/cosmetics, vehicles/tires, boats, firearms, and pesticides (other agencies). State the boundaries so the agent routes correctly.
- Composes with food/drug recall sources (`openfda`) and vehicle recall sources (`nhtsa`) — together they answer "is this recalled?" across the whole consumer landscape; this server is the "everything else" piece.
- Moonshot: a "household safety sweep" workflow — take a list of products/brands and check all three recall sources in one pass.

**README one-liner:** "US consumer product recalls — hazards, remedies, and affected products from the CPSC, no key."
