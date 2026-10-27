import type { PublicCatalogRoot } from './public-catalog.mjs';

export const PART_MIN_BYTES: number;
export const PART_MAX_BYTES: number;

/**
 * Splits a whole public catalog into its root and parts. Each part's `json` is the exact file;
 * the root names each by SHA-256 and size.
 */
export function partitionPublicCatalog(catalog: object): {
	root: PublicCatalogRoot;
	parts: { json: string; sha256: string; size: number }[];
};
