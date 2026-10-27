/**
 * The public catalog is a root and the parts that it lists. The root holds every author, group,
 * model, provider and route, and a summary of each deployment; each part holds whole
 * deployments. Evidence approves the root, and the root names each part by its SHA-256, so a
 * reader that shows one deployment fetches one part and the others need only the root.
 */
export const PUBLIC_CATALOG_SCHEMA = 'stogas.catalog.public.v6';
export const PUBLIC_CATALOG_PART_SCHEMA = 'stogas.catalog.public.part.v6';

/** What the root keeps of a deployment: what pages need to place it in the graph. */
export function deploymentSummary(deployment, part) {
	return {
		modelId: deployment.modelId,
		part,
		retirementDate: deployment.retirementDate,
		routeIds: Object.keys(deployment.routes).sort()
	};
}

/**
 * The whole catalog from a root and its parts, in the root's order: each deployment's record as
 * its part holds it, and each schedule entry lists every node that differs from the base graph,
 * as the root's entries do for the other kinds. Throws when a part does not match the root.
 */
export function assemblePublicCatalog(root, parts) {
	if (root?.schema !== PUBLIC_CATALOG_SCHEMA || !Array.isArray(root.parts))
		throw new Error('Public catalog root is invalid.');
	if (!Array.isArray(parts) || parts.length !== root.parts.length)
		throw new Error('Public catalog parts differ from the root.');
	const summaries = root.graph.deployments;
	const order = new Map(Object.keys(summaries).map((id, index) => [id, index]));
	const starts = new Map(root.schedule.map((entry, index) => [entry.start, index]));
	const deployments = new Map();
	const scheduled = root.schedule.map(() => new Map());
	parts.forEach((part, index) => {
		if (part?.schema !== PUBLIC_CATALOG_PART_SCHEMA)
			throw new Error('Public catalog part is invalid.');
		for (const [id, record] of Object.entries(part.deployments)) {
			const summary = own(summaries, id);
			if (summary?.part !== index) throw new Error(`Deployment ${id} is not in this part.`);
			deployments.set(id, matchingSummary(id, record, summary));
		}
		for (const entry of part.schedule) {
			const position = starts.get(entry.start);
			if (position === undefined)
				throw new Error(`Part schedule entry ${entry.start} is not in the root.`);
			const changed = root.schedule[position].graph.deployments;
			for (const [id, record] of Object.entries(entry.deployments)) {
				const summary = own(changed, id) ?? own(summaries, id);
				if (summary?.part !== index) throw new Error(`Deployment ${id} is not in this part.`);
				scheduled[position].set(id, matchingSummary(id, record, summary));
			}
		}
	});
	// Each part holds only its own deployments, so equal counts mean every deployment is there.
	if (deployments.size !== order.size) throw new Error('Public catalog parts omit a deployment.');
	const inRootOrder = (records) =>
		Object.fromEntries([...records].sort(([left], [right]) => order.get(left) - order.get(right)));
	return {
		schema: root.schema,
		graph: { ...root.graph, deployments: inRootOrder(deployments) },
		schedule: root.schedule.map(({ start, graph }, position) => {
			for (const id of Object.keys(graph.deployments ?? {}))
				if (!scheduled[position].has(id))
					throw new Error(`Part omits deployment ${id} at ${start}.`);
			const { deployments: _summaries, ...nodes } = graph;
			return {
				start,
				graph: scheduled[position].size
					? { ...nodes, deployments: inRootOrder(scheduled[position]) }
					: nodes
			};
		}),
		periods: root.periods
	};
}

function matchingSummary(id, record, summary) {
	const routeIds = Object.keys(record.routes).sort();
	if (
		record.modelId !== summary.modelId ||
		record.retirementDate !== summary.retirementDate ||
		routeIds.join('\n') !== summary.routeIds.join('\n')
	)
		throw new Error(`Deployment ${id} differs from its summary.`);
	return record;
}

function own(record, key) {
	return record && Object.hasOwn(record, key) ? record[key] : undefined;
}
