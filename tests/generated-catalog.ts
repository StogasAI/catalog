import { readGeneratedPublicCatalog } from '../source/scripts/generated-catalog.mjs';
import type { CatalogArchiveReference } from '../source/scripts/public-catalog.mjs';

type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	archive: CatalogArchiveReference;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: Record<string, any>[];
};

/** A build's root, its whole public catalog and the archived records. */
export const readPublicCatalog = (generated: string) =>
	readGeneratedPublicCatalog<Catalog>(generated);

/** The checkout's whole public catalog and the archived records. */
export const { catalog: publicCatalog, archive: publicArchive } =
	readGeneratedPublicCatalog<Catalog>();
