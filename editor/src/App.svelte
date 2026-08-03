<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MiniMap,
		SvelteFlow,
		type Edge,
		type Node,
		type NodeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { SvelteSet } from 'svelte/reactivity';
	import catalogJson from '../../generated/catalog.public.json';
	import CatalogNode from './CatalogNode.svelte';
	import {
		buildFlow,
		completeUnambiguousGraphSelection,
		concreteGraphChains,
		decorateFlow,
		effectiveDeploymentFacts,
		extendGraphSelection,
		filterFlow,
		lineageForSelection,
		nodeKey,
		parseNodeKey
	} from './catalog';
	import { readBoundedResponseText } from './http';
	import type { Catalog, LineageNode, NodeType, SourcePayload } from './types';

	const catalog = catalogJson as Catalog;
	const MAX_API_RESPONSE_BYTES = 8 * 1024 * 1024;
	const REQUEST_TIMEOUT_MS = 30_000;
	const nodeTypes: NodeTypes = { catalog: CatalogNode };
	const nodeTypeOptions: NodeType[] = ['author', 'model', 'deployment', 'route', 'provider'];
	type UiTheme = 'dark' | 'light';

	let selectedKey = $state('');
	let selectedEdgeId = $state('');
	let selectedGraphKeys = $state<string[]>([]);
	let uiTheme = $state<UiTheme>('dark');
	let themeLoaded = $state(false);
	let contextRouteId = $state('');
	let contextDeploymentId = $state('');
	let nodeFilter = $state('');
	let compatibleOnly = $state(false);
	let visibleNodeTypes = $state<Record<NodeType, boolean>>({
		author: true,
		model: true,
		provider: true,
		route: true,
		deployment: true
	});
	let inspectorWidth = $state(500);
	let sources = $state<SourcePayload | null>(null);
	let activePath = $state('');
	let draft = $derived(sourceContent(activePath));
	let sourceStatus = $state('');
	let buildStatus = $state('');

	const selected = $derived(parseNodeKey(selectedKey));
	const flow = $derived(buildFlow(catalog.graph));
	const graphChains = $derived(concreteGraphChains(catalog));
	const lineage = $derived(
		lineageForSelection(catalog, selectedKey, {
			routeId: contextRouteId,
			deploymentId: contextDeploymentId
		})
	);
	const visibleLineage = $derived(dedupedVisibleLineage(lineage));
	const effectiveFacts = $derived(
		effectiveDeploymentFacts(catalog, contextDeploymentId, contextRouteId)
	);
	const effectiveRouteRequired = $derived(
		contextDeploymentId !== '' &&
		!contextRouteId &&
		Array.isArray(catalog.graph.deployments[contextDeploymentId]?.routeIds) &&
		catalog.graph.deployments[contextDeploymentId].routeIds.length > 1
	);
	const decoratedFlow = $derived(
		decorateFlow(flow, selectedKey, selectedEdgeId, selectedGraphKeys, graphChains)
	);
	const filteredFlow = $derived(
		filterFlow(
			decoratedFlow,
			visibleNodeTypes,
			nodeFilter,
			compatibleOnly ? selectedGraphKeys : [],
			graphChains
		)
	);
	const sourcePaths = $derived(sources?.nodeSources[selectedKey] ?? []);
	const flowEvents = {
		onedgeclick: selectEdge,
		onnodeclick: selectNode,
		onpaneclick: clearSelection
	};

	$effect(() => {
		if (themeLoaded) return;
		const stored = globalThis.localStorage?.getItem('catalog-editor-theme');
		if (stored === 'dark' || stored === 'light') uiTheme = stored;
		themeLoaded = true;
	});

	$effect(() => {
		if (!themeLoaded) return;
		globalThis.localStorage?.setItem('catalog-editor-theme', uiTheme);
	});

	$effect(() => {
		requestJson<SourcePayload>('/api/catalog/sources')
			.then((payload: SourcePayload) => {
				sources = payload;
			})
			.catch((error) => {
				sourceStatus = error instanceof Error ? error.message : String(error);
			});
	});

	$effect(() => {
		if (!sourcePaths.includes(activePath)) activePath = sourcePaths[0] ?? '';
	});

	function selectNode(event: { node: Node }) {
		selectGraphNode(event.node.id);
	}

	function selectChainNode(type: NodeType, id: string) {
		const key = nodeKey(type, id);
		if (selectedGraphKeys.includes(key)) {
			setCurrentKey(key);
			return;
		}
		setGraphSelection([key]);
		setCurrentKey(key);
	}

	function setCurrentKey(key: string) {
		selectedKey = key;
		selectedEdgeId = '';
		sourceStatus = '';
		buildStatus = '';
	}

	function replaceSelection(key: string) {
		setGraphSelection([key]);
		setCurrentKey(key);
	}

	function clearSelection() {
		selectedGraphKeys = [];
		contextDeploymentId = '';
		contextRouteId = '';
		setCurrentKey('');
	}

	function selectGraphNode(key: string) {
		const next = parseNodeKey(key);
		if (!next) {
			clearSelection();
			return;
		}
		if (selectedGraphKeys.includes(key)) {
			setCurrentKey(key);
			return;
		}
		const nextSelection = extendGraphSelection(flow, graphChains, selectedGraphKeys, key);
		if (nextSelection) {
			setGraphSelection(nextSelection);
			setCurrentKey(key);
			return;
		}
		replaceSelection(key);
	}

	function setGraphSelection(keys: string[]) {
		selectedGraphKeys = completeUnambiguousGraphSelection(graphChains, keys);
		syncGraphContext(selectedGraphKeys);
	}

	function selectEdge(event: CustomEvent<{ edge: Edge }> | { edge: Edge }) {
		const edge = 'detail' in event ? event.detail.edge : event.edge;
		selectedEdgeId = String(edge.id);
	}

	function toggleNodeType(type: NodeType) {
		visibleNodeTypes = { ...visibleNodeTypes, [type]: !visibleNodeTypes[type] };
	}

	function toggleCompatibleOnly() {
		compatibleOnly = !compatibleOnly;
	}

	function setTheme(theme: UiTheme) {
		uiTheme = theme;
	}

	function syncGraphContext(keys: string[]) {
		const parsed = keys.map(parseNodeKey).filter(Boolean);
		contextDeploymentId = parsed.find((node) => node.type === 'deployment')?.id ?? '';
		contextRouteId = parsed.find((node) => node.type === 'route')?.id ?? '';
	}

	function sourceContent(path: string) {
		return sources?.files.find((file) => file.path === path)?.content ?? '';
	}

	async function buildCatalog() {
		buildStatus = 'Building...';
		try {
			const payload = await requestJson<{ ok: boolean; output: string }>('/api/catalog/build', {
				method: 'POST'
			});
			buildStatus = payload.ok ? 'Build passed' : payload.output;
		} catch (error) {
			buildStatus = error instanceof Error ? error.message : String(error);
		}
	}

	async function saveSource() {
		if (!activePath) return;
		sourceStatus = 'Saving...';
		try {
			await requestJson('/api/catalog/source', {
				body: JSON.stringify({ path: activePath, content: draft }),
				headers: { 'content-type': 'application/json' },
				method: 'PUT'
			});
			if (sources) {
				sources = {
					...sources,
					files: sources.files.map((file) =>
						file.path === activePath ? { ...file, content: draft } : file
					)
				};
			}
			sourceStatus = 'Saved';
		} catch (error) {
			sourceStatus = error instanceof Error ? error.message : String(error);
		}
	}

	async function requestJson<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(input, {
			...init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		const text = await readBoundedResponseText(response, MAX_API_RESPONSE_BYTES);
		if (!response.ok) {
			let message = text;
			try {
				const payload = JSON.parse(text) as { error?: unknown };
				if (typeof payload.error === 'string') message = payload.error;
			} catch {
				// Preserve the response text when the server did not return JSON.
			}
			throw new Error(message || `Request failed with HTTP ${response.status}`);
		}
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error('Catalog editor API returned invalid JSON');
		}
	}

	function attributeLabel(value: string) {
		return value
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replaceAll('_', ' ')
			.toLowerCase();
	}

	function nodeTypeLabel(type: NodeType) {
		return attributeLabel(type);
	}

	function factValue(value: unknown) {
		return typeof value === 'string' ? value : JSON.stringify(value);
	}

	function dedupedVisibleLineage(nodes: LineageNode[]) {
		const seen = new SvelteSet<string>();
		const visible: LineageNode[] = [];
		for (const node of nodes) {
			const key = nodeKey(node.type, node.id);
			if (seen.has(key)) continue;
			seen.add(key);
			visible.push(node);
		}
		return visible;
	}

	function startResize(event: PointerEvent) {
		const startX = event.clientX;
		const startWidth = inspectorWidth;
		const move = (moveEvent: PointerEvent) => {
			inspectorWidth = Math.max(360, Math.min(840, startWidth - (moveEvent.clientX - startX)));
		};
		const stop = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
	}
