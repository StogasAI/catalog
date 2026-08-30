import type { Edge, Node } from '@xyflow/svelte';

export type NodeType = 'author' | 'model' | 'provider' | 'route' | 'deployment';

export type CatalogGraph = {
	authors: Record<string, Record<string, unknown>>;
	models: Record<string, Record<string, unknown>>;
	providers: Record<string, Record<string, unknown>>;
	routes: Record<string, Record<string, unknown>>;
	deployments: Record<string, Record<string, unknown>>;
};

export type Catalog = {
	schema: 'stogas.catalog.public.v3';
	graph: CatalogGraph;
};

export function parseCatalog(value: unknown): Catalog {
	if (!isObject(value) || value.schema !== 'stogas.catalog.public.v3' || !isObject(value.graph)) {
		throw new TypeError('The generated public catalog is invalid.');
	}

	return {
		schema: value.schema,
		graph: {
			authors: parseCatalogCollection(value.graph.authors, 'authors'),
			deployments: parseCatalogCollection(value.graph.deployments, 'deployments'),
			models: parseCatalogCollection(value.graph.models, 'models'),
			providers: parseCatalogCollection(value.graph.providers, 'providers'),
			routes: parseCatalogCollection(value.graph.routes, 'routes')
		}
	};
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

export type EffectiveFact = {
	origin: {
		type: NodeType;
		id: string;
	};
	path: string;
	value: unknown;
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
