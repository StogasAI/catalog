import { describe, expect, test } from 'bun:test';
import catalogJson from '../generated/catalog.public.json';
import {
	buildFlow,
	effectiveDeploymentFacts,
	effectiveDeploymentValue,
	parseNodeKey
} from '../editor/src/catalog';
import { readBoundedResponseText } from '../editor/src/http';
import { parseCatalog } from '../editor/src/types';

const catalog = parseCatalog(catalogJson);

describe('effective catalog facts', () => {
	test('rejects malformed generated catalog collections', () => {
		expect(() => parseCatalog({ graph: {}, schema: 'stogas.catalog.public.v2' })).toThrow(
			'authors collection'
		);
		expect(() =>
			parseCatalog({
				graph: { authors: [], deployments: {}, models: {}, providers: {}, routes: {} },
				schema: 'stogas.catalog.public.v2'
			})
		).toThrow('authors collection');
	});

	test('rejects incomplete graph node keys', () => {
		expect(parseNodeKey('model:')).toBeNull();
		expect(parseNodeKey('unknown:model')).toBeNull();
		expect(parseNodeKey('model:gpt:variant')).toEqual({ type: 'model', id: 'gpt:variant' });
	});

	test('cancels oversized editor API responses', async () => {
		let cancelled = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				}
			}),
			{ headers: { 'content-length': '9' } }
		);
		await expect(readBoundedResponseText(response, 8)).rejects.toThrow('exceeds');
		expect(cancelled).toBe(true);
	});

	test('keeps every route node visible when routes serve the same deployments', () => {
		const flow = buildFlow(catalog.graph);
		const chat = flow.nodes.find((node) => node.id === 'route:azure-chat-completions');
		const responses = flow.nodes.find((node) => node.id === 'route:azure-responses');

		expect(chat).toBeDefined();
		expect(responses).toBeDefined();
		expect(Math.abs((chat?.position.y ?? 0) - (responses?.position.y ?? 0))).toBeGreaterThanOrEqual(
			92
		);
		const routeYs = flow.nodes
			.filter((node) => node.data.type === 'route')
			.map((node) => node.position.y);
		expect(new Set(routeYs).size).toBe(routeYs.length);
	});

	test('shows the semantic owner of inherited and overridden deployment facts', () => {
		const facts = effectiveDeploymentFacts(catalog, 'chutes-glm-5.2');
		const byPath = new Map(facts.map((fact) => [fact.path, fact]));

		expect(byPath.get('contextWindowTokens')?.origin.type).toBe('model');
		expect(byPath.get('reasoningAvailability')?.origin.type).toBe('model');
		expect(byPath.get('reasoningEfforts')?.origin.type).toBe('model');
		expect(byPath.get('reasoningMaxTokens')?.origin.type).toBe('model');
		expect(byPath.get('dataHandling.endToEndEncrypted')?.origin.type).toBe('route');
		expect(byPath.get('dataHandling.processingLocation')?.origin.type).toBe('provider');
		expect(byPath.get('dataHandling.tee.attestation')?.origin.type).toBe('provider');
		expect(byPath.get('upstream.chuteId')?.origin.type).toBe('deployment');
		expect(byPath.get('upstream.gpuCount')?.origin.type).toBe('deployment');
	});

	test('attributes route-specific tool pricing to the route that owns it', () => {
		const facts = effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol', 'openai-responses');
		const webSearch = facts.find(
			(fact) => fact.path === 'pricing.openai_responses_web_search_calls.per_1k_calls'
		);

		expect(webSearch?.origin).toEqual({ type: 'route', id: 'openai-responses' });
	});

	test('attributes provider-wide tool pricing to the provider that owns it', () => {
		const facts = effectiveDeploymentFacts(
			catalog,
			'anthropic-claude-opus-5',
			'anthropic-messages'
		);
		const webSearch = facts.find(
			(fact) => fact.path === 'pricing.anthropic_web_search_calls.per_1k_calls'
		);

		expect(webSearch?.origin).toEqual({ type: 'provider', id: 'anthropic' });
	});

	test('requires a concrete route and excludes facts from another route', () => {
		expect(effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol')).toEqual([]);

		const chatFacts = effectiveDeploymentFacts(
			catalog,
			'openai-gpt-5.6-sol',
			'openai-chat-completions'
		);
		expect(chatFacts.find((fact) => fact.path === 'reasoningEfforts')?.value).toEqual([
			'low',
			'medium',
			'high',
			'xhigh'
		]);
		expect(
			effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol', 'openai-responses').find(
				(fact) => fact.path === 'reasoningEfforts'
			)?.value
		).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
		expect(
			chatFacts.some(
				(fact) => fact.path === 'pricing.openai_responses_web_search_calls.per_1k_calls'
			)
		).toBe(false);
	});

	test('builds nested resolved JSON for one concrete deployment route', () => {
		const value = effectiveDeploymentValue(
			catalog,
			'openai-gpt-5.6-sol',
			'openai-chat-completions'
		);
		expect(value?.contextWindowTokens).toBe(1_050_000);
		expect((value?.upstream as Record<string, unknown>)?.model).toBe('gpt-5.6-sol');
		const pricing = value?.pricing as Record<string, unknown>;
		expect(pricing.openai_responses_web_search_calls).toBeUndefined();
	});
});
