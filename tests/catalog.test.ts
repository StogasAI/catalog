import { describe, expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';

const graphNodeTypes = ['authors', 'models', 'providers', 'routes', 'deployments'] as const;
const moderationActors = new Set(['provider', 'stogas', 'both', 'none', 'unknown']);
const canonicalEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

describe('compiled catalog v5', () => {
	test('contains exactly the five useful graph primitives', () => {
		expect(Object.keys(publicCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(Object.keys(runtimeCatalog.graph).sort()).toEqual([...graphNodeTypes].sort());
		expect(JSON.stringify(publicCatalog)).not.toMatch(
			/providerOfferings|executionVariants|modelReleases|providerEndpoints|stogasEndpoints/
		);
	});

	test('resolves every graph reference without semantic inference from IDs', () => {
		for (const [modelId, model] of Object.entries(publicCatalog.graph.models)) {
			expect(publicCatalog.graph.authors[model.authorId]).toBeDefined();
			expect(modelId).not.toBe('');
		}
		for (const [routeId, route] of Object.entries(publicCatalog.graph.routes)) {
			expect(publicCatalog.graph.providers[route.providerId]).toBeDefined();
			expect(route.interfaces.length).toBeGreaterThan(0);
			expect(routeId).not.toBe('');
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(runtimeCatalog.graph.models[deployment.modelId]).toBeDefined();
			expect(deployment.routeIds.length).toBeGreaterThan(0);
			expect(deployment.upstream.model).not.toBe('');
			for (const routeId of deployment.routeIds) {
				expect(runtimeCatalog.graph.routes[routeId]).toBeDefined();
			}
		}
	});

	test('keeps aliases inline, selectors explicit, and globally unique', () => {
		const selectors = new Set<string>();
		for (const [modelId, model] of Object.entries(runtimeCatalog.graph.models)) {
			for (const selector of [modelId, ...model.aliases]) {
				expect(selector).not.toContain('/');
				expect(selectors.has(selector)).toBe(false);
				selectors.add(selector);
			}
		}
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			for (const alias of deployment.aliases) {
				expect(alias).not.toContain('/');
				expect(selectors.has(alias)).toBe(false);
				selectors.add(alias);
			}
		}
		for (const deploymentId of Object.keys(runtimeCatalog.graph.deployments)) {
			expect(selectors.has(deploymentId)).toBe(false);
			selectors.add(deploymentId);
		}
		expect(selectors.size).toBeGreaterThan(50);
		expect(runtimeCatalog).not.toHaveProperty('aliases');
		expect(runtimeCatalog.graph.authors.openai.aliases).toEqual(['open-ai']);
		expect(runtimeCatalog.graph.providers.openai.aliases).toEqual(['open-ai']);
	});

	test('uses one nullable provider retirement date and keeps history deterministic', () => {
		expect(publicCatalog.graph.deployments['gpt-4o-search-preview-standard']).toMatchObject({
			retirementDate: '2026-07-23'
		});
		expect(runtimeCatalog.graph.deployments['gpt-4o-search-preview-standard']).toMatchObject({
			retirementDate: '2026-07-23'
		});
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment).toHaveProperty('retirementDate');
			expect(deployment).not.toHaveProperty('status');
			expect(deployment).not.toHaveProperty('deprecatedAt');
			expect(deployment).not.toHaveProperty('retiredAt');
		}
	});

	test('materializes one default deployment for every model and route', () => {
		for (const [routeId] of Object.entries(runtimeCatalog.graph.routes)) {
			const deployments = Object.entries(runtimeCatalog.graph.deployments).filter(
				([, deployment]) => deployment.routeIds.includes(routeId)
			);
			for (const modelId of new Set(deployments.map(([, deployment]) => deployment.modelId))) {
				expect(
					deployments.filter(
						([, deployment]) => deployment.modelId === modelId && deployment.default
					)
				).toHaveLength(1);
			}
		}
	});

	test('materializes runtime admission and billing facts', () => {
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment.limits.contextTokens).toBeGreaterThan(0);
			expect(deployment.limits.outputTokens).toBeGreaterThan(0);
			for (const effort of deployment.reasoningEfforts) {
				expect(canonicalEfforts.has(effort)).toBe(true);
			}
			expect(deployment).not.toHaveProperty('dataHandling');
			expect(deployment).not.toHaveProperty('moderation');
		}
	});

	test('materializes public privacy and moderation facts', () => {
		for (const deployment of Object.values(publicCatalog.graph.deployments)) {
			expect(moderationActors.has(deployment.moderation.input)).toBe(true);
			expect(moderationActors.has(deployment.moderation.output)).toBe(true);
			expect(deployment.dataHandling).toHaveProperty('processingRegions');
			expect(deployment.dataHandling).toHaveProperty('storageRegions');
			expect(deployment.dataHandling).not.toHaveProperty('gdpr');
			expect(deployment).not.toHaveProperty('provenance');
		}
		expect(publicCatalog).not.toHaveProperty('evidence');
	});

	test('keeps Anthropic selection literal and its guarantee normalized', () => {
		const deployment = runtimeCatalog.graph.deployments['claude-opus-4-8-fast-us'];
		expect(deployment.routeIds).toEqual(['anthropic-messages']);
		expect(deployment.upstream).toEqual({
			model: 'claude-opus-4-8',
			fixedRequest: {
				inference_geo: 'us',
				service_tier: 'standard_only',
				speed: 'fast'
			}
		});
		expect(
			publicCatalog.graph.deployments['claude-opus-4-8-fast-us'].dataHandling.processingRegions
		).toEqual(['us']);
	});

	test('keeps deterministic runtime and public artifacts within defensive limits', () => {
		expect(Bun.file('generated/catalog.runtime.json').size).toBeLessThanOrEqual(16 * 1024 * 1024);
		expect(Bun.file('generated/catalog.public.json').size).toBeLessThanOrEqual(64 * 1024 * 1024);
		expect(runtimeCatalog.schema).toBe('stogas.catalog.runtime.v5');
		expect(publicCatalog.schema).toBe('stogas.catalog.public.v5');
	});
});
