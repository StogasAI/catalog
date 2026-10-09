<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { requestJson } from './api';
	import type { SourcePayload } from './types';

	let {
		sources,
		paths,
		loadError
	}: {
		sources: SourcePayload | null;
		paths: string[];
		loadError: string;
	} = $props();
	let activePath = $state('');
	let saving = $state(false);
	const drafts = new SvelteMap<string, string>();
	const saved = new SvelteMap<string, string>();
	const results = new SvelteMap<string, { message: string; failed: boolean }>();
	const original = $derived(sourceContent(activePath));
	const draft = $derived(drafts.get(activePath) ?? original);
	const dirty = $derived(draft !== original);
	const result = $derived(results.get(activePath));

	$effect(() => {
		if (!paths.includes(activePath)) activePath = paths[0] ?? '';
	});

	function sourceContent(path: string) {
		return saved.get(path) ?? sources?.files.find((file) => file.path === path)?.content ?? '';
	}

	function edit(content: string) {
		drafts.set(activePath, content);
		results.delete(activePath);
	}

	async function save() {
		if (!activePath || saving || !dirty) return;
		const path = activePath;
		const content = draft;
		saving = true;
		results.set(path, { message: 'Saving…', failed: false });
		try {
			await requestJson('api/catalog/source', {
				body: JSON.stringify({ path, content }),
				headers: { 'content-type': 'application/json' },
				method: 'PUT'
			});
			saved.set(path, content);
			if (drafts.get(path) === content) drafts.delete(path);
			results.set(path, { message: 'Saved', failed: false });
		} catch (error) {
			results.set(path, {
				message: error instanceof Error ? error.message : 'Could not save the source. Try again.',
				failed: true
			});
		} finally {
			saving = false;
		}
	}

	function protectDrafts(event: BeforeUnloadEvent) {
		if (!saving && !Array.from(drafts).some(([path, content]) => content !== sourceContent(path)))
			return;
		event.preventDefault();
		event.returnValue = '';
	}
</script>

<svelte:window onbeforeunload={protectDrafts} />

<section class="source-card" aria-label="Raw source file">
	<div class="source-head">
		<div>
			<h3>Source</h3>
			{#if activePath}<span class="source-path">{activePath}</span>{/if}
		</div>
		<button type="button" onclick={save} disabled={!dirty || saving} aria-busy={saving}>Save</button
		>
	</div>
	{#if loadError}
		<p class="status error" role="alert">{loadError}</p>
	{:else if !sources}
		<p class="status" role="status">Loading source files…</p>
	{:else if activePath}
		{#if paths.length > 1}
			<select bind:value={activePath} aria-label="Raw source file">
				{#each paths as path (path)}<option value={path}>{path}</option>{/each}
			</select>
		{/if}
		<textarea
			value={draft}
			oninput={(event) => edit(event.currentTarget.value)}
			spellcheck="false"
			aria-label="Raw catalog source"></textarea>
		{#if result?.failed}
			<p class="status error" role="alert">{result.message}</p>
		{:else}
			<p class="status" role="status">
				{saving && result?.message === 'Saving…'
					? result.message
					: dirty
						? 'Unsaved changes'
						: (result?.message ?? '')}
			</p>
		{/if}
	{:else}
		<p class="empty">Select a node to edit its source.</p>
	{/if}
</section>
