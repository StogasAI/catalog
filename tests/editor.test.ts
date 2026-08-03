import { describe, expect, test } from 'bun:test';
import catalogJson from '../generated/catalog.public.json';
import { effectiveDeploymentFacts } from '../editor/src/catalog';
import type { Catalog } from '../editor/src/types';

const catalog = catalogJson as Catalog;

describe('effective catalog facts', () => {
	test('shows the semantic owner of inherited and overridden deployment facts', () => {
		const facts = effectiveDeploymentFacts(catalog, 'chutes-glm-5.2');
		const byPath = new Map(facts.map((fact) => [fact.path, fact]));

		expect(byPath.get('contextWindowTokens')?.origin.type).toBe('model');
		expect(byPath.get('reasoningEfforts')?.origin.type).toBe('deployment');
		expect(byPath.get('tee.status')?.origin.type).toBe('route');
		expect(byPath.get('upstream.chuteId')?.origin.type).toBe('deployment');
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
});
