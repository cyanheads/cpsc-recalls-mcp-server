/**
 * @fileoverview Raw API response types from the CPSC saferproducts.gov recall endpoint.
 * @module services/cpsc-recall/types
 */

/** Raw recall record as returned by the CPSC REST API. */
export interface RawRecall {
  ConsumerContact: string | null;
  Description: string;
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
  Importer?: string;
  Manufacturer?: string;
  ProductName?: string;
  RecallDateEnd?: string;
  RecallDateStart?: string;
  /** Maps to RecallDescription — searches the Description field only. */
  RecallDescription?: string;
  Retailer?: string;
}