</script>

<main
	class="shell"
	data-theme={uiTheme}
	style:grid-template-columns={`minmax(0, 1fr) 6px ${inspectorWidth}px`}
>
	<section class="graph-pane" aria-label="Catalog graph">
		<div class="bar">
			<div>
				<h1>Catalog Graph</h1>
				<p>
					{Object.keys(catalog.graph.deployments).length} deployments, {Object.keys(
						catalog.graph.routes
					).length} routes
				</p>
			</div>
			<div class="legend" aria-label="Node type legend">
				<span data-type="author">author</span>
				<span data-type="model">model</span>
				<span data-type="provider">provider</span>
				<span data-type="route">route</span>
				<span data-type="deployment">deployment</span>
			</div>
			<div class="toolbar-actions">
				{#if buildStatus}<p class="bar-status">{buildStatus}</p>{/if}
				<div class="segmented theme-switch" aria-label="Theme">
					<button
						type="button"
						class:active={uiTheme === 'dark'}
						aria-pressed={uiTheme === 'dark'}
						onclick={() => setTheme('dark')}>Dark</button
					>
					<button
						type="button"
						class:active={uiTheme === 'light'}
						aria-pressed={uiTheme === 'light'}
						onclick={() => setTheme('light')}>Light</button
					>
				</div>
				<button type="button" onclick={buildCatalog}>Build</button>
			</div>
		</div>
		<div class="graph-filters" aria-label="Graph filters">
			<input bind:value={nodeFilter} placeholder="Filter nodes" aria-label="Filter nodes" />
			<div class="filter-chips" aria-label="Node type filters">
				<label data-type="compatible">
					<input type="checkbox" checked={compatibleOnly} onchange={toggleCompatibleOnly} />
					<span>Compatible</span>
				</label>
				{#each nodeTypeOptions as type (type)}
					<label data-type={type}>
						<input
							type="checkbox"
							checked={visibleNodeTypes[type]}
							onchange={() => toggleNodeType(type)}
						/>
						<span>{attributeLabel(type)}</span>
					</label>
				{/each}
			</div>
		</div>
		<div class="flow">
			<div class="graph-guide" aria-hidden="true">
				<span>author</span>
				<span>model</span>
				<span>deployment</span>
				<span>route</span>
				<span>provider</span>
			</div>
			<SvelteFlow
				nodes={filteredFlow.nodes}
				edges={filteredFlow.edges}
				{nodeTypes}
				fitView
				fitViewOptions={{ padding: 0.13 }}
				minZoom={0.2}
				maxZoom={1.8}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				colorMode={uiTheme}
				{...flowEvents}
			>
				<Controls />
				<MiniMap pannable zoomable nodeStrokeWidth={3} />
				<Background variant={BackgroundVariant.Lines} />
			</SvelteFlow>
		</div>
	</section>

	<button
		class="splitter"
		type="button"
		aria-label="Resize details panel"
		onpointerdown={startResize}
	></button>

	<aside class="inspector" aria-label="Selected node details">
		<header class="inspector-head">
			<div>
				<span>{selected ? nodeTypeLabel(selected.type) : 'node'}</span>
				<h2>{selected?.id ?? 'Select a node'}</h2>
			</div>
		</header>

		<section class="chain-card" aria-label="Inheritance chain">
			<div class="section-head">
				<div>
					<span>Context</span>
					<strong>{visibleLineage.length ? `${visibleLineage.length} nodes` : 'No selection'}</strong>
				</div>
			</div>
			<div class="chain-row">
				{#each visibleLineage as node (nodeKey(node.type, node.id))}
					<button
						type="button"
						class="chain-node"
						data-type={node.type}
						aria-current={nodeKey(node.type, node.id) === selectedKey ? 'true' : undefined}
						onclick={() => selectChainNode(node.type, node.id)}
					>
						<span>{nodeTypeLabel(node.type)}</span>
						<strong>{node.id}</strong>
					</button>
				{/each}
			</div>
		</section>

		{#if contextDeploymentId}
			<section class="effective-card" aria-label="Effective deployment attributes">
				<div class="section-head">
					<div>
						<span>Effective deployment</span>
						<strong
							>{effectiveRouteRequired
								? 'Select one route'
								: `${effectiveFacts.length} attributes with owners`}</strong
						>
					</div>
				</div>
				{#if effectiveRouteRequired}
					<p class="empty">Select a compatible route in the graph.</p>
				{:else}
					<div class="effective-table">
						{#each effectiveFacts as fact (fact.path)}
							<div class="effective-row">
								<code>{fact.path}</code>
								<output>{factValue(fact.value)}</output>
								<button
									type="button"
									class="origin-badge"
									data-type={fact.origin.type}
									title={`${fact.origin.type}: ${fact.origin.id}`}
									onclick={() => selectChainNode(fact.origin.type, fact.origin.id)}
								>
									{fact.origin.type}
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<section class="source-card" aria-label="Raw source file">
			<div class="source-head">
				<div>
					<span>Raw file</span>
					<strong>{activePath ? 'Source' : 'No source file'}</strong>
				</div>
				<div class="source-actions">
					<button type="button" onclick={saveSource} disabled={!activePath}>Save</button>
				</div>
			</div>
			{#if sourcePaths.length > 1}
				<select bind:value={activePath} aria-label="Raw source file">
					{#each sourcePaths as path (path)}
						<option value={path}>{path}</option>
					{/each}
				</select>
			{/if}
			{#if activePath}
				<textarea bind:value={draft} spellcheck="false" aria-label="Raw catalog source"></textarea>
			{:else}
				<p class="empty">Select a graph node with a source file.</p>
			{/if}
			{#if sourceStatus}<p class="status">{sourceStatus}</p>{/if}
		</section>

	</aside>
</main>
