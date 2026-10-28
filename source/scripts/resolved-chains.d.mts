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

/** The input is a validated catalog graph. */
export function resolvedCatalogChains(graph: Graph): Generator<Chain>;

/**
 * Chains of the base graph and of every dated state, each once, after checking that each
 * deployment names the hash of its chain.
 */
export function everyStateCatalogChains(catalog: Catalog): Generator<Chain>;
