export const PUBLIC_CATALOG_SCHEMA: 'stogas.catalog.public.v8';
export const PUBLIC_CATALOG_PART_SCHEMA: 'stogas.catalog.public.part.v8';
export const CATALOG_ARCHIVE_INDEX_SCHEMA: 'stogas.catalog.archive.index.v1';
export const CATALOG_ARCHIVE_PART_SCHEMA: 'stogas.catalog.archive.part.v1';
export const PUBLIC_CATALOG_ROOT_LIMIT: number;
export const CATALOG_ARCHIVE_INDEX_LIMIT: number;
export const PUBLIC_CATALOG_PART_LIMIT: number;
export const PUBLIC_CATALOG_LIMIT: number;
export const CATALOG_ARCHIVE_LIMIT: number;

/** What the root keeps of a deployment, and the archive index of an archived one. */
export type PublicDeploymentSummary = {
	modelId: string;
	part: number;
	retirementDate: string | null;
	routeIds: string[];
};

/** What the archive index keeps of an archived model. */
export type ArchivedModelSummary = { aliases: string[]; part: number; retirementDate: string };

/** A file that a root names by the SHA-256, in hex, and size of its bytes. */
export type PublicCatalogFile = { sha256: string; size: number };

/** The archive's files, or `null` while nothing has moved there. */
export type CatalogArchiveReference = {
	index: PublicCatalogFile;
	parts: PublicCatalogFile[];
} | null;

type Nodes = Record<string, object>;
type DeploymentRecord = { modelId: string; retirementDate: string | null; routes: Nodes };

export type PublicCatalogRoot = {
	schema: typeof PUBLIC_CATALOG_SCHEMA;
	archive: CatalogArchiveReference;
	graph: { [kind: string]: Nodes; deployments: Record<string, PublicDeploymentSummary> };
	parts: PublicCatalogFile[];
	periods: object[];
	schedule: { start: string; graph: { [kind: string]: Nodes } }[];
};

export type PublicCatalogPart = {
	schema: typeof PUBLIC_CATALOG_PART_SCHEMA;
	deployments: Record<string, DeploymentRecord>;
	schedule: { start: string; deployments: Record<string, DeploymentRecord> }[];
};

/** A whole public catalog: the root with each deployment's record in place of its summary. */
export type PublicCatalog = {
	schema: typeof PUBLIC_CATALOG_SCHEMA;
	archive: CatalogArchiveReference;
	graph: { deployments: Nodes; models: Nodes; [kind: string]: Nodes };
	periods: object[];
	schedule: { start: string; graph: { [kind: string]: Nodes } }[];
};

export type CatalogArchiveIndex = {
	schema: typeof CATALOG_ARCHIVE_INDEX_SCHEMA;
	deployments: Record<string, PublicDeploymentSummary>;
	models: Record<string, ArchivedModelSummary>;
};

export type CatalogArchivePart = {
	schema: typeof CATALOG_ARCHIVE_PART_SCHEMA;
	deployments: Record<string, DeploymentRecord>;
	models: Nodes;
};

/** The archived deployments and models. */
export type CatalogArchive = { deployments: Nodes; models: Nodes };

export function deploymentSummary(
	deployment: DeploymentRecord,
	part: number
): PublicDeploymentSummary;

/** Every file that a root names: its parts, then the archive's index and parts. */
export function publicCatalogFiles(root: {
	parts: readonly PublicCatalogFile[];
	archive: CatalogArchiveReference;
}): PublicCatalogFile[];

/**
 * Every file that a root of `rootSize` bytes names, after checking each name and size and the
 * size of the catalog and of the archive with all their files. Throws when one fails.
 */
export function checkedPublicCatalogFiles(root: unknown, rootSize: number): PublicCatalogFile[];

/**
 * The whole catalog from a root and its parts, in the root's order, with each deployment's
 * record as its part holds it. `Catalog` names the caller's own types for the result.
 */
export function assemblePublicCatalog<Catalog = PublicCatalog>(
	root: PublicCatalogRoot,
	parts: readonly PublicCatalogPart[]
): Catalog;

/** The archived deployments and models from the archive's index and its parts. */
export function assembleCatalogArchive(
	index: CatalogArchiveIndex,
	parts: readonly CatalogArchivePart[]
): CatalogArchive;

/**
 * The catalog with the archived deployments and models beside the others. `Catalog` names the
 * caller's own catalog type.
 */
export function withArchive<Catalog extends { graph: { deployments: Nodes; models: Nodes } }>(
	catalog: Catalog,
	archive: CatalogArchive
): Catalog;
