import catalogRoot from '../../generated/catalog.public.json';
import {
	assembleCatalogArchive,
	assemblePublicCatalog,
	withArchive,
	type CatalogArchiveIndex,
	type CatalogArchivePart,
	type PublicCatalog,
	type PublicCatalogPart,
	type PublicCatalogRoot
} from '../../source/scripts/public-catalog.mjs';

// Every file that the root names, deployment parts and the archive's alike.
const partFiles: Record<string, unknown> = import.meta.glob(
	'../../generated/catalog.public.parts/*.json',
	{ eager: true, import: 'default' }
);
const part = <Part>({ sha256 }: { sha256: string }) =>
	partFiles[`../../generated/catalog.public.parts/${sha256}.json`] as Part;
const root = catalogRoot as PublicCatalogRoot;
const catalog = assemblePublicCatalog<PublicCatalog>(root, root.parts.map(part<PublicCatalogPart>));

/** The build's whole public catalog, with each archived record beside the others. */
export const generatedCatalog: unknown = root.archive
	? withArchive(
			catalog,
			assembleCatalogArchive(
				part<CatalogArchiveIndex>(root.archive.index),
				root.archive.parts.map(part<CatalogArchivePart>)
			)
		)
	: catalog;
