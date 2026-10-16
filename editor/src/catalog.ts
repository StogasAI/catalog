import type { Edge, Node } from '@xyflow/svelte';
import { ancestorGroupIds, orderModelGroups } from '../../source/scripts/model-groups.mjs';
import type {
	Catalog,
	CatalogFlow,
	CatalogGraph,
	EffectiveFact,
	GraphChain,
	GraphNodeData,
	LineageNode,
	NodeType
} from './types';

const graphChainNodeOrder: NodeType[] = [
	'author',
	'group',
	'model',
	'deployment',
	'route',
	'provider'
];

export function nodeKey(type: NodeType, id: string) {
	return `${type}:${id}`;
}

export function parseNodeKey(key: string): { type: NodeType; id: string } | null {
	const [type, ...rest] = key.split(':');
	const id = rest.join(':');
	if (!id || !isNodeType(type)) return null;
	return { type, id };
}

function isNodeType(value: string): value is NodeType {
	return graphChainNodeOrder.some((type) => type === value);
}

export function buildFlow(graph: CatalogGraph): CatalogFlow {
	const positions = groupedLayoutPositions(graph);
	const retired = retiredNodeIds(graph);
	const nodes: Node<GraphNodeData>[] = [
		...Object.keys(graph.authors).map((id) =>
			makeNode('author', id, positionFor(positions, 'author', id), { rightOut: true })
		),
		...Object.entries(graph.groups).map(([id, group]) =>
			makeNode(
				'group',
				id,
				positionFor(positions, 'group', id),
				{ leftIn: true, rightOut: true },
				{ label: group.name }
			)
		),
		...Object.keys(graph.models).map((id) =>
			makeNode(
				'model',
				id,
				positionFor(positions, 'model', id),
				{ leftIn: true, rightOut: true },
				{
					label: String(graph.models[id].name ?? id),
					subtitle: retired.models.has(id) ? 'Retired' : undefined
				}
			)
		),
		...Object.keys(graph.deployments).map((id) =>
			makeNode(
				'deployment',
				id,
				positionFor(positions, 'deployment', id),
				{
					leftIn: true,
					rightIn: true
				},
				{ subtitle: retired.deployments.has(id) ? 'Retired' : undefined }
			)
		),
		...Object.keys(graph.routes).map((id) =>
			makeNode('route', id, positionFor(positions, 'route', id), {
				leftOut: true,
				rightIn: true
			})
		),
		...Object.keys(graph.providers).map((id) =>
			makeNode(
				'provider',
				id,
				positionFor(positions, 'provider', id),
				{ leftOut: true },
				{ label: String(graph.providers[id].name ?? id) }
			)
		)
	];
	const edges: Edge[] = [];
	for (const [id, group] of Object.entries(graph.groups)) {
		if (group.parentIds.length === 0)
			edges.push(edge('author', group.authorId, 'group', id, 'groups', 'right-out', 'left-in'));
		for (const parentId of group.parentIds)
			edges.push(edge('group', parentId, 'group', id, 'contains', 'right-out', 'left-in'));
	}
	for (const [modelId, model] of Object.entries(graph.models)) {
		const groups = modelGroupIds(model);
		if (groups.length === 0)
			edges.push(
				edge('author', String(model.authorId), 'model', modelId, 'owns', 'right-out', 'left-in')
			);
		for (const groupId of groups)
			edges.push(edge('group', groupId, 'model', modelId, 'contains', 'right-out', 'left-in'));
	}
	for (const [routeId, route] of Object.entries(graph.routes)) {
		edges.push(
			edge(
				'provider',
				String(route.providerId),
				'route',
				routeId,
				'provides',
				'left-out',
				'right-in'
			)
		);
	}
	for (const [deploymentId, deployment] of Object.entries(graph.deployments)) {
		edges.push(
			edge(
				'model',
				String(deployment.modelId),
				'deployment',
				deploymentId,
				'implements',
				'right-out',
				'left-in'
			)
		);
		for (const routeId of routeIds(deployment)) {
			edges.push(
				edge('route', routeId, 'deployment', deploymentId, 'serves', 'left-out', 'right-in')
			);
		}
	}
	return { nodes, edges };
}

