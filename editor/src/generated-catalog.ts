import publicCatalog from '../../generated/catalog.public.json';
import {
	withArchive,
	type CatalogArchive,
	type PublicCatalog
} from '../../source/scripts/public-catalog.mjs';

// The build writes no archive while nothing has moved there.
const [archive] = Object.values(
	import.meta.glob<CatalogArchive>('../../generated/catalog.archive.json', {
		eager: true,
		import: 'default'
	})
);

/** The build's public catalog, with each archived record beside the others. */
export const generatedCatalog: unknown = archive
	? withArchive(publicCatalog as PublicCatalog, archive)
	: publicCatalog;
