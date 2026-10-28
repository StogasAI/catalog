import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../source/scripts/canonical-json.mjs';
import {
	assembleCatalogArchive,
	assemblePublicCatalog,
	withArchive,
	type CatalogArchiveIndex,
	type CatalogArchivePart,
	type PublicCatalogPart,
	type PublicCatalogRoot
} from '../source/scripts/public-catalog.mjs';
import {
	PART_MAX_BYTES,
	PART_MIN_BYTES,
	partitionCatalogArchive,
	partitionPublicCatalog
} from '../source/scripts/public-parts.mjs';
import { catalogPublicFiles } from '../source/scripts/release-format.mjs';
import { publicCatalog } from './generated-catalog';

type Catalog = typeof publicCatalog;
const mib = 1024 * 1024;

/** The checkout's catalog with `copies` providers in place of each of its own. */
function scaled(copies: number): Catalog {
	const catalog = structuredClone(publicCatalog);
	const { deployments, providers, routes } = publicCatalog.graph;
	for (let copy = 1; copy < copies; copy++) {
		for (const [id, provider] of Object.entries(providers))
			catalog.graph.providers![`${id}-${copy}`] = provider;
		for (const [id, route] of Object.entries(routes!))
			catalog.graph.routes![`${id}-${copy}`] = {
				...route,
				providerId: `${route.providerId}-${copy}`
			};
		for (const [id, deployment] of Object.entries(deployments!))
			catalog.graph.deployments![`${id}-${copy}`] = {
				...deployment,
				routes: Object.fromEntries(
					Object.entries(deployment.routes).map(([routeId, served]) => [
						`${routeId}-${copy}`,
						served
					])
				)
			};
	}
	return catalog;
}

/** A catalog of `count` deployments of about `bytes` each, spread over 40 providers. */
function synthetic(count: number, bytes = 1500) {
	const providers = 40;
	return {
		graph: {
			deployments: Object.fromEntries(
				Array.from({ length: count }, (_, index) => [
					`deployment-${index}`,
					{
						modelId: 'model',
						retirementDate: null as string | null,
						routes: { [`route-${index % providers}`]: { notes: 'x'.repeat(bytes) } }
					}
				])
			),
			routes: Object.fromEntries(
				Array.from({ length: providers }, (_, index) => [
					`route-${index}`,
					{ providerId: `provider-${index}` }
				])
			)
		},
		schedule: [] as { start: string; graph: { deployments?: Record<string, unknown> } }[],
		periods: []
	};
}

/** The root and parts as their files hold them, with no archive. */
function files({ root, parts }: { root: object; parts: { json: string }[] }) {
	return {
		root: JSON.parse(canonicalJson({ ...root, archive: null })) as PublicCatalogRoot,
		parts: parts.map(({ json }) => JSON.parse(json) as PublicCatalogPart)
	};
}

function digests(catalog: object) {
	return partitionPublicCatalog(catalog).parts.map(({ sha256 }) => sha256);
}

/** `count` archived deployments of about `bytes` each, retiring a day apart, one per model. */
function archived(count: number, bytes = 1500) {
	const day = (index: number) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
	const ids = Array.from({ length: count }, (_, index) => index);
	return {
		deployments: Object.fromEntries(
			ids.map((index) => [
				`deployment-${index}`,
				{
					modelId: `model-${index}`,
					retirementDate: day(index),
					routes: { route: { notes: 'x'.repeat(bytes) } }
				}
			])
		),
		models: Object.fromEntries(
			ids.map((index) => [
				`model-${index}`,
				{ aliases: [`model.${index}`], name: `Model ${index}` }
			])
		)
	};
}

function archiveFiles(archive: object) {
	const { index, parts } = partitionCatalogArchive(archive as never)!;
	return {
		index: JSON.parse(index.json) as CatalogArchiveIndex,
		parts: parts.map(({ json }) => JSON.parse(json) as CatalogArchivePart)
	};
}