function groupedLayoutPositions(graph: CatalogGraph) {
	const positions = new Map<string, { x: number; y: number }>();
	const groupDepths = orderModelGroups(graph.groups);
	let groupColumns = 0;
	for (const depth of groupDepths.values()) groupColumns = Math.max(groupColumns, depth);
	const deploymentsByModel = new Map<string, string[]>();
	for (const [deploymentId, deployment] of Object.entries(graph.deployments)) {
		const modelId = String(deployment.modelId ?? '');
		const deployments = deploymentsByModel.get(modelId) ?? [];
		deployments.push(deploymentId);
		deploymentsByModel.set(modelId, deployments);
	}
	let cursor = 180;
	for (const modelId of Object.keys(graph.models).sort((left, right) =>
		String(graph.models[left]?.name ?? left).localeCompare(
			String(graph.models[right]?.name ?? right)
		)
	)) {
		const deploymentIds = deploymentsByModel.get(modelId)?.sort() ?? [];
		const span = Math.max(0, deploymentIds.length - 1) * 92;
		positions.set(nodeKey('model', modelId), lanePosition('model', cursor + span / 2));
		deploymentIds.forEach((deploymentId, index) => {
			positions.set(
				nodeKey('deployment', deploymentId),
				lanePosition('deployment', cursor + index * 92)
			);
		});
		cursor += span + 150;
	}
	const average = (values: number[]) =>
		values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 180;
	const y = (type: NodeType, id: string) => positions.get(nodeKey(type, id))?.y ?? 180;
	const modelGroups = new Map(
		Object.entries(graph.models).map(([id, model]) => [
			id,
			new Set(ancestorGroupIds(graph.groups, modelGroupIds(model)))
		])
	);
	for (let depth = 1; depth <= groupColumns; depth++) {
		placeNonOverlappingLane(
			positions,
			'group',
			[...groupDepths]
				.filter(([, value]) => value === depth)
				.map(([id]) => ({
					id,
					y: average(
						[...modelGroups]
							.filter(([, groups]) => groups.has(id))
							.map(([modelId]) => y('model', modelId))
					)
				}))
		);
	}

	placeNonOverlappingLane(
		positions,
		'author',
		Object.keys(graph.authors).map((id) => ({
			id,
			y: average(
				Object.entries(graph.models)
					.filter(([, model]) => model.authorId === id)
					.map(([modelId]) => y('model', modelId))
			)
		}))
	);
	placeNonOverlappingLane(
		positions,
		'route',
		Object.keys(graph.routes).map((id) => ({
			id,
			y: average(
				Object.entries(graph.deployments)
					.filter(([, deployment]) => routeIds(deployment).includes(id))
					.map(([deploymentId]) => y('deployment', deploymentId))
			)
		}))
	);
	placeNonOverlappingLane(
		positions,
		'provider',
		Object.keys(graph.providers).map((id) => ({
			id,
			y: average(
				Object.entries(graph.routes)
					.filter(([, route]) => route.providerId === id)
					.map(([routeId]) => y('route', routeId))
			)
		}))
	);
	for (const [key, position] of positions) {
		const node = parseNodeKey(key)!;
		const column =
			node.type === 'author'
				? 0
				: node.type === 'group'
					? groupDepths.get(node.id)!
					: graphChainNodeOrder.indexOf(node.type) - 1 + groupColumns;
		position.x = 80 + column * 280;
	}
	return positions;
}

function modelGroupIds(model: Record<string, unknown>) {
	return Array.isArray(model.groupIds)
		? model.groupIds.filter((id): id is string => typeof id === 'string')
		: [];
}

function groupingPath(graph: CatalogGraph, modelId: string): GraphChain {
	const model = graph.models[modelId];
	const authorId = String(model.authorId);
	const direct = modelGroupIds(model);
	const groups = ancestorGroupIds(graph.groups, direct);
	const edgeIds: string[] = [];
	for (const id of groups) {
		const group = graph.groups[id];
		if (!group.parentIds.length) edgeIds.push(graphEdgeId('author', authorId, 'group', id));
		for (const parent of group.parentIds) edgeIds.push(graphEdgeId('group', parent, 'group', id));
	}
	if (!direct.length) edgeIds.push(graphEdgeId('author', authorId, 'model', modelId));
	for (const id of direct) edgeIds.push(graphEdgeId('group', id, 'model', modelId));
	return {
		nodeKeys: [
			nodeKey('author', authorId),
			...groups.map((id) => nodeKey('group', id)),
			nodeKey('model', modelId)
		],
		edgeIds
	};
}

