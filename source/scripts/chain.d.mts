type Graph = Record<
	'authors' | 'models' | 'deployments' | 'routes' | 'providers',
	Record<string, unknown>
>;

type ChainNode = { id: string; data: Record<string, unknown> };

/** One path of a validated catalog graph, with each fact on the node whose value applies. */
export function catalogChain(
	graph: Graph,
	deploymentId: string,
	routeId: string
): Record<'author' | 'model' | 'deployment' | 'route' | 'provider', ChainNode>;
