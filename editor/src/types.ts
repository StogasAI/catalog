import type { Edge, Node } from '@xyflow/svelte';
import { orderModelGroups, type ModelGroup } from '../../source/scripts/model-groups.mjs';
import { PUBLIC_CATALOG_SCHEMA } from '../../source/scripts/public-catalog.mjs';

export type NodeType = 'author' | 'group' | 'model' | 'provider' | 'route' | 'deployment';

export type CatalogGraph = {
	authors: Record<string, Record<string, unknown>>;
	groups: Record<string, ModelGroup>;
	models: Record<string, Record<string, unknown>>;
	providers: Record<string, Record<string, unknown>>;
	routes: Record<string, Record<string, unknown>>;
	deployments: Record<string, Record<string, unknown>>;
};

// The editor shows the base graph of the whole catalog, its root with every part; each node's
// dated periods appear in its source.
export type Catalog = {
	schema: typeof PUBLIC_CATALOG_SCHEMA;
	graph: CatalogGraph;
};

export function parseCatalog(value: unknown): Catalog {
	if (!isObject(value) || value.schema !== PUBLIC_CATALOG_SCHEMA || !isObject(value.graph)) {
		throw new TypeError('The generated public catalog is invalid.');
	}
	const graph = value.graph;
	const groups = parseGroupEntries(graph.groups);
	orderModelGroups(groups);
	return {
		schema: value.schema,
		graph: {
			authors: parseCatalogCollection(graph.authors, 'authors'),
			groups,
			deployments: parseCatalogCollection(graph.deployments, 'deployments'),
			models: parseCatalogCollection(graph.models, 'models'),
			providers: parseCatalogCollection(graph.providers, 'providers'),
			routes: parseCatalogCollection(graph.routes, 'routes')
		}
	};
}

function parseGroupEntries(value: unknown): Record<string, ModelGroup> {
	const groups = parseCatalogCollection(value, 'groups');
	const result: Record<string, ModelGroup> = {};
	for (const [id, group] of Object.entries(groups)) {
		if (
			typeof group.authorId !== 'string' ||
			typeof group.name !== 'string' ||
			!Array.isArray(group.parentIds) ||
			group.parentIds.some((parent) => typeof parent !== 'string')
		) {
			throw new TypeError(`The generated catalog group ${id} is invalid.`);
		}
		result[id] = { authorId: group.authorId, name: group.name, parentIds: group.parentIds };
	}
	return result;
}

function parseCatalogCollection(
	value: unknown,
	name: keyof CatalogGraph
): Record<string, Record<string, unknown>> {
	if (!isObject(value)) throw new TypeError(`The generated catalog ${name} collection is invalid.`);

	const entries: Array<[string, Record<string, unknown>]> = [];
	for (const [id, entry] of Object.entries(value)) {
		if (!isObject(entry)) {
			throw new TypeError(`The generated catalog ${name}.${id} entry is invalid.`);
		}
		entries.push([id, entry]);
	}
	return Object.fromEntries(entries);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type GraphNodeData = {
	label: string;
	type: NodeType;
	id: string;
	subtitle?: string;
	handles?: {
		leftIn?: boolean;
		leftOut?: boolean;
		rightIn?: boolean;
		rightOut?: boolean;
	};
};

export type LineageNode = {
	type: NodeType;
	id: string;
	value: Record<string, unknown>;
};

export type CatalogFlow = {
	nodes: Node<GraphNodeData>[];
	edges: Edge[];
};

export type GraphChain = {
	edgeIds: string[];
	nodeKeys: string[];
};

type SourceFile = {
	path: string;
	content: string;
};

export type SourcePayload = {
	files: SourceFile[];
	nodeSources: Record<string, string[]>;
};
