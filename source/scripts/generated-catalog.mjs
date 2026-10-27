import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePublicCatalog } from './public-catalog.mjs';
import { CATALOG_PARTS_DIRECTORY } from './release-format.mjs';

const generated = fileURLToPath(new URL('../../generated', import.meta.url));

/** A build's public root, its parts in the root's order, and the whole catalog they make. */
export function readGeneratedPublicCatalog(directory = generated) {
	const read = (path) => JSON.parse(readFileSync(join(directory, path), 'utf8'));
	const root = read('catalog.public.json');
	const parts = root.parts.map(({ sha256 }) =>
		read(join(CATALOG_PARTS_DIRECTORY, `${sha256}.json`))
	);
	return { root, parts, catalog: assemblePublicCatalog(root, parts) };
}
