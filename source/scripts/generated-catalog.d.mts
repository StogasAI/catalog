import type { CatalogArchive, PublicCatalog } from './public-catalog.mjs';

/**
 * A build's public catalog and the archive that it names, or null while it names none, from this
 * checkout's build unless `directory` names another. `Catalog` names the caller's own type for
 * the public catalog.
 */
export function readGeneratedPublicCatalog<Catalog = PublicCatalog>(
	directory?: string
): { catalog: Catalog; archive: CatalogArchive | null };
