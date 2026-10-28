import type { CatalogArchive, PublicCatalog, PublicCatalogRoot } from './public-catalog.mjs';

/**
 * A build's public root, the whole catalog that it makes with its parts, and the archived records,
 * or null while the root names no archive, from this checkout's build unless `directory` names
 * another. `Catalog` names the caller's own type for the whole catalog.
 */
export function readGeneratedPublicCatalog<Catalog = PublicCatalog>(
	directory?: string
): { root: PublicCatalogRoot; catalog: Catalog; archive: CatalogArchive | null };
