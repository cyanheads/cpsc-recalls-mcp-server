/**
 * @fileoverview Raw API response types from the CPSC saferproducts.gov recall endpoint.
 * @module services/cpsc-recall/types
 */

/**
 * Raw recall record as returned by the CPSC REST API.
 *
 * The identifying fields (`RecallNumber`, `RecallDate`, `Title`) are always present on a
 * genuine record. CPSC nulls them on the error row it substitutes for results when a
 * request is malformed upstream; `CpscRecallService` rejects that row before any record
 * reaches a handler, so consumers of this type can treat them as non-null. The service also
 * converts the HTML markup and character codes in every text field to plain text first.
 */
export interface RawRecall {
  ConsumerContact: string | null;
  /** Null or empty on a small number of genuine records (e.g. recall `04084`). */
  Description: string | null;
  Distributors: Array<{ Name: string; CompanyID: string }>;
  Hazards: Array<{ Name: string; HazardType: string; HazardTypeID: string }>;
  Images: Array<{ URL: string; Caption: string }>;
  Importers: Array<{ Name: string; CompanyID: string }>;
  /** Coordinated recalls from other agencies (e.g. Canada Health). */
  Inconjunctions: Array<{ URL: string }>;
  Injuries: Array<{ Name: string }>;
  LastPublishDate: string;
  ManufacturerCountries: Array<{ Country: string }>;
  Manufacturers: Array<{ Name: string; CompanyID: string }>;
  Products: RawProduct[];
  /** Sparse (~4% of records). UPCs are at recall level, not per-product. */
  ProductUPCs: Array<{ UPC: string }>;
  RecallDate: string;
  RecallID: number;
  RecallNumber: string;
  Remedies: Array<{ Name: string }>;
  RemedyOptions: Array<{ Option: string }>;
  Retailers: Array<{ Name: string; CompanyID: string }>;
  /** Always null in practice — omitted from output. */
  SoldAtLabel: null;
  Title: string;
  URL: string;
}

export interface RawProduct {
  /** Always empty. */
  CategoryID: string;
  /** Always empty in full dataset. */
  Description: string;
  /** Almost always empty — model info is in Description text instead. */
  Model: string;
  Name: string;
  NumberOfUnits: string;
  Type: string;
}

/** Parameters for the CPSC search endpoint. */
export interface CpscSearchParams {
  /** Substring match against `Distributors[].Name`. */
  Distributor?: string;
  Importer?: string;
  /** Upper bound on `LastPublishDate` — a separate axis from `RecallDate`. */
  LastPublishDateEnd?: string;
  /** Lower bound on `LastPublishDate` — a separate axis from `RecallDate`. */
  LastPublishDateStart?: string;
  Manufacturer?: string;
  ProductName?: string;
  RecallDateEnd?: string;
  RecallDateStart?: string;
  /** Maps to RecallDescription — searches the Description field only. */
  RecallDescription?: string;
  /** Substring match against `Title`. */
  RecallTitle?: string;
  /**
   * Substring match against the free-text `Remedies[].Name` narrative — NOT the
   * `RemedyOptions[].Option` type enum. Verified against the full dataset: `Remedy=Repair`
   * returns exactly the 2,011 records whose remedy narrative contains "repair", while only
   * 1,557 records carry `Repair` in `RemedyOptions`.
   */
  Remedy?: string;
  Retailer?: string;
}
