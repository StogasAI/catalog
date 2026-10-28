import type { PublicCatalogRoot } from './public-catalog.mjs';

export const PART_MIN_BYTES: number;
export const PART_MAX_BYTES: number;

/** A file that the build writes, and the SHA-256 and size that name it. */
type PartFile = { json: string; sha256: string; size: number };

/**
 * Splits a public catalog into its root and parts. Each part's `json` is the exact file; the
 * root names each by SHA-256 and size, and the build adds the archive.
 */
export function partitionPublicCatalog(catalog: object): {
	root: Omit<PublicCatalogRoot, 'archive'>;
	parts: PartFile[];
};

/** Splits the archive into its index and parts, or returns null while it is empty. */
export function partitionCatalogArchive(archive: {
	deployments: Record<string, object>;
	models: Record<string, object>;
}): { index: PartFile; parts: PartFile[] } | null;
