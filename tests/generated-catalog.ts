import { readGeneratedPublicCatalog } from '../source/scripts/generated-catalog.mjs';

type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: Record<string, any>[];
};

/** A build's public root, its parts in the root's order, and the whole catalog they make. */
export const readPublicCatalog = (generated: string) =>
	readGeneratedPublicCatalog<Catalog>(generated);

const generated = readGeneratedPublicCatalog<Catalog>();

/** The checkout's public catalog root and its parts. */
export const { root: publicRoot, parts: publicParts } = generated;
/** The checkout's whole public catalog, as readers that need every deployment assemble it. */
export const publicCatalog = generated.catalog;
