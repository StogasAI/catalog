export const PUBLIC_CATALOG_SCHEMA: 'stogas.catalog.public.v6';
export const PUBLIC_CATALOG_PART_SCHEMA: 'stogas.catalog.public.part.v6';
export const PUBLIC_CATALOG_ROOT_LIMIT: number;
export const PUBLIC_CATALOG_PART_LIMIT: number;
export const PUBLIC_CATALOG_LIMIT: number;

/** What the root keeps of a deployment. */
export type PublicDeploymentSummary = {
	modelId: string;
	part: number;
	retirementDate: string | null;
	routeIds: string[];
};

type Nodes = Record<string, object>;
type DeploymentRecord = { modelId: string; retirementDate: string | null; routes: Nodes };

export type PublicCatalogRoot = {
	schema: typeof PUBLIC_CATALOG_SCHEMA;
	graph: { [kind: string]: Nodes; deployments: Record<string, PublicDeploymentSummary> };
	parts: { sha256: string; size: number }[];
	periods: object[];
	schedule: { start: string; graph: { [kind: string]: Nodes } }[];
};

export type PublicCatalogPart = {
	schema: typeof PUBLIC_CATALOG_PART_SCHEMA;
	deployments: Record<string, DeploymentRecord>;
	schedule: { start: string; deployments: Record<string, DeploymentRecord> }[];
};

export function deploymentSummary(
	deployment: DeploymentRecord,
	part: number
): PublicDeploymentSummary;

/**
 * The whole catalog from a root and its parts, in the root's order, with each deployment's
 * record as its part holds it. `Catalog` names the caller's own types for the result.
 */
export function assemblePublicCatalog<Catalog = PublicCatalogRoot>(
	root: PublicCatalogRoot,
	parts: readonly PublicCatalogPart[]
): Catalog;
