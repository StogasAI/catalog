import { describe, expect, test } from 'bun:test';
import { withArchive } from '../source/scripts/public-catalog.mjs';
import { catalogArchiveReference } from '../source/scripts/release-format.mjs';
import { publicCatalog } from './generated-catalog';

const mib = 1024 * 1024;

describe('public catalog archive', () => {
	const [deploymentId] = Object.keys(publicCatalog.graph.deployments);
	const deployment = publicCatalog.graph.deployments[deploymentId!]!;
	const archive = {
		schema: 'stogas.catalog.archive.v1' as const,
		graph: {
			deployments: { 'retired-deployment': { ...deployment, retirementDate: '2026-01-01' } },
			models: { 'retired-model': publicCatalog.graph.models[deployment.modelId]! }
		}
	};

	test('puts archived records beside the others and leaves the rest of the catalog', () => {
		const whole = withArchive(publicCatalog, archive);
		expect(whole.graph.deployments).toEqual({
			...publicCatalog.graph.deployments,
			...archive.graph.deployments
		});
		expect(whole.graph.models).toEqual({
			...publicCatalog.graph.models,
			...archive.graph.models
		});
		expect({ ...whole, graph: { ...whole.graph, deployments: {}, models: {} } }).toEqual({
			...publicCatalog,
			graph: { ...publicCatalog.graph, deployments: {}, models: {} }
		});
	});

	test('refuses an archive of another schema or that repeats an active record', () => {
		expect(() => withArchive(publicCatalog, { ...archive, schema: 'other' as never })).toThrow(
			'archive is invalid'
		);
		const repeated = structuredClone(archive);
		repeated.graph.deployments = { [deploymentId!]: deployment } as never;
		expect(() => withArchive(publicCatalog, repeated)).toThrow(
			`Archived deployments ${deploymentId} is also active.`
		);
	});

	test('names its archive by SHA-256 and size, or null', () => {
		const named = (value: unknown) => Buffer.from(JSON.stringify({ archive: value }));
		const reference = { sha256: 'a'.repeat(64), size: mib };
		expect(catalogArchiveReference(named(null))).toBeNull();
		expect(catalogArchiveReference(named(reference))).toEqual(reference);
		for (const invalid of [
			undefined,
			{},
			{ ...reference, sha256: 'A'.repeat(64) },
			{ ...reference, sha256: 'a'.repeat(63) },
			{ ...reference, size: 0 },
			{ ...reference, size: 1.5 },
			{ ...reference, size: 32 * mib + 1 },
			{ ...reference, extra: true }
		])
			expect(() => catalogArchiveReference(named(invalid))).toThrow('invalid archive');
	});
});