describe('public catalog parts', () => {
	test('name each part by the SHA-256 and size of its exact bytes', () => {
		const { root, parts } = partitionPublicCatalog(publicCatalog);
		expect(root.parts).toEqual(parts.map(({ sha256, size }) => ({ sha256, size })));
		for (const part of parts) {
			expect(part.sha256).toBe(createHash('sha256').update(part.json).digest('hex'));
			expect(part.size).toBe(Buffer.byteLength(part.json));
		}
	});

	test('assemble to exactly the whole catalog, in the order of the root, at every scale', () => {
		for (const copies of [1, 10, 30]) {
			const catalog = scaled(copies);
			const partitioned = partitionPublicCatalog(catalog);
			expect(partitioned.parts.every(({ size }) => size <= PART_MAX_BYTES)).toBe(true);
			const { root, parts } = files(partitioned);
			const assembled = assemblePublicCatalog<Catalog>(root, parts);
			expect(canonicalJson(assembled)).toBe(canonicalJson(catalog));
			expect(Object.keys(assembled.graph.deployments!)).toEqual(
				Object.keys(root.graph.deployments)
			);
		}
	});

	test('end at a boundary past their minimum, or before their maximum', () => {
		const sizes = partitionPublicCatalog(synthetic(9000)).parts.map(({ size }) => size);
		expect(sizes.length).toBeGreaterThan(40);
		expect(sizes.slice(0, -1).every((size) => size >= PART_MIN_BYTES)).toBe(true);
		expect(sizes.every((size) => size <= PART_MAX_BYTES)).toBe(true);
		// Records of 100 KB fill five to a part before any boundary.
		const full = partitionPublicCatalog(synthetic(200, 100_000)).parts.map(({ size }) => size);
		expect(full.filter((size) => size > PART_MAX_BYTES - 100_000).length).toBeGreaterThan(30);
		expect(full.every((size) => size <= PART_MAX_BYTES)).toBe(true);
		// A deployment larger than the maximum gets a part of its own.
		const oversized = synthetic(3, 600_000);
		const { parts } = files(partitionPublicCatalog(oversized));
		expect(parts.map((part) => Object.keys(part.deployments).length)).toEqual([1, 1, 1]);
	});

	test('keep each provider in consecutive parts', () => {
		const catalog = synthetic(9000);
		const { parts } = files(partitionPublicCatalog(catalog));
		// A part's file lists deployments by ID, so its providers are sorted here.
		const order = parts.flatMap((part) =>
			[
				...new Set(
					Object.values(part.deployments).map(
						(deployment) => catalog.graph.routes[Object.keys(deployment.routes)[0]!]!.providerId
					)
				)
			].sort()
		);
		const providers = [...new Set(order)];
		expect(providers).toHaveLength(40);
		for (const provider of providers) {
			const run = order.slice(order.indexOf(provider), order.lastIndexOf(provider) + 1);
			expect(run.every((each) => each === provider)).toBe(true);
		}
	});

	test('change only the parts around a changed, added or removed deployment', () => {
		const catalog = synthetic(4500);
		const before = new Set(digests(catalog));
		expect(before.size).toBeGreaterThan(20);
		const edits: ((copy: typeof catalog) => void)[] = [];
		for (let index = 50; index < 4500; index += 450) {
			const id = `deployment-${index}`;
			edits.push((copy) => {
				copy.graph.deployments[id]!.modelId = 'another-model';
			});
			edits.push((copy) => {
				copy.graph.deployments[`${id}-added`] = catalog.graph.deployments[id]!;
			});
			edits.push((copy) => {
				delete copy.graph.deployments[id];
			});
		}
		const changed = edits.map((edit) => {
			const copy = structuredClone(catalog);
			edit(copy);
			return digests(copy).filter((digest) => !before.has(digest)).length;
		});
		expect(Math.min(...changed)).toBe(1);
		expect(Math.max(...changed)).toBeLessThanOrEqual(2);
	}, 60_000);

	test('keep every start in the root and summary changes beside the parts that hold them', () => {
		const catalog = structuredClone(publicCatalog);
		const [retiring, repriced] = Object.keys(catalog.graph.deployments!);
		const retired = { ...catalog.graph.deployments![retiring!]!, retirementDate: '2027-01-01' };
		const discounted = structuredClone(catalog.graph.deployments![repriced!]!);
		const [route] = Object.values(discounted.routes) as { pricing: object }[];
		route!.pricing = {};
		catalog.schedule = [
			{ start: '2026-12-01T00:00:00Z', graph: { deployments: { [repriced!]: discounted } } },
			{ start: '2027-01-01T00:00:00Z', graph: { deployments: { [retiring!]: retired } } },
			{ start: '2027-02-01T00:00:00Z', graph: {} }
		];
		const { root, parts } = files(partitionPublicCatalog(catalog));
		expect(root.schedule).toEqual([
			{ start: '2026-12-01T00:00:00Z', graph: {} },
			{
				start: '2027-01-01T00:00:00Z',
				graph: {
					deployments: {
						[retiring!]: { ...root.graph.deployments[retiring!]!, retirementDate: '2027-01-01' }
					}
				}
			},
			{ start: '2027-02-01T00:00:00Z', graph: {} }
		]);
		expect(parts[root.graph.deployments[repriced!]!.part]!.schedule).toContainEqual({
			start: '2026-12-01T00:00:00Z',
			deployments: { [repriced!]: discounted }
		});
		expect(parts[root.graph.deployments[retiring!]!.part]!.schedule).toContainEqual({
			start: '2027-01-01T00:00:00Z',
			deployments: { [retiring!]: retired }
		});
		expect(canonicalJson(assemblePublicCatalog(root, parts))).toBe(canonicalJson(catalog));
	});

	test('refuse parts that do not match their root', () => {
		const catalog = structuredClone(publicCatalog);
		const [id] = Object.keys(catalog.graph.deployments!);
		catalog.schedule = [
			{
				start: '2027-01-01T00:00:00Z',
				graph: {
					deployments: {
						[id!]: { ...catalog.graph.deployments![id!]!, retirementDate: '2027-01-01' }
					}
				}
			}
		];
		const { root, parts } = files(partitionPublicCatalog(catalog));
		const { part } = root.graph.deployments[id!]!;
		const assembling = (
			change: (copy: { root: PublicCatalogRoot; parts: PublicCatalogPart[] }) => unknown
		) => {
			const copy = structuredClone({ root, parts });
			change(copy);
			return () => assemblePublicCatalog(copy.root, copy.parts);
		};
		expect(assembling(() => {})).not.toThrow();
		expect(assembling((copy) => copy.parts.pop())).toThrow('parts differ from the root');
		expect(assembling((copy) => (copy.root.schema = 'stogas.catalog.public.v7' as never))).toThrow(
			'root is invalid'
		);
		expect(assembling((copy) => (copy.parts[part]!.schema = 'other' as never))).toThrow(
			'part is invalid'
		);
		expect(assembling((copy) => delete copy.parts[part]!.deployments[id!])).toThrow(
			'omit a deployment'
		);
		expect(assembling((copy) => (copy.root.graph.deployments[id!]!.part = part + 1))).toThrow(
			'is not in this part'
		);
		expect(
			assembling((copy) => (copy.parts[part]!.deployments[id!]!.modelId = 'another-model'))
		).toThrow('differs from its summary');
		expect(
			assembling((copy) => (copy.parts[part]!.deployments[id!]!.routes = { another: {} }))
		).toThrow('differs from its summary');
		expect(
			assembling(
				(copy) => (copy.parts[part]!.schedule[0]!.deployments[id!]!.retirementDate = '2027-02-01')
			)
		).toThrow('differs from its summary');
		expect(assembling((copy) => (copy.parts[part]!.schedule = []))).toThrow(
			`Part omits deployment ${id}`
		);
		expect(
			assembling((copy) => (copy.parts[part]!.schedule[0]!.start = '2027-01-02T00:00:00Z'))
		).toThrow('is not in the root');
	});
});

