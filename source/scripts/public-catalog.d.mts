export const PUBLIC_CATALOG_SCHEMA: 'stogas.catalog.public.v7';
export const CATALOG_ARCHIVE_SCHEMA: 'stogas.catalog.archive.v1';
export const PUBLIC_CATALOG_LIMIT: number;
export const CATALOG_ARCHIVE_LIMIT: number;

type Nodes = Record<string, object>;

/** What the public catalog names its archive by, or `null` while the archive is empty. */
export type CatalogArchiveReference = { sha256: string; size: number } | null;

export type PublicCatalog = {
	schema: typeof PUBLIC_CATALOG_SCHEMA;
	archive: CatalogArchiveReference;
	graph: { deployments: Nodes; models: Nodes; [kind: string]: Nodes };
	periods: object[];
	schedule: { start: string; graph: { [kind: string]: Nodes } }[];
};

export type CatalogArchive = {
	schema: typeof CATALOG_ARCHIVE_SCHEMA;
	graph: { deployments: Nodes; models: Nodes };
};

/**
 * The catalog with the archived deployments and models beside the others. `Catalog` names the
 * caller's own catalog type.
 */
export function withArchive<Catalog extends { graph: { deployments: Nodes; models: Nodes } }>(
	catalog: Catalog,
	archive: CatalogArchive
): Catalog;
