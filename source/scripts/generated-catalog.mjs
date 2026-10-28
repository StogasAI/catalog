import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCatalog, partsInEffect } from './catalog-files.mjs';
import { CATALOG_PARTS_DIRECTORY, CATALOG_ROOT } from './release-format.mjs';

const generated = fileURLToPath(new URL('../../generated', import.meta.url));

/**
 * A build's root and the catalog that it makes with every part, or with `at`, with only the parts
 * that hold a record that has not retired then.
 */
export function readGeneratedCatalog({ directory = generated, at } = {}) {
	const read = (path) => JSON.parse(readFileSync(join(directory, path), 'utf8'));
	const root = read(CATALOG_ROOT);
	const wanted = new Set(at === undefined ? root.parts.keys() : partsInEffect(root, at));
	return {
		root,
		catalog: assembleCatalog(
			root,
			root.parts.map(({ sha256 }, index) =>
				wanted.has(index) ? read(join(CATALOG_PARTS_DIRECTORY, `${sha256}.json`)) : null
			)
		)
	};
}