function placeNonOverlappingLane(
	positions: Map<string, { x: number; y: number }>,
	type: NodeType,
	desired: Array<{ id: string; y: number }>
) {
	const spacing = 92;
	const ordered = desired.sort(
		(left, right) => left.y - right.y || left.id.localeCompare(right.id)
	);
	if (!ordered.length) return;
	const placed: number[] = [];
	for (const item of ordered) {
		placed.push(Math.max(item.y, (placed.at(-1) ?? item.y - spacing) + spacing));
	}
	const desiredCenter = ordered.reduce((sum, item) => sum + item.y, 0) / ordered.length;
	const placedCenter = placed.reduce((sum, value) => sum + value, 0) / placed.length;
	const shift = Math.max(desiredCenter - placedCenter, 80 - placed[0]);
	ordered.forEach((item, index) => {
		positions.set(nodeKey(type, item.id), lanePosition(type, placed[index] + shift));
	});
}

function positionFor(positions: Map<string, { x: number; y: number }>, type: NodeType, id: string) {
	return positions.get(nodeKey(type, id)) ?? lanePosition(type, 180);
}

function lanePosition(type: NodeType, y: number) {
	return { x: 80 + graphChainNodeOrder.indexOf(type) * 280, y };
}

// Source keeps a record until someone removes it. A deployment retires on its deprecation
// date; a model retires with its last deployment, or on its own date when it has none.
function retiredNodeIds(graph: CatalogGraph, today = new Date().toISOString().slice(0, 10)) {
	const passed = (date: unknown) => typeof date === 'string' && date <= today;
	const deployments = new Set<string>();
	const deployed = new Set<string>();
	const served = new Set<string>();
	for (const [id, deployment] of Object.entries(graph.deployments)) {
		const modelId = String(deployment.modelId);
		const overrides = deployment.overrides;
		deployed.add(modelId);
		if (
			passed(
				isPlainRecord(overrides) && 'deprecationDate' in overrides
					? overrides.deprecationDate
					: graph.models[modelId]?.deprecationDate
			)
		)
			deployments.add(id);
		else served.add(modelId);
	}
	const models = new Set(
		Object.entries(graph.models)
			.filter(
				([id, model]) => !served.has(id) && (deployed.has(id) || passed(model.deprecationDate))
			)
			.map(([id]) => id)
	);
	return { deployments, models };
}

function makeNode(
	type: NodeType,
	id: string,
	position: { x: number; y: number },
	handles: GraphNodeData['handles'] = {},
	details: Partial<Pick<GraphNodeData, 'label' | 'subtitle'>> = {}
) {
	return {
		id: nodeKey(type, id),
		type: 'catalog',
		data: { id, type, handles, label: details.label || id, subtitle: details.subtitle },
		position,
		class: `catalog-node catalog-node-${type}`,
		ariaRole: 'button' as const
	};
}

function edge(
	sourceType: NodeType,
	sourceId: string,
	targetType: NodeType,
	targetId: string,
	role: string,
	sourceHandle: string,
	targetHandle: string
): Edge {
	return {
		id: graphEdgeId(sourceType, sourceId, targetType, targetId),
		source: nodeKey(sourceType, sourceId),
		target: nodeKey(targetType, targetId),
		sourceHandle,
		targetHandle,
		type: 'smoothstep',
		class: `catalog-edge catalog-edge-${role}`,
		markerEnd: { type: 'arrowclosed', width: 14, height: 14 }
	};
}

