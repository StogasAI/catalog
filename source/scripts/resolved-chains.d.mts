type Catalog = {
	graph: Record<
		'authors' | 'models' | 'deployments' | 'routes' | 'providers',
		Record<string, unknown>
	>;
};

/** Inputs are the validated public and runtime artifacts from the same release. */
export function resolvedCatalogChains(
	publicCatalog: Catalog,
	runtimeCatalog: Catalog
): Generator<{
	deploymentId: string;
	routeId: string;
	hash: string;
	json: string;
}>;

/** Chains of the base graph and of every dated state, each once. */
export function everyStateCatalogChains(
	publicCatalog: Catalog & { schedule: { start: string; graph: Partial<Catalog['graph']> }[] },
	runtimeCatalog: Catalog & { schedule: { start: string; graph: Partial<Catalog['graph']> }[] }
): Generator<{
	deploymentId: string;
	routeId: string;
	hash: string;
	json: string;
}>;
