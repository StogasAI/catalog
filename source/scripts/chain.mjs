// A chain is one executable path from author to provider. Each fact appears once, on the node
// whose value applies to the path. The deployment holds what it serves on the route, which the
// compiler resolved from the model, the route and the deployment's own facts, so the model and
// the route keep only what the deployment does not state. Group membership and the model's
// efforts for each interface are not facts of the path: the route's efforts already apply them.
export function catalogChain(graph, deploymentId, routeId) {
	const { routes, ...deployment } = requireNode(graph.deployments, deploymentId);
	const { chainHash: _chainHash, ...routeFacts } = requireNode(routes, routeId);
	const served = { ...deployment, ...routeFacts };
	const {
		groupIds: _groups,
		reasoningEffortsByInterface: _efforts,
		...model
	} = requireNode(graph.models, deployment.modelId);
	const route = requireNode(graph.routes, routeId);
	return {
		author: { id: model.authorId, data: requireNode(graph.authors, model.authorId) },
		model: { id: deployment.modelId, data: unstated(model, served) },
		deployment: { id: deploymentId, data: served },
		route: { id: routeId, data: unstated(route, served) },
		provider: { id: route.providerId, data: requireNode(graph.providers, route.providerId) }
	};
}

function unstated(record, served) {
	return Object.fromEntries(Object.entries(record).filter(([key]) => !Object.hasOwn(served, key)));
}

function requireNode(nodes, id) {
	const value = nodes && Object.hasOwn(nodes, id) ? nodes[id] : undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Resolved catalog chain references missing node ${id}`);
	}
	return value;
}