export function concreteGraphChains(catalog: Catalog): GraphChain[] {
	const chains: GraphChain[] = [];
	for (const [deploymentId, deployment] of Object.entries(catalog.graph.deployments)) {
		const modelId = String(deployment.modelId);
		const grouping = groupingPath(catalog.graph, modelId);
		for (const routeId of routeIds(deployment)) {
			const providerId = String(catalog.graph.routes[routeId]?.providerId ?? '');
			chains.push({
				nodeKeys: [
					...grouping.nodeKeys,
					nodeKey('deployment', deploymentId),
					nodeKey('route', routeId),
					nodeKey('provider', providerId)
				],
				edgeIds: [
					...grouping.edgeIds,
					graphEdgeId('model', modelId, 'deployment', deploymentId),
					graphEdgeId('route', routeId, 'deployment', deploymentId),
					graphEdgeId('provider', providerId, 'route', routeId)
				]
			});
		}
	}
	return chains;
}

export const GRAPH_PAGE_SIZE = 40;

export function indexGraphPaths(catalog: Catalog) {
	const paths = concreteGraphChains(catalog);
	const covered = new Set(paths.flatMap((path) => path.nodeKeys));
	const search = new Map<string, string>();
	for (const type of graphChainNodeOrder) {
		const collection = catalog.graph[`${type}s` as keyof CatalogGraph];
		for (const [id, value] of Object.entries(collection)) {
			const key = nodeKey(type, id);
			search.set(
				key,
				[type, id, value.name, ...(Array.isArray(value.aliases) ? value.aliases : [])]
					.join(' ')
					.toLowerCase()
			);
		}
	}
	// Informational models and unused routes still need to be reachable.
	for (const type of ['model', 'group', 'route', 'author', 'provider'] as const) {
		for (const id of Object.keys(catalog.graph[`${type}s`])) {
			const key = nodeKey(type, id);
			if (covered.has(key)) continue;
			const lineage = lineageForSelection(catalog, key, {});
			const nodeKeys = lineage.map((node) => nodeKey(node.type, node.id));
			const edgeIds: string[] = [];
			if (type === 'route') edgeIds.push(graphEdgeId('provider', lineage[1].id, 'route', id));
			if (type === 'model') edgeIds.push(...groupingPath(catalog.graph, id).edgeIds);
			if (type === 'group') {
				for (const node of lineage.filter((node) => node.type === 'group')) {
					const group = catalog.graph.groups[node.id];
					if (!group.parentIds.length)
						edgeIds.push(graphEdgeId('author', group.authorId, 'group', node.id));
					for (const parent of group.parentIds)
						edgeIds.push(graphEdgeId('group', parent, 'group', node.id));
				}
			}
			paths.push({ nodeKeys, edgeIds });
			for (const nodeKey of nodeKeys) covered.add(nodeKey);
		}
	}
	return { paths, search };
}

export function pageGraph(
	catalog: Catalog,
	index: ReturnType<typeof indexGraphPaths>,
	options: {
		page: number;
		query: string;
		visibleTypes: Record<NodeType, boolean>;
		selectedKeys: string[];
	}
) {
	const needle = options.query.trim().toLowerCase();
	const paths = index.paths.filter(
		(path) =>
			options.selectedKeys.every((key) => path.nodeKeys.includes(key)) &&
			path.nodeKeys.some((key) => {
				const node = parseNodeKey(key);
				return (
					node &&
					options.visibleTypes[node.type] &&
					(!needle || index.search.get(key)?.includes(needle))
				);
			})
	);
	const pageCount = Math.max(1, Math.ceil(paths.length / GRAPH_PAGE_SIZE));
	const page = Math.min(Math.max(0, Math.trunc(options.page) || 0), pageCount - 1);
	const graph: CatalogGraph = {
		authors: {},
		groups: {},
		models: {},
		deployments: {},
		routes: {},
		providers: {}
	};
	const edgeIds = new Set<string>();
	for (const path of paths.slice(page * GRAPH_PAGE_SIZE, (page + 1) * GRAPH_PAGE_SIZE)) {
		for (const id of path.edgeIds) edgeIds.add(id);
		for (const key of path.nodeKeys) {
			const node = parseNodeKey(key);
			if (!node) continue;
			const collection = `${node.type}s` as keyof CatalogGraph;
			Object.assign(graph[collection], { [node.id]: catalog.graph[collection][node.id] });
		}
	}
	for (const [id, deployment] of Object.entries(graph.deployments)) {
		graph.deployments[id] = {
			...deployment,
			routeIds: routeIds(deployment).filter((id) => Object.hasOwn(graph.routes, id))
		};
	}
	const flow = buildFlow(graph);
	flow.edges = flow.edges.filter((edge) => edgeIds.has(edge.id));
	return { flow, total: paths.length, page, pageCount };
}

