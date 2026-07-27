import { describe, expect, test } from 'bun:test';
import publicCatalog from '../generated/catalog.public.json';
import runtimeCatalog from '../generated/catalog.runtime.json';

const graphNodeTypes = ['authors', 'models', 'providers', 'routes', 'deployments'] as const;
const moderationActors = new Set(['provider', 'stogas', 'both', 'none', 'unknown']);
const canonicalEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

describe('compiled catalog v2', () => {
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
			for (const routeId of deployment.routeIds) {
				expect(runtimeCatalog.graph.routes[routeId]).toBeDefined();
			}
			if (deployment.modelSelection.mode === 'fixed') {
				expect(deployment.modelSelection.modelId).toBe(deployment.modelId);
			}
		}
	});

	test('keeps aliases explicit, deployment-bound, and unique', () => {
		expect(Object.keys(runtimeCatalog.aliases).length).toBe(36);
		for (const [alias, record] of Object.entries(runtimeCatalog.aliases)) {
			expect(alias).not.toContain('/');
			expect(runtimeCatalog.graph.deployments[record.deploymentId]).toBeDefined();
			expect(['fixed', 'moving']).toContain(record.binding);
			expect(['canonical', 'compatibility']).toContain(record.purpose);
		}
	});

	test('materializes effective admission, billing, privacy, and moderation facts', () => {
		for (const deployment of Object.values(runtimeCatalog.graph.deployments)) {
			expect(deployment.limits.contextTokens).toBeGreaterThan(0);
			expect(deployment.limits.outputTokens).toBeGreaterThan(0);
			for (const effort of deployment.reasoning.acceptedEfforts) {
				expect(canonicalEfforts.has(effort)).toBe(true);
			}
			expect(moderationActors.has(deployment.moderation.input)).toBe(true);
			expect(moderationActors.has(deployment.moderation.output)).toBe(true);
			expect(deployment.dataHandling).toHaveProperty('processing.guarantee');
			expect(deployment.dataHandling).toHaveProperty('storage.guarantee');
			expect(deployment.dataHandling).not.toHaveProperty('gdpr');
		}
	});

	test('models Anthropic speed and processing geography as deployment facts', () => {
		const deployment = runtimeCatalog.graph.deployments['claude-opus-4-8-fast-us'];
		expect(deployment.routeIds).toEqual(['anthropic-messages']);
		expect(deployment.speed).toBe('fast');
		expect(deployment.processingRegionId).toBe('us');
		expect(deployment.dataHandling.processing).toEqual({
			guarantee: 'required',
			regionIds: ['us']
		});
	});

	test('keeps deterministic runtime and public artifacts within defensive limits', () => {
		expect(Bun.file('generated/catalog.runtime.json').size).toBeLessThanOrEqual(16 * 1024 * 1024);
		expect(Bun.file('generated/catalog.public.json').size).toBeLessThanOrEqual(64 * 1024 * 1024);
		expect(runtimeCatalog.schema).toBe('stogas.catalog.runtime.v2');
		expect(publicCatalog.schema).toBe('stogas.catalog.public.v2');
	});
});
