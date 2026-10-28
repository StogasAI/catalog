import catalogRoot from '../../generated/catalog.json';
import {
	assembleCatalog,
	type CatalogPart,
	type CatalogRoot
} from '../../source/scripts/catalog-files.mjs';

// Every part that the root names.
const partFiles: Record<string, unknown> = import.meta.glob(
	'../../generated/catalog.parts/*.json',
	{
		eager: true,
		import: 'default'
	}
);
const root = catalogRoot as CatalogRoot;

/** The build's whole catalog, current and retired records alike. */
export const generatedCatalog: unknown = assembleCatalog(
	root,
	root.parts.map(
		({ sha256 }) => partFiles[`../../generated/catalog.parts/${sha256}.json`] as CatalogPart
	)
);
