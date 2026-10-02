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