describe('public catalog archive', () => {
	test('is empty until a record moves there', () => {
		expect(partitionCatalogArchive({ deployments: {}, models: {} })).toBeNull();
	});

	test('indexes each record and assembles to exactly the archive', () => {
		const archive = archived(2000);
		const { index, parts } = archiveFiles(archive);
		expect(parts.length).toBeGreaterThan(10);
		expect(index.deployments['deployment-7']).toEqual({
			modelId: 'model-7',
			part: index.deployments['deployment-7']!.part,
			retirementDate: '2026-01-08',
			routeIds: ['route']
		});
		expect(index.models['model-7']).toEqual({
			aliases: ['model.7'],
			part: index.models['model-7']!.part,
			retirementDate: '2026-01-08'
		});
		expect(canonicalJson(assembleCatalogArchive(index, parts))).toBe(canonicalJson(archive));
	});

	test('dates a model by its last deployment and orders parts by retirement day', () => {
		const archive = archived(400);
		archive.deployments['deployment-0-late'] = {
			...archive.deployments['deployment-0']!,
			retirementDate: '2027-06-01'
		};
		const { index } = archiveFiles(archive);
		expect(index.models['model-0']!.retirementDate).toBe('2027-06-01');
		const parts = Object.values(index.deployments).map(({ part }) => part);
		const byDay = Object.values(index.deployments)
			.sort((left, right) => left.retirementDate!.localeCompare(right.retirementDate!))
			.map(({ part }) => part);
		expect(byDay).toEqual([...parts].sort((left, right) => left - right));
	});

	test('keeps every earlier part when a release archives records that retired later', () => {
		const before = archived(3000);
		const after = archived(3600);
		const earlier = new Set(partitionCatalogArchive(before)!.parts.map(({ sha256 }) => sha256));
		const parts = partitionCatalogArchive(after)!.parts.map(({ sha256 }) => sha256);
		const kept = parts.filter((digest) => earlier.has(digest)).length;
		// Only the last part before the new records can change.
		expect(kept).toBeGreaterThanOrEqual(earlier.size - 1);
	});

	test('refuses parts that do not match the index', () => {
		const { index, parts } = archiveFiles(archived(600));
		const { part } = index.deployments['deployment-5']!;
		const assembling = (
			change: (copy: { index: CatalogArchiveIndex; parts: CatalogArchivePart[] }) => unknown
		) => {
			const copy = structuredClone({ index, parts });
			change(copy);
			return () => assembleCatalogArchive(copy.index, copy.parts);
		};
		expect(assembling(() => {})).not.toThrow();
		expect(assembling((copy) => (copy.index.schema = 'other' as never))).toThrow(
			'index is invalid'
		);
		expect(assembling((copy) => (copy.parts[part]!.schema = 'other' as never))).toThrow(
			'part is invalid'
		);
		expect(assembling((copy) => delete copy.parts[part]!.deployments['deployment-5'])).toThrow(
			'omit archived deployments'
		);
		expect(assembling((copy) => copy.parts.pop())).toThrow('omit archived');
		expect(assembling((copy) => (copy.index.deployments['deployment-5']!.part += 1))).toThrow(
			'is not in this part'
		);
		expect(
			assembling(
				(copy) => (copy.parts[part]!.deployments['deployment-5']!.retirementDate = '2028-01-01')
			)
		).toThrow('differs from its summary');
	});

	test('puts archived records beside the others and leaves the rest of the catalog', () => {
		const [deploymentId] = Object.keys(publicCatalog.graph.deployments!);
		const deployment = publicCatalog.graph.deployments![deploymentId!]!;
		const archive = {
			deployments: { 'retired-deployment': { ...deployment, retirementDate: '2026-01-01' } },
			models: { 'retired-model': publicCatalog.graph.models![deployment.modelId]! }
		};
		const whole = withArchive(publicCatalog, archive);
		expect(whole.graph.deployments).toEqual({
			...publicCatalog.graph.deployments,
			...archive.deployments
		});
		expect(whole.graph.models).toEqual({ ...publicCatalog.graph.models, ...archive.models });
		expect({ ...whole, graph: { ...whole.graph, deployments: {}, models: {} } }).toEqual({
			...publicCatalog,
			graph: { ...publicCatalog.graph, deployments: {}, models: {} }
		});
		expect(() =>
			withArchive(publicCatalog, { ...archive, deployments: { [deploymentId!]: deployment } })
		).toThrow(`Archived deployments ${deploymentId} is also active.`);
	});
});

