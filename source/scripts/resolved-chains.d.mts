type Graph = Record<
	'authors' | 'models' | 'deployments' | 'routes' | 'providers',
	Record<string, unknown>
>;

type Catalog = {
	graph: Graph;
	schedule: { start: string; graph: Partial<Graph> }[];
};

type Chain = {
	deploymentId: string;
	routeId: string;
	hash: string;
	json: string;
};

/** The input is a validated public graph. */
export function resolvedCatalogChains(graph: Graph): Generator<Chain>;

/** Chains of the base graph and of every dated state, each once. */
export function everyStateCatalogChains(
	publicCatalog: Catalog,
	runtimeCatalog: Catalog
): Generator<Chain>;
