import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCatalogArchive, assemblePublicCatalog } from './public-catalog.mjs';
import { CATALOG_PARTS_DIRECTORY } from './release-format.mjs';

const generated = fileURLToPath(new URL('../../generated', import.meta.url));

/**
 * A build's public root, the whole catalog that it makes with its parts, and the archived records,
 * or null while the root names no archive.
 */
export function readGeneratedPublicCatalog(directory = generated) {
	const read = (path) => JSON.parse(readFileSync(join(directory, path), 'utf8'));
	const part = ({ sha256 }) => read(join(CATALOG_PARTS_DIRECTORY, `${sha256}.json`));
	const root = read('catalog.public.json');
	return {
		root,
		catalog: assemblePublicCatalog(root, root.parts.map(part)),
		archive:
			root.archive && assembleCatalogArchive(part(root.archive.index), root.archive.parts.map(part))
	};
}
