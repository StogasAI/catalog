import type { CatalogPartFile } from '../source/scripts/catalog-files.mjs';
import { readGeneratedCatalog } from '../source/scripts/generated-catalog.mjs';

type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	parts: CatalogPartFile[];
	summaries: Record<string, Nodes>;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: Record<string, any>[];
};

/** A build's root and its whole catalog. */
export const readCatalog = (directory: string) => readGeneratedCatalog<Catalog>({ directory });

/** The checkout's root and whole catalog. */
export const { root: catalogRoot, catalog } = readGeneratedCatalog<Catalog>();
