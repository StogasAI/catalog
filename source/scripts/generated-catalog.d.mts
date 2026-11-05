import type { Catalog, CatalogRoot } from './catalog-files.mjs';

/**
 * A build's root and the catalog that it makes with every part, or with `at`, with only the parts
 * that hold a record that has not retired then, from this checkout's build unless `directory` names
 * another. Parts of records that Stogas does not serve join only with `unsupported`. `Assembled`
 * names the caller's own type for the catalog.
 */
export function readGeneratedCatalog<Assembled = Catalog>(options?: {
	directory?: string;
	at?: Date | number;
	unsupported?: boolean;
}): { root: CatalogRoot; catalog: Assembled };
