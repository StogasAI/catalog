import { readGeneratedPublicCatalog } from '../source/scripts/generated-catalog.mjs';

type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	archive: { sha256: string; size: number } | null;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: Record<string, any>[];
};

/** A build's public catalog and the archive that it names. */
export const readPublicCatalog = (generated: string) =>
	readGeneratedPublicCatalog<Catalog>(generated);

/** The checkout's public catalog and the archive that it names. */
export const { catalog: publicCatalog, archive: publicArchive } =
	readGeneratedPublicCatalog<Catalog>();
