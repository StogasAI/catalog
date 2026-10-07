import { ancestorGroupIds } from './model-groups.mjs';

export const catalogCollections = [
	'authors',
	'groups',
	'models',
	'providers',
	'routes',
	'deployments'
];
export const catalogPublicSizeLimit = 8 * 1024 * 1024;

export function partitionPublicGraph(graph) {
	const split = (nodes, retired) => [
		Object.fromEntries(Object.entries(nodes).filter(([id]) => !retired.has(id))),
		Object.fromEntries(Object.entries(nodes).filter(([id]) => retired.has(id)))
	];
	const refs = (nodes, get) => new Set(Object.values(nodes).flatMap(get));
	const exclusive = (active, retired) => new Set([...retired].filter((id) => !active.has(id)));
	const [models, retiredModels] = split(
		graph.models,
		new Set(
			Object.entries(graph.models)
				.filter(([, value]) => value.retired)
				.map(([id]) => id)
		)
	);
	const [deployments, retiredDeployments] = split(
		graph.deployments,
		new Set(
			Object.entries(graph.deployments)
				.filter(([, value]) => value.retired)
				.map(([id]) => id)
		)
	);
	const retiredGroupIds = new Set(
		ancestorGroupIds(graph.groups, [...refs(retiredModels, (model) => model.groupIds)])
	);
	const activeGroupIds = new Set(
		ancestorGroupIds(graph.groups, [
			...refs(models, (model) => model.groupIds),
			...Object.keys(graph.groups).filter((id) => !retiredGroupIds.has(id))
		])
	);
	const [groups, retiredGroups] = split(graph.groups, exclusive(activeGroupIds, retiredGroupIds));
	const [routes, retiredRoutes] = split(
		graph.routes,
		exclusive(
			refs(deployments, (value) => value.routeIds),
			refs(retiredDeployments, (value) => value.routeIds)
		)
	);
	const [providers, retiredProviders] = split(
		graph.providers,
		exclusive(
			refs(routes, (value) => [value.providerId]),
			refs(retiredRoutes, (value) => [value.providerId])
		)
	);
	const [authors, retiredAuthors] = split(
		graph.authors,
		exclusive(
			new Set([
				...refs(models, (value) => [value.authorId]),
				...refs(groups, (value) => [value.authorId])
			]),
			new Set([
				...refs(retiredModels, (value) => [value.authorId]),
				...refs(retiredGroups, (value) => [value.authorId])
			])
		)
	);
	return {
		active: { authors, groups, models, providers, routes, deployments },
		retired: {
			authors: retiredAuthors,
			groups: retiredGroups,
			models: retiredModels,
			providers: retiredProviders,
			routes: retiredRoutes,
			deployments: retiredDeployments
		}
	};
}

export function parseArchiveReference(value) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(',') !== 'sha256,size_bytes' ||
		typeof value.sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/.test(value.sha256) ||
		!Number.isSafeInteger(value.size_bytes) ||
		value.size_bytes < 1 ||
		value.size_bytes > catalogPublicSizeLimit
	) {
		throw new Error('Catalog archive reference is invalid');
	}
	return value;
}

// The caller verifies these bytes against the reference in the approved public root.
export function mergeCatalogArchive(catalog, archive) {
	if (
		!archive ||
		typeof archive !== 'object' ||
		archive.schema !== 'stogas.catalog.archive.v1' ||
		!archive.graph ||
		typeof archive.graph !== 'object' ||
		Array.isArray(archive.graph) ||
		Object.keys(archive.graph).sort().join(',') !== [...catalogCollections].sort().join(',')
	) {
		throw new Error('Catalog archive schema is invalid');
	}
	const graph = {};
	for (const kind of catalogCollections) {
		const records = archive.graph[kind];
		if (
			!records ||
			typeof records !== 'object' ||
			Array.isArray(records) ||
			Object.values(records).some(
				(value) => !value || typeof value !== 'object' || Array.isArray(value)
			)
		) {
			throw new Error(`Catalog archive ${kind} collection is invalid`);
		}
		const active = catalog.graph?.[kind] ?? {};
		if (Object.keys(records).some((id) => Object.hasOwn(active, id))) {
			throw new Error(`Catalog archive duplicates an active ${kind} record`);
		}
		graph[kind] = { ...active, ...records };
	}
	return { ...catalog, graph };
}
