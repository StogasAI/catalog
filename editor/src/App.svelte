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
		completeUnambiguousGraphSelection,
		decorateFlow,
		effectiveDeploymentFacts,
		effectiveDeploymentValue,
		extendGraphSelection,
		filterFlow,
		GRAPH_PAGE_SIZE,
		indexGraphPaths,
		lineageForSelection,
		nodeKey,
		pageGraph,
		parseNodeKey
	} from './catalog';
	import { readBoundedResponseText } from './http';
	import { parseCatalog, type LineageNode, type NodeType, type SourcePayload } from './types';

	const catalog = parseCatalog(catalogJson);
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
	let graphPageNumber = $state(0);
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
	const graphIndex = indexGraphPaths(catalog);
	const graphChains = graphIndex.paths;
	const graphPage = $derived(
		pageGraph(catalog, graphIndex, {
			page: graphPageNumber,
			query: nodeFilter,
			visibleTypes: visibleNodeTypes,
			selectedKeys: compatibleOnly ? selectedGraphKeys : []
		})
	);
	const flow = $derived(graphPage.flow);
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
	const effectiveValue = $derived(
		effectiveDeploymentValue(catalog, contextDeploymentId, contextRouteId)
	);
	const effectiveJSON = $derived(effectiveValue ? JSON.stringify(effectiveValue, null, 2) : '');
	const effectiveRouteRequired = $derived(
		contextDeploymentId !== '' &&
			!contextRouteId &&
			Array.isArray(catalog.graph.deployments[contextDeploymentId]?.routeIds) &&
			catalog.graph.deployments[contextDeploymentId].routeIds.length > 1
	);
	const decoratedFlow = $derived(
		decorateFlow(flow, selectedKey, selectedEdgeId, selectedGraphKeys, graphChains)
	);
	const filteredFlow = $derived(filterFlow(decoratedFlow, visibleNodeTypes, ''));
	const visiblePageKey = $derived(filteredFlow.nodes.map((node) => node.id).join('|'));
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
		requestJson('api/catalog/sources')
			.then((payload) => {
				sources = parseSourcePayload(payload);
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
		if (compatibleOnly) graphPageNumber = 0;
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
		if (compatibleOnly) graphPageNumber = 0;
	}

	function selectEdge(event: CustomEvent<{ edge: Edge }> | { edge: Edge }) {
		const edge = 'detail' in event ? event.detail.edge : event.edge;
		selectedEdgeId = String(edge.id);
	}

	function toggleNodeType(type: NodeType) {
		visibleNodeTypes = { ...visibleNodeTypes, [type]: !visibleNodeTypes[type] };
		graphPageNumber = 0;
	}

	function toggleCompatibleOnly() {
		compatibleOnly = !compatibleOnly;
		graphPageNumber = 0;
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
			const payload = parseBuildResult(await requestJson('api/catalog/build', { method: 'POST' }));
			buildStatus = payload.ok ? 'Build passed' : payload.output;
		} catch (error) {
			buildStatus = error instanceof Error ? error.message : String(error);
		}
	}

	async function saveSource() {
		if (!activePath) return;
		const savedPath = activePath;
		const savedContent = draft;
		sourceStatus = 'Saving...';
		try {
			await requestJson('api/catalog/source', {
				body: JSON.stringify({ path: savedPath, content: savedContent }),
				headers: { 'content-type': 'application/json' },
				method: 'PUT'
			});
			if (sources) {
				sources = {
					...sources,
					files: sources.files.map((file) =>
						file.path === savedPath ? { ...file, content: savedContent } : file
					)
				};
			}
			if (activePath === savedPath) sourceStatus = 'Saved';
		} catch (error) {
			sourceStatus = error instanceof Error ? error.message : String(error);
		}
	}

	async function requestJson(input: string, init: RequestInit = {}): Promise<unknown> {
		const response = await fetch(input, {
			...init,
			redirect: 'error',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		const text = await readBoundedResponseText(response, MAX_API_RESPONSE_BYTES);
		if (!response.ok) {
			let message = text;
			try {
				const payload: unknown = JSON.parse(text);
				if (isRecord(payload) && typeof payload.error === 'string') message = payload.error;
			} catch {
				// Preserve the response text when the server did not return JSON.
			}
			throw new Error(message || `Request failed with HTTP ${response.status}`);
		}
		try {
			const value: unknown = JSON.parse(text);
			return value;
		} catch {
			throw new Error('Catalog editor API returned invalid JSON');
		}
	}

	function parseSourcePayload(value: unknown): SourcePayload {
		if (!isRecord(value) || !Array.isArray(value.files) || !isRecord(value.nodeSources)) {
			throw new Error('Catalog editor API returned invalid source data');
		}
		const files = value.files.map((file) => {
			if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
				throw new Error('Catalog editor API returned invalid source data');
			}
			return { content: file.content, path: file.path };
		});
		const nodeSources: Record<string, string[]> = {};
		for (const [key, paths] of Object.entries(value.nodeSources)) {
			if (
				!Array.isArray(paths) ||
				!paths.every((path): path is string => typeof path === 'string')
			) {
				throw new Error('Catalog editor API returned invalid source data');
			}
			nodeSources[key] = paths;
		}
		return { files, nodeSources };
	}

	function parseBuildResult(value: unknown): { ok: boolean; output: string } {
		if (!isRecord(value) || typeof value.ok !== 'boolean' || typeof value.output !== 'string') {
			throw new Error('Catalog editor API returned an invalid build result');
		}
		return { ok: value.ok, output: value.output };
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
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
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = inspectorWidth;
		const move = (moveEvent: PointerEvent) => {
			inspectorWidth = Math.max(360, Math.min(840, startWidth - (moveEvent.clientX - startX)));
		};
		const stop = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
		window.addEventListener('pointercancel', stop);
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
			<input
				type="search"
				name="catalog-search"
				bind:value={nodeFilter}
				oninput={() => (graphPageNumber = 0)}
				placeholder="Search names, aliases, or IDs…"
				aria-label="Search catalog"
				autocomplete="off"
				spellcheck={false}
			/>
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
			{#if !graphPage.total}
				<p class="graph-empty" role="status">No matching catalog paths.</p>
			{:else}
				{#key visiblePageKey}
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
						onlyRenderVisibleElements
						colorMode={uiTheme}
						{...flowEvents}
					>
						<Controls />
						<MiniMap pannable zoomable nodeStrokeWidth={3} />
						<Background variant={BackgroundVariant.Lines} />
					</SvelteFlow>
				{/key}
			{/if}
		</div>
		<nav class="graph-pagination" aria-label="Catalog graph pages">
			<span aria-live="polite">
				{graphPage.total ? graphPage.page * GRAPH_PAGE_SIZE + 1 : 0}–{Math.min(
					(graphPage.page + 1) * GRAPH_PAGE_SIZE,
					graphPage.total
				)} of {graphPage.total} paths
			</span>
			<button
				type="button"
				disabled={graphPage.page === 0}
				onclick={() => (graphPageNumber = graphPage.page - 1)}>Previous</button
			>
			<span>Page {graphPage.page + 1} of {graphPage.pageCount}</span>
			<button
				type="button"
				disabled={graphPage.page + 1 === graphPage.pageCount}
				onclick={() => (graphPageNumber = graphPage.page + 1)}>Next</button
			>
		</nav>
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
					<strong
						>{visibleLineage.length ? `${visibleLineage.length} nodes` : 'No selection'}</strong
					>
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
								: `${effectiveFacts.length} resolved attributes`}</strong
						>
					</div>
				</div>
				{#if effectiveRouteRequired}
					<p class="empty">Select a compatible route in the graph.</p>
				{:else}
					<pre class="effective-json"><code>{effectiveJSON}</code></pre>
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
