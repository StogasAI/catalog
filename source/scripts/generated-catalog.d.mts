import type { PublicCatalogPart, PublicCatalogRoot } from './public-catalog.mjs';

/**
 * A build's public root, its parts in the root's order, and the whole catalog they make, from
 * this checkout's build unless `directory` names another. `Catalog` names the caller's own types
 * for the whole catalog.
 */
export function readGeneratedPublicCatalog<Catalog = PublicCatalogRoot>(
	directory?: string
): { root: PublicCatalogRoot; parts: PublicCatalogPart[]; catalog: Catalog };
