// A chain is one executable path from author to provider. Each fact appears once, on the node
// whose value applies to the path. The deployment holds what it serves on the route, which the
// compiler resolved from the model, the route and the deployment's own facts, so the model and
// the route keep only what the deployment does not state. A route's retirement date is its own:
// the deployment's date covers all its routes, so the route keeps an earlier date of its own.
// Each node keeps the notes that it states, so a chain shows each note once, on its node; the
// records of a route and a deployment also repeat the notes of their parents. Group membership and the model's efforts for each interface are
// not facts of the path: the route's efforts already apply them.
export function catalogChain(graph, deploymentId, routeId) {
	const { routes, ...deployment } = requireNode(graph.deployments, deploymentId);
	const { chainHash: _chainHash, ...routeFacts } = requireNode(routes, routeId);
	const served = { ...deployment, ...routeFacts, notes: ownNotes(deployment.notes, 'deployment') };
	const {
		groupIds: _groups,
		reasoningEffortsByInterface: _efforts,
		...model
	} = requireNode(graph.models, deployment.modelId);
	const route = requireNode(graph.routes, routeId);
	return {
		author: { id: model.authorId, data: requireNode(graph.authors, model.authorId) },
		model: { id: deployment.modelId, data: { ...unstated(model, served), notes: model.notes } },
		deployment: { id: deploymentId, data: served },
		route: {
			id: routeId,
			data: {
				...unstated(route, served),
				...(Object.hasOwn(route, 'retirementDate') && { retirementDate: route.retirementDate }),
				...(Object.hasOwn(route, 'notes') && { notes: ownNotes(route.notes, 'route') })
			}
		},
		provider: { id: route.providerId, data: requireNode(graph.providers, route.providerId) }
	};
}

function ownNotes(notes, kind) {
	return notes.filter((note) => note.kind === kind);
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
