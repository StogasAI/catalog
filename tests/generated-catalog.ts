import type { CatalogPartFile } from '../source/scripts/catalog-files.mjs';
import { readGeneratedCatalog } from '../source/scripts/generated-catalog.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Catalog JSON of any shape, which the tests read and change in place.
type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	locations: Record<string, { name: string; parentIds: string[] }>;
	parts: CatalogPartFile[];
	summaries: Record<string, Nodes>;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- As above.
	periods: Record<string, any>[];
};

/** A build's root and its whole catalog, with what Stogas does not serve. */
export const readCatalog = (directory: string) =>
	readGeneratedCatalog<Catalog>({ directory, unserved: true });

/** The checkout's root and whole catalog, with what Stogas does not serve. */
export const { root: catalogRoot, catalog } = readGeneratedCatalog<Catalog>({ unserved: true });
