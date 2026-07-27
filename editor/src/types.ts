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

export type SourceFile = {
	path: string;
	content: string;
};

export type SourcePayload = {
	files: SourceFile[];
	nodeSources: Record<string, string[]>;
};
