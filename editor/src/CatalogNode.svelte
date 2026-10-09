<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from './types';
	import { getNodeSelection } from './node-selection';

	let { id, data }: NodeProps & { data: GraphNodeData & { current: boolean } } = $props();
	const selectNode = getNodeSelection();
</script>

{#if data.handles?.leftIn}
	<Handle id="left-in" class="catalog-flow-handle" type="target" position={Position.Left} inert />
{/if}
{#if data.handles?.leftOut}
	<Handle id="left-out" class="catalog-flow-handle" type="source" position={Position.Left} inert />
{/if}

<button
	type="button"
	class="node-card nodrag nopan"
	aria-label={`${data.type} ${data.label}`}
	aria-pressed={data.current}
	onclick={() => selectNode(id)}
>
	<strong>{data.label}</strong>
	{#if data.subtitle}
		<span>{data.subtitle}</span>
	{/if}
</button>

{#if data.handles?.rightIn}
	<Handle id="right-in" class="catalog-flow-handle" type="target" position={Position.Right} inert />
{/if}
{#if data.handles?.rightOut}
	<Handle
		id="right-out"
		class="catalog-flow-handle"
		type="source"
		position={Position.Right}
		inert
	/>
{/if}
