import { MarkerType, type Edge, type Node } from '@xyflow/svelte';
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

const graphChainNodeOrder: NodeType[] = ['author', 'model', 'deployment', 'route', 'provider'];

export function nodeKey(type: NodeType, id: string) {
	return `${type}:${id}`;
}

export function parseNodeKey(key: string): { type: NodeType; id: string } | null {
	const [type, ...rest] = key.split(':');
	if (!rest.length || !isNodeType(type)) return null;
	return { type, id: rest.join(':') };
}

function isNodeType(value: string): value is NodeType {
	return ['author', 'model', 'provider', 'route', 'deployment'].includes(value);
}

export function buildFlow(graph: CatalogGraph): CatalogFlow {
	const positions = groupedLayoutPositions(graph);
	const nodes: Node<GraphNodeData>[] = [
		...Object.keys(graph.authors).map((id) =>
			makeNode('author', id, positionFor(positions, 'author', id), { rightOut: true })
		),
		...Object.keys(graph.models).map((id) =>
			makeNode(
				'model',
				id,
				positionFor(positions, 'model', id),
				{ leftIn: true, rightOut: true },
				{ label: String(graph.models[id].name ?? id) }
			)
		),
		...Object.keys(graph.deployments).map((id) =>
			makeNode('deployment', id, positionFor(positions, 'deployment', id), {
				leftIn: true,
				rightIn: true
			})
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
	for (const [modelId, model] of Object.entries(graph.models)) {
		edges.push(
			edge('author', String(model.authorId), 'model', modelId, 'owns', 'right-out', 'left-in')
		);
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
	const deploymentsByModel = new Map<string, string[]>();
	for (const [deploymentId, deployment] of Object.entries(graph.deployments)) {
		const modelId = String(deployment.modelId ?? '');
		deploymentsByModel.set(modelId, [...(deploymentsByModel.get(modelId) ?? []), deploymentId]);
	}
	let cursor = 180;
	for (const modelId of [...deploymentsByModel.keys()].sort((left, right) =>
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

	for (const authorId of Object.keys(graph.authors)) {
		const modelIds = Object.entries(graph.models)
			.filter(([, model]) => model.authorId === authorId)
			.map(([id]) => id);
		positions.set(
			nodeKey('author', authorId),
			lanePosition('author', average(modelIds.map((id) => y('model', id))))
		);
	}
	for (const routeId of Object.keys(graph.routes)) {
		const deploymentIds = Object.entries(graph.deployments)
			.filter(([, deployment]) => routeIds(deployment).includes(routeId))
			.map(([id]) => id);
		positions.set(
			nodeKey('route', routeId),
			lanePosition('route', average(deploymentIds.map((id) => y('deployment', id))))
		);
	}
	for (const providerId of Object.keys(graph.providers)) {
		const routeIdsForProvider = Object.entries(graph.routes)
			.filter(([, route]) => route.providerId === providerId)
			.map(([id]) => id);
		positions.set(
			nodeKey('provider', providerId),
			lanePosition('provider', average(routeIdsForProvider.map((id) => y('route', id))))
		);
	}
	return positions;
}

function positionFor(positions: Map<string, { x: number; y: number }>, type: NodeType, id: string) {
	return positions.get(nodeKey(type, id)) ?? lanePosition(type, 180);
}

function lanePosition(type: NodeType, y: number) {
	return { x: 80 + graphChainNodeOrder.indexOf(type) * 280, y };
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
) {
	return {
		id: graphEdgeId(sourceType, sourceId, targetType, targetId),
		source: nodeKey(sourceType, sourceId),
		target: nodeKey(targetType, targetId),
		sourceHandle,
		targetHandle,
		type: 'smoothstep',
		class: `catalog-edge catalog-edge-${role}`,
		markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }
	};
}

export function concreteGraphChains(catalog: Catalog): GraphChain[] {
	const chains: GraphChain[] = [];
	for (const [deploymentId, deployment] of Object.entries(catalog.graph.deployments)) {
		const modelId = String(deployment.modelId);
		const authorId = String(catalog.graph.models[modelId]?.authorId ?? '');
		for (const routeId of routeIds(deployment)) {
			const providerId = String(catalog.graph.routes[routeId]?.providerId ?? '');
			chains.push({
				nodeKeys: [
					nodeKey('author', authorId),
					nodeKey('model', modelId),
					nodeKey('deployment', deploymentId),
					nodeKey('route', routeId),
					nodeKey('provider', providerId)
				],
				edgeIds: [
					graphEdgeId('author', authorId, 'model', modelId),
					graphEdgeId('model', modelId, 'deployment', deploymentId),
					graphEdgeId('route', routeId, 'deployment', deploymentId),
					graphEdgeId('provider', providerId, 'route', routeId)
				]
			});
		}
	}
	return chains;
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
	const nearest = indexes.sort((a, b) => Math.abs(a - nextIndex) - Math.abs(b - nextIndex))[0];
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
	for (const key of selectedKeys) {
		const parsed = parseNodeKey(key);
		if (parsed) selectedByType.set(parsed.type, key);
	}
	for (const type of graphChainNodeOrder) {
		if (selectedByType.has(type)) continue;
		const candidates = unique(
			matching
				.map((chain) => chain.nodeKeys.find((key) => parseNodeKey(key)?.type === type) ?? '')
				.filter(Boolean)
		);
		if (candidates.length === 1) selectedByType.set(type, candidates[0]);
	}
	return graphChainNodeOrder.map((type) => selectedByType.get(type)).filter(Boolean) as string[];
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
			source('model', selected.id, model)
		];
	}
	return [
		source(
			selected.type,
			selected.id,
			catalog.graph[`${selected.type}s` as keyof CatalogGraph][selected.id] ?? {}
		)
	];
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
	if (deploymentRouteIds.length > 1 && !deploymentRouteIds.includes(preferredRouteId)) return [];
	const routeId = preferredRouteId || deploymentRouteIds[0] || '';
	const route = catalog.graph.routes[routeId] ?? {};
	const providerId = String(route.providerId ?? '');
	const provider = catalog.graph.providers[providerId] ?? {};

	return flattenFacts(deployment)
		.map(({ path, value }) => ({
			path: path.join('.'),
			value,
			origin: factOrigin({
				catalog,
				deploymentId,
				deploymentRouteIds,
				model,
				modelId,
				path,
				provider,
				providerId,
				route,
				routeId,
				value
			})
		}))
		.filter(
			(fact) =>
				fact.origin.type !== 'route' || fact.origin.id === routeId || fact.path === 'routeIds'
		)
		.sort((left, right) => left.path.localeCompare(right.path));
}

function factOrigin(input: {
	catalog: Catalog;
	deploymentId: string;
	deploymentRouteIds: string[];
	model: Record<string, unknown>;
	modelId: string;
	path: string[];
	provider: Record<string, unknown>;
	providerId: string;
	route: Record<string, unknown>;
	routeId: string;
	value: unknown;
}): EffectiveFact['origin'] {
	const deploymentOrigin = { type: 'deployment' as const, id: input.deploymentId };
	const modelOrigin = { type: 'model' as const, id: input.modelId };
	const [root, ...rest] = input.path;
	if (!root) return deploymentOrigin;

	if (
		[
			'contextWindowTokens',
			'deprecationDate',
			'inputModalities',
			'maxOutputTokens',
			'outputModalities',
			'reasoningEfforts'
		].includes(root)
	) {
		return sameValue(input.value, valueAt(input.model, input.path))
			? modelOrigin
			: deploymentOrigin;
	}

	if (root === 'capabilities') {
		const modelCapabilities = objectAt(input.model, ['capabilities']);
		const routeCapabilities = objectAt(input.route, ['capabilities']);
		const capability = rest[0] ?? '';
		const modelOwnsCapability = Object.prototype.hasOwnProperty.call(modelCapabilities, capability);
		const expected = modelOwnsCapability
			? valueAt(modelCapabilities, rest)
			: valueAt(routeCapabilities, rest);
		if (!sameValue(input.value, expected)) return deploymentOrigin;
		if (modelOwnsCapability) return modelOrigin;
		return routeFactOrigin(input, input.path);
	}

	if (root === 'dataHandling' || root === 'moderated' || root === 'tee') {
		if (!sameValue(input.value, valueAt(input.route, input.path))) return deploymentOrigin;
		return routeFactOrigin(input, input.path);
	}

	if (root === 'pricing') {
		const candidateRouteIds = [
			input.routeId,
			...input.deploymentRouteIds.filter((candidate) => candidate !== input.routeId)
		];
		for (const candidateRouteId of candidateRouteIds) {
			const candidateRoute = input.catalog.graph.routes[candidateRouteId] ?? {};
			const candidateValue = valueAt(candidateRoute, input.path);
			if (candidateValue !== undefined && sameValue(input.value, candidateValue)) {
				return { type: 'route', id: candidateRouteId };
			}
		}
	}

	return deploymentOrigin;
}

function routeFactOrigin(
	input: {
		provider: Record<string, unknown>;
		providerId: string;
		routeId: string;
		value: unknown;
	},
	path: string[]
): EffectiveFact['origin'] {
	if (sameValue(input.value, valueAt(input.provider, path))) {
		return { type: 'provider', id: input.providerId };
	}
	return { type: 'route', id: input.routeId };
}

function flattenFacts(value: Record<string, unknown>, prefix: string[] = []) {
	const facts: { path: string[]; value: unknown }[] = [];
	for (const [key, child] of Object.entries(value)) {
		const path = [...prefix, key];
		if (child && typeof child === 'object' && !Array.isArray(child)) {
			const nested = flattenFacts(child as Record<string, unknown>, path);
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
		if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function objectAt(value: Record<string, unknown>, path: string[]) {
	const result = valueAt(value, path);
	return result && typeof result === 'object' && !Array.isArray(result)
		? (result as Record<string, unknown>)
		: {};
}

function sameValue(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function deploymentLineage(catalog: Catalog, deploymentId: string, preferredRouteId?: string) {
	const deployment = catalog.graph.deployments[deploymentId];
	if (!deployment) return [];
	const modelId = String(deployment.modelId);
	const model = catalog.graph.models[modelId];
	const authorId = String(model?.authorId ?? '');
	const routeId = preferredRouteId || routeIds(deployment)[0];
	const route = catalog.graph.routes[routeId];
	const providerId = String(route?.providerId ?? '');
	return [
		source('author', authorId, catalog.graph.authors[authorId]),
		source('model', modelId, model),
		source('deployment', deploymentId, deployment),
		source('route', routeId, route),
		source('provider', providerId, catalog.graph.providers[providerId])
	].filter((item) => item.id && item.value) as LineageNode[];
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
