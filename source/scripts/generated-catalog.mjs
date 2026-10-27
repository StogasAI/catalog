import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_ARCHIVE_FILE } from './release-format.mjs';

const generated = fileURLToPath(new URL('../../generated', import.meta.url));

/** A build's public catalog and the archive that it names, or null while it names none. */
export function readGeneratedPublicCatalog(directory = generated) {
	const read = (name) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
	const catalog = read('catalog.public.json');
	return { catalog, archive: catalog.archive && read(CATALOG_ARCHIVE_FILE) };
}
