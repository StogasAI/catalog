import { describe, expect, test } from 'bun:test';
import { catalog } from './generated-catalog';
import reviewSources from '../source/review-sources.json';

const allowedDomains = new Set([
	'ai.google.dev',
	'api.chutes.ai',
	'azure.microsoft.com',
	'chutes.ai',
	'cloud.google.com',
	'dev.meta.ai',
	'developers.openai.com',
	'docs.aws.amazon.com',
	'docs.cloud.google.com',
	'docs.mistral.ai',
	'docs.x.ai',
	'github.com',
	'huggingface.co',
	'learn.microsoft.com',
	'llm.chutes.ai',
	'prices.azure.com',
	'pricing.us-east-1.amazonaws.com',
	'platform.claude.com',
	'platform.kimi.ai',
	'www.alibabacloud.com',
	'x.ai'
]);

function validDate(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

describe('catalog review sources', () => {
	test('covers every factual owner with primary sources', () => {
		expect(Object.keys(reviewSources.authors).sort()).toEqual(
			Object.keys(catalog.graph.authors).sort()
		);
		expect(Object.keys(reviewSources.providers).sort()).toEqual(
			Object.keys(catalog.graph.providers).sort()
		);
		expect(validDate(reviewSources.reviewedAt)).toBe(true);
	});

	test('uses unique, canonical HTTPS URLs on approved primary domains', () => {
		for (const [owner, sources] of Object.entries({
			...reviewSources.authors,
			...Object.fromEntries(
				Object.entries(reviewSources.providers).map(([id, values]) => [`provider:${id}`, values])
			)
		})) {
			expect(sources.length, owner).toBeGreaterThan(0);
			expect(new Set(sources).size, owner).toBe(sources.length);
			for (const source of sources) {
				const url = new URL(source);
				expect(url.protocol, `${owner}: ${source}`).toBe('https:');
				expect(allowedDomains.has(url.hostname), `${owner}: ${source}`).toBe(true);
				expect(url.username, `${owner}: ${source}`).toBe('');
				expect(url.password, `${owner}: ${source}`).toBe('');
				expect(url.search, `${owner}: ${source}`).toBe('');
				expect(url.hash, `${owner}: ${source}`).toBe('');
			}
		}
	});
});