export function decorateFlow(
	flow: CatalogFlow,
	currentKey: string,
	currentEdgeId = '',
	selectedKeys: string[] = [],
	graphChains: GraphChain[] = []
): CatalogFlow {
	const selected = new Set(selectedKeys.length ? selectedKeys : currentKey ? [currentKey] : []);
	const visibleEdges = selected.size
		? new Set(
				graphChains
					.filter((chain) => [...selected].every((key) => chain.nodeKeys.includes(key)))
					.flatMap((chain) => chain.edgeIds)
			)
		: new Set(flow.edges.map((item) => String(item.id)));
	const related = new Set<string>();
	for (const item of flow.edges) {
		if (!visibleEdges.has(String(item.id))) continue;
		related.add(String(item.source));
		related.add(String(item.target));
	}
	return {
		nodes: flow.nodes.map((node) => ({
			...node,
			class: [
				node.class,
				related.has(node.id) ? 'catalog-node-related' : '',
				selected.has(node.id) ? 'catalog-node-active' : '',
				node.id === currentKey ? 'catalog-node-current' : ''
			]
				.filter(Boolean)
				.join(' ')
		})),
		edges: flow.edges.map((item) => ({
			...item,
			hidden: selected.size > 0 && !visibleEdges.has(String(item.id)) && item.id !== currentEdgeId,
			class: [
				item.class,
				selected.has(String(item.source)) && selected.has(String(item.target))
					? 'catalog-edge-active'
					: '',
				item.id === currentEdgeId ? 'catalog-edge-current' : ''
			]
				.filter(Boolean)
				.join(' ')
		}))
	};
}

export function extendGraphSelection(
	flow: CatalogFlow,
	graphChains: GraphChain[],
	selectedKeys: string[],
	nextKey: string
) {
	if (!selectedKeys.length) return [nextKey];
	if (selectedKeys.includes(nextKey)) return selectedKeys;
	if (!flow.nodes.some((node) => node.id === nextKey)) return null;
	const chain = graphChains.find((candidate) =>
		[...selectedKeys, nextKey].every((key) => candidate.nodeKeys.includes(key))
	);
	if (!chain) return null;
	const indexes = selectedKeys
		.map((key) => chain.nodeKeys.indexOf(key))
		.filter((index) => index >= 0);
	const nextIndex = chain.nodeKeys.indexOf(nextKey);
	const nearest = indexes.reduce<number | undefined>(
		(current, index) =>
			current === undefined || Math.abs(index - nextIndex) < Math.abs(current - nextIndex)
				? index
				: current,
		undefined
	);
	if (nearest === undefined) return [...selectedKeys, nextKey];
	const from = Math.min(nearest, nextIndex);
	const to = Math.max(nearest, nextIndex);
	return unique([...selectedKeys, ...chain.nodeKeys.slice(from, to + 1)]);
}

export function completeUnambiguousGraphSelection(
	graphChains: GraphChain[],
	selectedKeys: string[]
) {
	if (!selectedKeys.length) return [];
	const matching = graphChains.filter((chain) =>
		selectedKeys.every((key) => chain.nodeKeys.includes(key))
	);
	if (!matching.length) return selectedKeys;
	const selectedByType = new Map<NodeType, string>();
	const selectedGroups = matching[0].nodeKeys.filter(
		(key) =>
			parseNodeKey(key)?.type === 'group' && matching.every((chain) => chain.nodeKeys.includes(key))
	);
	for (const key of selectedKeys) {
		const parsed = parseNodeKey(key);
		if (parsed) selectedByType.set(parsed.type, key);
	}
	for (const type of graphChainNodeOrder) {
		if (type === 'group') continue;
		if (selectedByType.has(type)) continue;
		const candidates = unique(
			matching
				.map((chain) => chain.nodeKeys.find((key) => parseNodeKey(key)?.type === type) ?? '')
				.filter(Boolean)
		);
		if (candidates.length === 1) selectedByType.set(type, candidates[0]);
	}
	return graphChainNodeOrder.flatMap((type) => {
		if (type === 'group') return selectedGroups;
		const key = selectedByType.get(type);
		return key ? [key] : [];
	});
}