describe('public catalog limits', () => {
	const file = (sha256 = 'a'.repeat(64), size = 1) => ({ sha256, size });
	const root = (parts: unknown, archive: unknown = null) =>
		Buffer.from(JSON.stringify({ archive, parts }));

	test('list every file that a root names, and refuse an invalid one', () => {
		const parts = [file(), file('b'.repeat(64), mib / 2)];
		const archive = { index: file('c'.repeat(64), 4 * mib), parts: [file('d'.repeat(64))] };
		expect(catalogPublicFiles(root(parts))).toEqual(parts);
		expect(catalogPublicFiles(root([]))).toEqual([]);
		expect(catalogPublicFiles(root(parts, archive))).toEqual([
			...parts,
			archive.index,
			...archive.parts
		]);
		for (const invalid of [
			undefined,
			{},
			[file(), file()],
			[file('A'.repeat(64))],
			[file('a'.repeat(63))],
			[file(undefined, 0)],
			[file(undefined, 1.5)],
			[file(undefined, mib + 1)],
			[{ ...file(), extra: true }]
		])
			expect(() => catalogPublicFiles(root(invalid))).toThrow('names an invalid file');
		expect(() => catalogPublicFiles(Buffer.from(JSON.stringify({ parts })))).toThrow(
			'names an invalid file'
		);
		for (const invalid of [
			{ index: archive.index },
			{ ...archive, parts: [] },
			{ ...archive, index: file('c'.repeat(64), 16 * mib + 1) },
			{ ...archive, parts: [file()] },
			{ ...archive, extra: true }
		])
			expect(() => catalogPublicFiles(root(parts, invalid))).toThrow('names an invalid file');
	});

	test('bound the catalog and the archive with all their files, warning past three quarters', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const parts = (count: number, size: number) =>
			Array.from({ length: count }, (_, index) => file(index.toString(16).padStart(64, '0'), size));
		try {
			catalogPublicFiles(root(parts(64, mib / 2)));
			expect(warn).not.toHaveBeenCalled();
			catalogPublicFiles(root(parts(100, mib / 2)));
			expect(warn.mock.calls.at(-1)?.[0]).toContain('78% of its 64 MiB limit');
			expect(() => catalogPublicFiles(root(parts(129, mib / 2)))).toThrow('the limit is 67108864');
			const archive = { index: file('f'.repeat(64), 8 * mib), parts: parts(113, mib / 2) };
			expect(() => catalogPublicFiles(root([], archive))).toThrow('the limit is 67108864');
		} finally {
			warn.mockRestore();
		}
	});
});
