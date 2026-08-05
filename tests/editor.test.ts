import { describe, expect, test } from 'bun:test';
import catalogJson from '../generated/catalog.public.json';
import {
	buildFlow,
	effectiveDeploymentFacts,
	effectiveDeploymentValue
} from '../editor/src/catalog';
import type { Catalog } from '../editor/src/types';

const catalog = catalogJson as Catalog;

describe('effective catalog facts', () => {
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
		expect(byPath.get('tee.status')?.origin.type).toBe('deployment');
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

	test('requires a concrete route and excludes facts from another route', () => {
		expect(effectiveDeploymentFacts(catalog, 'openai-gpt-5.6-sol')).toEqual([]);

		const chatFacts = effectiveDeploymentFacts(
			catalog,
			'openai-gpt-5.6-sol',
			'openai-chat-completions'
		);
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