export function filterFlow(
	flow: CatalogFlow,
	visibleTypes: Record<string, boolean>,
	query = '',
	selectedKeys: string[] = [],
	graphChains: GraphChain[] = []
): CatalogFlow {
	const compatible = selectedKeys.length
		? new Set(
				graphChains
					.filter((chain) => selectedKeys.every((key) => chain.nodeKeys.includes(key)))
					.flatMap((chain) => chain.nodeKeys)
			)
		: null;
	const needle = query.trim().toLowerCase();
	const nodes = flow.nodes.filter((node) => {
		if (compatible && !compatible.has(node.id)) return false;
		if (visibleTypes[node.data.type] === false) return false;
		return (
			!needle ||
			node.data.id.toLowerCase().includes(needle) ||
			node.data.label.toLowerCase().includes(needle) ||
			node.data.type.includes(needle)
		);
	});
	const ids = new Set(nodes.map((node) => node.id));
	return {
		nodes,
		edges: flow.edges.filter(
			(item) => !item.hidden && ids.has(String(item.source)) && ids.has(String(item.target))
		)
	};
}

export function lineageForSelection(
	catalog: Catalog,
	selectedKey: string,
	context: { routeId?: string; deploymentId?: string }
): LineageNode[] {
	const selected = parseNodeKey(selectedKey);
	if (!selected) return [];
	const deploymentId =
		context.deploymentId ?? (selected.type === 'deployment' ? selected.id : undefined);
	const routeId = context.routeId ?? (selected.type === 'route' ? selected.id : undefined);
	if (deploymentId) return deploymentLineage(catalog, deploymentId, routeId);
	if (routeId) return routeLineage(catalog, routeId);
	if (selected.type === 'model') {
		const model = catalog.graph.models[selected.id];
		if (!model) return [];
		const authorId = String(model.authorId);
		return [
			source('author', authorId, catalog.graph.authors[authorId]),
			...ancestorGroupIds(catalog.graph.groups, modelGroupIds(model)).map((id) =>
				source('group', id, catalog.graph.groups[id])
			),
			source('model', selected.id, model)
		];
	}
	if (selected.type === 'group') {
		const group = catalog.graph.groups[selected.id];
		if (!group) return [];
		return [
			source('author', group.authorId, catalog.graph.authors[group.authorId]),
			...ancestorGroupIds(catalog.graph.groups, [selected.id]).map((id) =>
				source('group', id, catalog.graph.groups[id])
			)
		];
	}
	const value = selectedNodeValue(catalog.graph, selected.type, selected.id);
	return value ? [source(selected.type, selected.id, value)] : [];
}

function selectedNodeValue(graph: CatalogGraph, type: NodeType, id: string) {
	switch (type) {
		case 'author':
			return graph.authors[id];
		case 'group':
			return graph.groups[id];
		case 'model':
			return graph.models[id];
		case 'deployment':
			return graph.deployments[id];
		case 'route':
			return graph.routes[id];
		case 'provider':
			return graph.providers[id];
	}
}

