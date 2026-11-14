import type { CatalogKind, CatalogRoot, Companies } from './catalog-files.mjs';
import type { Locations } from './locations.mjs';

/** The size of a part on average, in bytes. */
export const PART_BYTES: number;

type Graph = Partial<Record<CatalogKind, Record<string, object>>>;

/** A file that the build writes, and the SHA-256 and size that name it. */
type PartFile = { json: string; sha256: string; size: number };

/**
 * Splits a catalog into its root and parts. Each part's `json` is the exact file, which the root
 * names by SHA-256, size and the latest retirement date of its records.
 */
export function partitionCatalog(catalog: {
	locations: Locations;
	companies: Companies;
	graph: Graph;
	schedule: { start: string; graph: Graph }[];
	periods: object[];
}): { root: CatalogRoot; parts: PartFile[] };

/** Each record's retirement date, by kind and ID, or null. */
export function retirementDates(graph: Graph): Record<CatalogKind, Record<string, string | null>>;

/** Whether Stogas serves each record, by kind and ID. */
export function supportedRecords(graph: Graph): Record<CatalogKind, Record<string, boolean>>;
