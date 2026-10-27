import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	assemblePublicCatalog,
	type PublicCatalogPart,
	type PublicCatalogRoot
} from '../source/scripts/public-catalog.mjs';
import { CATALOG_PARTS_DIRECTORY } from '../source/scripts/release-format.mjs';

type Nodes = Record<string, Record<string, any>>;
type Catalog = {
	schema: string;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: Record<string, any>[];
};

/** A build's public root, its parts in the root's order, and the whole catalog they make. */
export function readPublicCatalog(generated: string) {
	const read = (path: string) => JSON.parse(readFileSync(join(generated, path), 'utf8'));
	const root: PublicCatalogRoot = read('catalog.public.json');
	const parts: PublicCatalogPart[] = root.parts.map(({ sha256 }) =>
		read(join(CATALOG_PARTS_DIRECTORY, `${sha256}.json`))
	);
	return { root, parts, catalog: assemblePublicCatalog<Catalog>(root, parts) };
}

const generated = readPublicCatalog(join(import.meta.dir, '..', 'generated'));

/** The checkout's public catalog root and its parts. */
export const { root: publicRoot, parts: publicParts } = generated;
/** The checkout's whole public catalog, as readers that need every deployment assemble it. */
export const publicCatalog = generated.catalog;