export function effectiveDeploymentFacts(
	catalog: Catalog,
	deploymentId: string,
	preferredRouteId = ''
): EffectiveFact[] {
	const deployment = catalog.graph.deployments[deploymentId];
	if (!deployment) return [];
	const modelId = String(deployment.modelId ?? '');
	const model = catalog.graph.models[modelId] ?? {};
	const deploymentRouteIds = routeIds(deployment);
	if (
		deploymentRouteIds.length === 0 ||
		(preferredRouteId && !deploymentRouteIds.includes(preferredRouteId)) ||
		(!preferredRouteId && deploymentRouteIds.length > 1)
	) {
		return [];
	}
	const routeId = preferredRouteId || deploymentRouteIds[0] || '';
	const route = catalog.graph.routes[routeId] ?? {};
	const providerId = String(route.providerId ?? '');
	const provider = catalog.graph.providers[providerId] ?? {};
	const value: Record<string, unknown> = {};
	const origins = new Map<string, EffectiveFact['origin']>();
	const providerOrigin = { type: 'provider' as const, id: providerId };
	const routeOrigin = { type: 'route' as const, id: routeId };
	const modelOrigin = { type: 'model' as const, id: modelId };
	const deploymentOrigin = { type: 'deployment' as const, id: deploymentId };

	applyFactLayer(
		value,
		origins,
		selectFacts(provider, ['capabilities', 'dataHandling']),
		providerOrigin
	);
	const routeOverrides = objectAt(route, ['overrides']);
	applyFactLayer(
		value,
		origins,
		selectFacts(route, ['dataHandling', 'nativeFileInputs']),
		routeOrigin
	);
	applyFactLayer(value, origins, selectFacts(routeOverrides, ['capabilities']), routeOrigin);
	applyFactLayer(value, origins, { pricing: route.pricing }, routeOrigin);
	applyFactLayer(
		value,
		origins,
		selectFacts(model, [
			'contextWindowTokens',
			'deprecationDate',
			'inputModalities',
			'maxInputTokens',
			'maxOutputTokens',
			'outputModalities',
			'reasoning',
			'reasoningEfforts',
			'reasoningMaxTokens'
		]),
		modelOrigin
	);
	for (const [capability, supported] of Object.entries(objectAt(model, ['capabilities']))) {
		const path = ['capabilities', capability];
		setValueAt(value, path, Boolean(valueAt(value, path) && supported));
		origins.set(path.join('.'), modelOrigin);
	}
	const deploymentOverrides = objectAt(deployment, ['overrides']);
	applyFactLayer(
		value,
		origins,
		selectFacts(deploymentOverrides, [
			'capabilities',
			'contextWindowTokens',
			'dataHandling',
			'deprecationDate',
			'nativeFileInputs',
			'inputModalities',
			'maxInputTokens',
			'maxOutputTokens',
			'outputModalities',
			'pricing',
			'reasoning',
			'reasoningEfforts',
			'reasoningMaxTokens'
		]),
		deploymentOrigin
	);
	// The compiler applies a model's shorter list for an interface on routes that serve only it.
	const interfaces = Array.isArray(route.interfaces) ? route.interfaces : [];
	const interfaceEfforts = objectAt(model, ['reasoningEffortsByInterface'])[String(interfaces[0])];
	const efforts = valueAt(value, ['reasoningEfforts']);
	if (interfaces.length === 1 && Array.isArray(interfaceEfforts) && Array.isArray(efforts)) {
		const narrowed = efforts.filter((effort) => interfaceEfforts.includes(effort));
		if (narrowed.length !== efforts.length) {
			setValueAt(value, ['reasoningEfforts'], narrowed);
			origins.set('reasoningEfforts', modelOrigin);
		}
	}
	applyFactLayer(
		value,
		origins,
		selectFacts(deployment, [
			'approvalRequired',
			'modelId',
			'pricing',
			'routeIds',
			'upstream',
			'weightPrecision'
		]),
		deploymentOrigin
	);

	const inputLimit = valueAt(value, ['maxInputTokens']);
	const contextLimit = valueAt(value, ['contextWindowTokens']);
	if (
		typeof inputLimit === 'number' &&
		typeof contextLimit === 'number' &&
		inputLimit > contextLimit
	) {
		setValueAt(value, ['maxInputTokens'], contextLimit);
		origins.set('maxInputTokens', origins.get('contextWindowTokens') ?? deploymentOrigin);
	}

	return flattenFacts(value)
		.map(({ path, value: factValue }) => ({
			path: path.join('.'),
			value: factValue,
			origin: origins.get(path.join('.')) ?? deploymentOrigin
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
}

export function effectiveDeploymentValue(
	catalog: Catalog,
	deploymentId: string,
	preferredRouteId = ''
): Record<string, unknown> | null {
	const facts = effectiveDeploymentFacts(catalog, deploymentId, preferredRouteId);
	if (facts.length === 0) return null;
	const result: Record<string, unknown> = {};
	for (const fact of facts) setValueAt(result, fact.path.split('.'), fact.value);
	return result;
}

function applyFactLayer(
	target: Record<string, unknown>,
	origins: Map<string, EffectiveFact['origin']>,
	layer: Record<string, unknown>,
	origin: EffectiveFact['origin'],
	prefix: string[] = []
) {
	for (const [key, child] of Object.entries(layer)) {
		if (child === undefined) continue;
		const path = [...prefix, key];
		const current = valueAt(target, path);
		if (isPlainRecord(current) && isPlainRecord(child)) {
			applyFactLayer(target, origins, child, origin, path);
			continue;
		}
		setValueAt(target, path, structuredClone(child));
		for (const fact of flattenFacts({ [key]: child }, prefix)) {
			origins.set(fact.path.join('.'), origin);
		}
	}
}

function selectFacts(value: Record<string, unknown>, keys: string[]) {
	return Object.fromEntries(
		keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
	);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flattenFacts(value: Record<string, unknown>, prefix: string[] = []) {
	const facts: { path: string[]; value: unknown }[] = [];
	for (const [key, child] of Object.entries(value)) {
		const path = [...prefix, key];
		if (isPlainRecord(child)) {
			const nested = flattenFacts(child, path);
			if (nested.length) facts.push(...nested);
			else facts.push({ path, value: child });
		} else {
			facts.push({ path, value: child });
		}
	}
	return facts;
}

function valueAt(value: Record<string, unknown>, path: string[]): unknown {
	let current: unknown = value;
	for (const key of path) {
		if (!isPlainRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

function setValueAt(value: Record<string, unknown>, path: string[], child: unknown) {
	let current = value;
	for (const key of path.slice(0, -1)) {
		const next = current[key];
		if (isPlainRecord(next)) {
			current = next;
			continue;
		}
		const created: Record<string, unknown> = {};
		current[key] = created;
		current = created;
	}
	const leaf = path.at(-1);
	if (leaf) current[leaf] = child;
}

function objectAt(value: Record<string, unknown>, path: string[]) {
	const result = valueAt(value, path);
	return isPlainRecord(result) ? result : {};
}

function deploymentLineage(catalog: Catalog, deploymentId: string, preferredRouteId?: string) {
	const deployment = catalog.graph.deployments[deploymentId];
	if (!deployment) return [];
	const deploymentRouteIds = routeIds(deployment);
	if (
		deploymentRouteIds.length === 0 ||
		(preferredRouteId && !deploymentRouteIds.includes(preferredRouteId))
	) {
		return [];
	}
	const modelId = String(deployment.modelId);
	const model = catalog.graph.models[modelId];
	const authorId = String(model?.authorId ?? '');
	const routeId = preferredRouteId || deploymentRouteIds[0];
	const route = catalog.graph.routes[routeId];
	const providerId = String(route?.providerId ?? '');
	return [
		source('author', authorId, catalog.graph.authors[authorId]),
		...ancestorGroupIds(catalog.graph.groups, modelGroupIds(model)).map((id) =>
			source('group', id, catalog.graph.groups[id])
		),
		source('model', modelId, model),
		source('deployment', deploymentId, deployment),
		source('route', routeId, route),
		source('provider', providerId, catalog.graph.providers[providerId])
	].filter((item) => item.id);
}

function routeLineage(catalog: Catalog, routeId: string) {
	const route = catalog.graph.routes[routeId];
	if (!route) return [];
	const providerId = String(route.providerId);
	return [
		source('route', routeId, route),
		source('provider', providerId, catalog.graph.providers[providerId])
	];
}

function source(
	type: NodeType,
	id: string,
	value: Record<string, unknown> | undefined
): LineageNode {
	return { type, id, value: value ?? {} };
}

function routeIds(deployment: Record<string, unknown>) {
	return Array.isArray(deployment.routeIds) ? deployment.routeIds.map(String).sort() : [];
}

function graphEdgeId(
	sourceType: NodeType,
	sourceId: string,
	targetType: NodeType,
	targetId: string
) {
	return `${nodeKey(sourceType, sourceId)}>${nodeKey(targetType, targetId)}`;
}

function unique<T>(items: T[]) {
	return [...new Set(items)];
}
