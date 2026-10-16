/**
 * The graph in effect at an instant. Each schedule entry lists every node that differs
 * from the base graph from its start until the next entry starts.
 */
export function catalogAt(catalog, at = Date.now()) {
	const time = typeof at === 'number' ? at : at.valueOf();
	let entry;
	for (const candidate of catalog.schedule) {
		if (Date.parse(candidate.start) > time) break;
		entry = candidate;
	}
	if (!entry) return catalog.graph;
	return Object.fromEntries(
		Object.entries(catalog.graph).map(([kind, nodes]) => [
			kind,
			entry.graph[kind] ? { ...nodes, ...entry.graph[kind] } : nodes
		])
	);
}
