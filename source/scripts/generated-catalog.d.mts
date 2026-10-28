import type { Catalog, CatalogRoot } from './catalog-files.mjs';

/**
 * A build's root and the catalog that it makes with every part, or with `at`, with only the parts
 * that hold a record that has not retired then, from this checkout's build unless `directory` names
 * another. `Assembled` names the caller's own type for the catalog.
 */
export function readGeneratedCatalog<Assembled = Catalog>(options?: {
	directory?: string;
	at?: Date | number;
}): { root: CatalogRoot; catalog: Assembled };
