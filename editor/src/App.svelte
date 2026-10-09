<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MiniMap,
		SvelteFlow,
		type Edge,
		type NodeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { MediaQuery, SvelteSet } from 'svelte/reactivity';
	import catalogJson from '../../generated/catalog.public.json';
	import { mergeCatalogArchive } from '../../source/scripts/catalog-archive.mjs';
	import CatalogNode from './CatalogNode.svelte';
	import PanelResizer from './PanelResizer.svelte';
	import SourceEditor from './SourceEditor.svelte';
	import { setNodeSelection } from './node-selection';
	import { isRecord, requestJson, REQUEST_TIMEOUT_MS } from './api';
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

	const activeCatalog = parseCatalog(catalogJson);
	const archiveAssets = import.meta.glob('../../generated/blobs/sha256/*.json', {
		query: '?url',
		import: 'default',
		eager: true
	}) as Record<string, string>;
	let archiveCatalog = $state<ReturnType<typeof parseCatalog> | null>(null);
	let includeRetired = $state(false);
	let archiveStatus = $state('');
	const catalog = $derived(includeRetired && archiveCatalog ? archiveCatalog : activeCatalog);
	const nodeTypes: NodeTypes = { catalog: CatalogNode };
	const compact = new MediaQuery('(max-width: 640px)');
	setNodeSelection(selectGraphNode);
	const nodeTypeOptions: NodeType[] = [
		'author',
		'group',
		'model',
		'deployment',
		'route',
		'provider'
	];
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
		group: true,
		model: true,
		provider: true,
		route: true,
		deployment: true
	});
	let inspectorWidth = $state(500);
	let sources = $state<SourcePayload | null>(null);
	let sourceStatus = $state('');
	let buildStatus = $state('');
	let building = $state(false);
	let buildFailed = $state(false);

	const selected = $derived(parseNodeKey(selectedKey));
	const graphIndex = $derived(indexGraphPaths(catalog));
	const graphChains = $derived(graphIndex.paths);
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
	const deploymentRoutes = $derived(catalog.graph.deployments[contextDeploymentId]?.routeIds);
	const effectiveRouteRequired = $derived(
		contextDeploymentId !== '' &&
			!contextRouteId &&
			Array.isArray(deploymentRoutes) &&
			deploymentRoutes.length > 1
	);
	const decoratedFlow = $derived(
		decorateFlow(flow, selectedKey, selectedEdgeId, selectedGraphKeys, graphChains)
	);
	const filteredFlow = $derived(filterFlow(decoratedFlow, visibleNodeTypes, ''));
	const editorNodes = $derived(
		filteredFlow.nodes.map((node) => ({
			...node,
			ariaRole: 'group' as const,
			data: {
				...node.data,
				current: node.id === selectedKey
			}
		}))
	);
	const visiblePageKey = $derived(filteredFlow.nodes.map((node) => node.id).join('|'));
	const sourcePaths = $derived(sources?.nodeSources[selectedKey] ?? []);
	const flowEvents = {
		onedgeclick: selectEdge,
		onpaneclick: clearSelection
	};

	$effect(() => {
		if (themeLoaded) return;
		try {
			const stored = localStorage.getItem('catalog-editor-theme');
			if (stored === 'dark' || stored === 'light') uiTheme = stored;
		} catch {
			// Theme changes remain available when browser storage is disabled.
		}
		themeLoaded = true;
	});

	$effect(() => {
		if (!themeLoaded) return;
		document.documentElement.dataset.theme = uiTheme;
		try {
			localStorage.setItem('catalog-editor-theme', uiTheme);
		} catch {
			// Retain the current in-memory preference.
		}
	});

	$effect(() => {
		const controller = new AbortController();
		requestJson('api/catalog/sources', { signal: controller.signal })
			.then((payload) => {
				sources = parseSourcePayload(payload);
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					sourceStatus = error instanceof Error ? error.message : String(error);
			});
		return () => controller.abort();
	});

	$effect(() => {
		if (!includeRetired || archiveCatalog || !activeCatalog.archive) return;
		const controller = new AbortController();
		const reference = activeCatalog.archive;
		const url = archiveAssets[`../../generated/blobs/sha256/${reference.sha256}.json`];
		archiveStatus = 'Loading retired nodes…';
		void (async () => {
			try {
				if (!url) throw new Error('Retired catalog is unavailable.');
				const response = await fetch(url, {
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
					redirect: 'error'
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error('Retired catalog is unavailable.');
				}
				const body = await readBoundedResponseText(response, reference.size_bytes);
				const bytes = new TextEncoder().encode(body);
				const digest = Array.from(
					new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
					(byte) => byte.toString(16).padStart(2, '0')
				).join('');
				if (bytes.byteLength !== reference.size_bytes || digest !== reference.sha256)
					throw new Error('Retired catalog digest differs.');
				if (controller.signal.aborted) return;
				archiveCatalog = parseCatalog(mergeCatalogArchive(activeCatalog, JSON.parse(body)));
				archiveStatus = '';
			} catch (error) {
				if (!controller.signal.aborted)
					archiveStatus = error instanceof Error ? error.message : String(error);
			}
		})();
		return () => controller.abort();
	});

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
		const parsed = keys.map(parseNodeKey).filter((node) => node !== null);
		contextDeploymentId = parsed.find((node) => node.type === 'deployment')?.id ?? '';
		contextRouteId = parsed.find((node) => node.type === 'route')?.id ?? '';
	}

	async function buildCatalog() {
		if (building) return;
		building = true;
		buildFailed = false;
		buildStatus = 'Building…';
		try {
			const payload = parseBuildResult(await requestJson('api/catalog/build', { method: 'POST' }));
			buildStatus = payload.ok ? 'Build passed' : payload.output;
			buildFailed = !payload.ok;
		} catch (error) {
			buildStatus = error instanceof Error ? error.message : String(error);
			buildFailed = true;
		} finally {
			building = false;
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
				<span data-type="group">group</span>
				<span data-type="model">model</span>
				<span data-type="provider">provider</span>
				<span data-type="route">route</span>
				<span data-type="deployment">deployment</span>
			</div>
			<div class="toolbar-actions">
				<div class="segmented theme-switch" role="group" aria-label="Theme">
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
				<button type="button" onclick={buildCatalog} disabled={building} aria-busy={building}
					>Build</button
				>
			</div>
		</div>
		<div class="graph-filters" aria-label="Graph filters">
			<div class="graph-search">
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
				<label class="node-picker">
					Node on this page
					<select
						value={filteredFlow.nodes.some((node) => node.id === selectedKey) ? selectedKey : ''}
						onchange={(event) => selectGraphNode(event.currentTarget.value)}
					>
						<option value="">Select a node</option>
						{#each filteredFlow.nodes as node (node.id)}<option value={node.id}
								>{node.data.type} · {node.data.label}</option
							>{/each}
					</select>
				</label>
			</div>
			<div class="filter-chips" aria-label="Node type filters">
				<label>
					<input
						type="checkbox"
						bind:checked={includeRetired}
						onchange={() => {
							clearSelection();
							graphPageNumber = 0;
						}}
					/>
					<span>Include retired</span>
				</label>
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
		<div class="graph-status">
			{#if buildStatus}<p
					class="status"
					class:error={buildFailed}
					role={buildFailed ? 'alert' : 'status'}
				>
					{buildStatus}
				</p>{/if}
			{#if includeRetired && archiveStatus}<p class="status" role="status">
					{archiveStatus}
				</p>{/if}
		</div>
		<div class="flow">
			{#if !graphPage.total}
				<p class="graph-empty" role="status">No matching catalog paths.</p>
			{:else}
				{#key visiblePageKey}
					<SvelteFlow
						nodes={editorNodes}
						edges={filteredFlow.edges}
						{nodeTypes}
						fitView
						fitViewOptions={{ padding: 0.13 }}
						minZoom={24 / 40}
						maxZoom={1.8}
						nodesDraggable={false}
						nodesFocusable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						onlyRenderVisibleElements
						colorMode={uiTheme}
						{...flowEvents}
					>
						<Controls />
						<MiniMap
							pannable
							zoomable
							nodeStrokeWidth={3}
							width={compact.current ? 100 : 200}
							height={compact.current ? 75 : 150}
						/>
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

	<PanelResizer bind:value={inspectorWidth} />

	<aside id="catalog-inspector" class="inspector" aria-label="Selected node details">
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

		<SourceEditor {sources} paths={sourcePaths} loadError={sourceStatus} />
	</aside>
</main>
