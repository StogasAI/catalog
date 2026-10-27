import catalogRoot from '../../generated/catalog.public.json';
import {
	assemblePublicCatalog,
	type PublicCatalogPart,
	type PublicCatalogRoot
} from '../../source/scripts/public-catalog.mjs';

const partFiles: Record<string, PublicCatalogPart> = import.meta.glob(
	'../../generated/catalog.public.parts/*.json',
	{ eager: true, import: 'default' }
);
const root = catalogRoot as PublicCatalogRoot;

/** The build's whole public catalog, from its root and parts. */
export const generatedCatalog: unknown = assemblePublicCatalog(
	root,
	root.parts.map(({ sha256 }) => partFiles[`../../generated/catalog.public.parts/${sha256}.json`]!)
);
