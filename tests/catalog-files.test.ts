import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../source/scripts/canonical-json.mjs';
import {
	CATALOG_PART_LIMIT,
	CATALOG_PART_SCHEMA,
	CATALOG_SCHEMA,
	assembleCatalog,
	checkedCatalogFiles,
	currentCatalogFile,
	isRetired,
	partsInEffect,
	partsOfRecords,
	retiredFrom,
	type CatalogPart,
	type CatalogRoot
} from '../source/scripts/catalog-files.mjs';
import { PART_BYTES, partitionCatalog, retirementDates } from '../source/scripts/catalog-parts.mjs';
import { catalogFileList } from '../source/scripts/release-format.mjs';
import type { Locations } from '../source/scripts/locations.mjs';
import { catalog as built } from './generated-catalog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Catalog JSON of any shape, which these tests read and change in place.
type Nodes = Record<string, Record<string, any>>;
type Source = {
	locations: Locations;
	graph: Record<string, Nodes>;
	schedule: { start: string; graph: Record<string, Nodes> }[];
	periods: object[];
};
const mib = 1024 * 1024;
const day = (index: number) => new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10);

/** The checkout's catalog, as the build partitions it. */
function source(): Source {
	return structuredClone({
		locations: built.locations,
		graph: built.graph,
		schedule: built.schedule,
		periods: built.periods
	});
}

/** The checkout's catalog with `copies` providers in place of each of its own. */
function scaled(copies: number): Source {
	const catalog = source();
	const { deployments, providers, routes } = built.graph;
	for (let copy = 1; copy < copies; copy++) {
		for (const [id, provider] of Object.entries(providers!))
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

/**
 * `count` deployments of one model, of about `bytes` each, spread over 40 providers, each retiring
 * on the date that `date` gives it.
 */
function synthetic(
	count: number,
	bytes = 1500,
	date: (index: number) => string | null = () => null
): Source {
	const providers = Array.from({ length: 40 }, (_, index) => index);
	return {
		locations: { world: { name: 'World', kind: 'world', parentIds: [] } },
		graph: {
			authors: { author: { aliases: [], name: 'Author' } },
			groups: {},
			models: {
				model: {
					aliases: [],
					authorId: 'author',
					groupIds: [],
					name: 'Model',
					releaseDate: '2026-01-01'
				}
			},
			providers: Object.fromEntries(
				providers.map((index) => [`provider-${index}`, { aliases: [], name: `Provider ${index}` }])
			),
			routes: Object.fromEntries(
				providers.map((index) => [
					`route-${index}`,
					{ interfaces: ['responses'], providerId: `provider-${index}` }
				])
			),
			deployments: Object.fromEntries(
				Array.from({ length: count }, (_, index) => [
					`deployment-${index}`,
					{
						modelId: 'model',
						retirementDate: date(index),
						routes: { [`route-${index % providers.length}`]: { notes: 'x'.repeat(bytes) } }
					}
				])
			)
		},
		schedule: [],
		periods: []
	};
}

/** The root and parts as their files hold them. */
function files({ root, parts }: { root: object; parts: { json: string }[] }) {
	return {
		root: JSON.parse(canonicalJson(root)) as CatalogRoot,
		parts: parts.map(({ json }) => JSON.parse(json) as CatalogPart)
	};
}

/**
 * The locations, graph, schedule and periods of a catalog, as canonical JSON, without the root's
 * summaries.
 */
function whole({ locations, graph, schedule, periods }: Source) {
	return canonicalJson({
		locations,
		graph,
		schedule: schedule.map(({ start, graph: changed }) => ({ start, graph: changed })),
		periods
	});
}

function digests(catalog: Source) {
	return partitionCatalog(catalog).parts.map(({ sha256 }) => sha256);
}

/** The deployments that each part holds. */
function deploymentsOf(parts: CatalogPart[]) {
	return parts.map((part) => Object.keys(part.graph.deployments ?? {}));
}

describe('catalog parts', () => {
	test('share the version of the root’s schema, which alone says whether a reader reads them', () => {
		const version = /^stogas\.catalog\.(v[1-9][0-9]*)$/.exec(CATALOG_SCHEMA)?.[1];
		expect(version).toBeDefined();
		expect(CATALOG_PART_SCHEMA).toBe(`stogas.catalog.part.${version}`);
	});

	test('name each part by the SHA-256 and size of its exact bytes, and its latest date', () => {
		const catalog = synthetic(3000, 1500, (index) => (index % 3 ? null : day(index % 400)));
		const partitioned = partitionCatalog(catalog);
		const { root, parts } = files(partitioned);
		expect(partitioned.parts.length).toBeGreaterThan(10);
		partitioned.parts.forEach((part, index) => {
			expect(part.sha256).toBe(createHash('sha256').update(part.json).digest('hex'));
			expect(part.size).toBe(Buffer.byteLength(part.json));
			expect(root.parts[index]).toEqual({
				sha256: part.sha256,
				size: part.size,
				through: root.parts[index]!.through,
				stogasUnsupported: false
			});
		});
		deploymentsOf(parts).forEach((ids, index) => {
			const dates = ids.map((id) => catalog.graph.deployments![id]!.retirementDate);
			expect(root.parts[index]!.through).toBe(
				dates.length && !dates.includes(null) ? dates.sort().at(-1) : null
			);
		});
	});

	test('rebuild the build’s exact files from the catalog that they assemble to', () => {
		const { root, parts } = partitionCatalog(source());
		expect(canonicalJson(root)).toBe(readFileSync('generated/catalog.json', 'utf8'));
		for (const { json, sha256 } of parts)
			expect(json).toBe(readFileSync(`generated/catalog.parts/${sha256}.json`, 'utf8'));
	});

	test('assemble to exactly the whole catalog, in the order of the root, at every scale', () => {
		for (const copies of [1, 10, 30]) {
			const catalog = scaled(copies);
			const partitioned = partitionCatalog(catalog);
			expect(partitioned.parts.every(({ size }) => size <= CATALOG_PART_LIMIT)).toBe(true);
			const { root, parts } = files(partitioned);
			const assembled = assembleCatalog<Source>(root, parts);
			expect(whole(assembled)).toBe(whole(catalog));
			for (const kind of ['models', 'routes', 'deployments'])
				expect(Object.keys(assembled.graph[kind]!)).toEqual(
					Object.keys(root.summaries[kind as 'models'])
				);
		}
		const empty = synthetic(0);
		for (const kind of Object.keys(empty.graph)) empty.graph[kind] = {};
		const { root, parts } = files(partitionCatalog(empty));
		expect(parts).toEqual([]);
		expect(whole(assembleCatalog<Source>(root, parts))).toBe(whole(empty));
	});

	test('take their average size whatever the size of their records, within the limit', () => {
		for (const [count, bytes] of [
			[40_000, 300],
			[9000, 1500],
			[1200, 10_000]
		] as const) {
			const sizes = partitionCatalog(synthetic(count, bytes)).parts.map(({ size }) => size);
			const average = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
			expect(average).toBeGreaterThan(PART_BYTES * 0.6);
			expect(average).toBeLessThan(PART_BYTES * 1.4);
			expect(sizes.every((size) => size <= CATALOG_PART_LIMIT)).toBe(true);
		}
		// A record of the average size or more starts a part, and one over the limit fails.
		const { parts } = files(partitionCatalog(synthetic(3, 600_000)));
		expect(deploymentsOf(parts).map((ids) => ids.length)).toEqual([0, 1, 1, 1]);
		expect(() => partitionCatalog(synthetic(1, mib))).toThrow('the limit is 1048576');
	});

	test('keep each provider in consecutive parts', () => {
		const catalog = synthetic(9000);
		const { parts } = files(partitionCatalog(catalog));
		// A part's file lists records by ID, so its providers are sorted here.
		const order = deploymentsOf(parts).flatMap((ids) =>
			[
				...new Set(
					ids.map(
						(id) =>
							catalog.graph.routes![Object.keys(catalog.graph.deployments![id]!.routes)[0]!]!
								.providerId
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

	test('change only the parts around a changed, added or removed record', () => {
		const catalog = synthetic(4500);
		const before = new Set(digests(catalog));
		expect(before.size).toBeGreaterThan(20);
		const edits: ((copy: Source) => void)[] = [];
		for (let index = 50; index < 4500; index += 450) {
			const id = `deployment-${index}`;
			edits.push((copy) => {
				copy.graph.deployments![id]!.routes[`route-${index % 40}`].notes = 'changed';
			});
			edits.push((copy) => {
				copy.graph.deployments![`${id}-added`] = catalog.graph.deployments![id]!;
			});
			edits.push((copy) => {
				delete copy.graph.deployments![id];
			});
		}
		const changed = edits.map((edit) => {
			const copy = structuredClone(catalog);
			edit(copy);
			return digests(copy).filter((digest) => !before.has(digest)).length;
		});
		expect(Math.min(...changed)).toBe(1);
		expect(Math.max(...changed)).toBeLessThanOrEqual(2);
		expect(changed.filter((count) => count > 1).length).toBeLessThanOrEqual(changed.length / 10);
	}, 60_000);

	test('hold records without a date first and the others by date, never together', () => {
		const catalog = synthetic(6000, 1500, (index) => (index % 2 ? day(index % 300) : null));
		const { root, parts } = files(partitionCatalog(catalog));
		const dates = deploymentsOf(parts).map((ids) =>
			ids.map((id) => catalog.graph.deployments![id]!.retirementDate as string | null)
		);
		const undated = dates.filter((part) => part.every((date) => date === null)).length;
		expect(undated).toBeGreaterThan(5);
		expect(dates.slice(0, undated).flat().includes(null)).toBe(true);
		const later = dates.slice(undated);
		expect(later.length).toBeGreaterThan(5);
		later.forEach((part, index) => {
			expect(part.includes(null)).toBe(false);
			if (index) expect(part.sort()[0]! >= later[index - 1]!.sort().at(-1)!).toBe(true);
		});
		// The model and the routes have undated deployments, so they never retire.
		expect(root.summaries.models.model!.part).toBeLessThan(undated);
		expect(root.parts.slice(undated).every(({ through }) => through !== null)).toBe(true);
	});

	test('keep every earlier part when records that retire later join', () => {
		const earlier = new Set(digests(synthetic(3000, 1500, day)));
		const parts = digests(synthetic(3600, 1500, day));
		// Only the last part changes, because the model and the routes now retire later.
		expect(parts.filter((digest) => earlier.has(digest)).length).toBeGreaterThanOrEqual(
			earlier.size - 1
		);
	});

	const [modelId, model] = Object.entries(built.graph.models!)[0]!;
	const [authorId, author] = Object.entries(built.graph.authors!)[0]!;
	const [deploymentId, deployment] = Object.entries(built.graph.deployments!)[0]!;
	const renamed = { ...model, name: 'Renamed' };
	const repriced = structuredClone(deployment);
	(Object.values(repriced.routes)[0] as { pricing: object }).pricing = {};
	/** The checkout's catalog, with a renamed model and a repriced deployment from December. */
	function scheduled() {
		const catalog = source();
		const changed = { models: { [modelId]: renamed }, deployments: { [deploymentId]: repriced } };
		catalog.schedule = [
			{ start: '2026-12-01T00:00:00Z', graph: changed },
			{
				start: '2027-01-01T00:00:00Z',
				graph: { ...changed, authors: { [authorId]: { ...author, name: 'Renamed author' } } }
			},
			{ start: '2027-02-01T00:00:00Z', graph: {} }
		];
		return catalog;
	}

	test('keep every start in the root and changes beside the parts that hold them', () => {
		const catalog = scheduled();
		const { root, parts } = files(partitionCatalog(catalog));
		const summary = { ...root.summaries.models[modelId]!, name: 'Renamed' };
		expect(root.schedule).toEqual([
			{ start: '2026-12-01T00:00:00Z', summaries: { models: { [modelId]: summary } } },
			{
				start: '2027-01-01T00:00:00Z',
				summaries: {
					authors: {
						[authorId]: { ...root.summaries.authors[authorId]!, name: 'Renamed author' }
					},
					models: { [modelId]: summary }
				}
			},
			{ start: '2027-02-01T00:00:00Z', summaries: {} }
		]);
		const entry = (part: number, start: string) =>
			parts[part]!.schedule.find((each) => each.start === start)!.graph;
		for (const start of ['2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
			expect(entry(root.summaries.models[modelId]!.part, start).models![modelId]).toEqual(renamed);
			expect(
				entry(root.summaries.deployments[deploymentId]!.part, start).deployments![deploymentId]
			).toEqual(repriced);
		}
		expect(whole(assembleCatalog<Source>(root, parts))).toBe(whole(catalog));
	});

	test('read a root and parts of the previous format as the current format', () => {
		// The previous format had no records that Stogas does not serve.
		const catalog = scheduled();
		for (const nodes of Object.values(catalog.graph))
			for (const [id, node] of Object.entries(nodes ?? {}))
				if (node.stogasUnsupported) delete nodes![id];
		const { root, parts } = files(partitionCatalog(catalog));
		expect(root.parts.some((part) => part.stogasUnsupported)).toBe(false);
		// The previous format is the current one without the mark on each part.
		const previousRoot = {
			...root,
			schema: 'stogas.catalog.v10',
			parts: root.parts.map(({ stogasUnsupported: _, ...part }) => part)
		};
		const previousParts = parts.map((part) => ({ ...part, schema: 'stogas.catalog.part.v10' }));
		const currentRoot = currentCatalogFile(previousRoot) as CatalogRoot;
		expect(currentRoot).toEqual(root);
		expect(previousParts.map(currentCatalogFile)).toEqual(parts);
		expect(checkedCatalogFiles(currentRoot, 1)).toEqual(root.parts);
		expect(
			assembleCatalog(currentRoot, previousParts.map(currentCatalogFile) as CatalogPart[])
		).toEqual(assembleCatalog(root, parts));
		// Without the conversion, and for anything else, the reader refuses as before.
		expect(() => assembleCatalog(previousRoot as never, parts)).toThrow('root is invalid');
		for (const other of [
			null,
			'stogas.catalog.v10',
			{ ...previousRoot, schema: 'stogas.catalog.v9' },
			{ ...previousRoot, parts: undefined },
			{ ...previousRoot, parts: root.parts },
			{ ...parts[0], schema: 'stogas.catalog.part.v9' }
		])
			expect(currentCatalogFile(other)).toBe(other);
		expect(currentCatalogFile(root)).toBe(root);
		expect(currentCatalogFile(parts[0])).toBe(parts[0]);
	});

	test('refuse parts that do not match their root', () => {
		const { root, parts } = files(partitionCatalog(scheduled()));
		const { part } = root.summaries.deployments[deploymentId]!;
		const modelPart = root.summaries.models[modelId]!.part;
		const assembling = (change: (copy: { root: CatalogRoot; parts: CatalogPart[] }) => unknown) => {
			const copy = structuredClone({ root, parts });
			change(copy);
			return () => assembleCatalog(copy.root, copy.parts);
		};
		const entry = (copy: { parts: CatalogPart[] }, index: number) =>
			copy.parts[index]!.schedule.find(({ start }) => start === '2026-12-01T00:00:00Z')!;
		expect(assembling(() => {})).not.toThrow();
		expect(assembling((copy) => copy.parts.pop())).toThrow('parts differ from the root');
		expect(assembling((copy) => (copy.root.schema = 'stogas.catalog.v8' as never))).toThrow(
			'root is invalid'
		);
		expect(assembling((copy) => (copy.parts[part]!.schema = 'other' as never))).toThrow(
			'part is invalid'
		);
		expect(assembling((copy) => delete copy.parts[part]!.graph.deployments![deploymentId])).toThrow(
			`The catalog parts omit deployments ${deploymentId}.`
		);
		expect(
			assembling(
				(copy) => (copy.root.summaries.deployments[deploymentId]!.part = part ? part - 1 : part + 1)
			)
		).toThrow('is not in this part');
		expect(
			assembling((copy) => (copy.parts[part]!.graph.authors = { [authorId]: author }) as never)
		).toThrow(`authors ${authorId} is not in this part`);
		expect(
			assembling((copy) => (copy.parts[part]!.graph.deployments!.unknown = deployment))
		).toThrow('deployments unknown is not in this part');
		expect(
			assembling(
				(copy) => (copy.parts[part]!.graph.deployments![deploymentId]!.modelId = 'another-model')
			)
		).toThrow('differs from its summary');
		expect(
			assembling(
				(copy) => (copy.parts[part]!.graph.deployments![deploymentId]!.routes = { another: {} })
			)
		).toThrow('differs from its summary');
		// A deployment's own date is the one that readers retire it by.
		expect(
			assembling(
				(copy) =>
					(copy.parts[part]!.graph.deployments![deploymentId]!.retirementDate = '2099-01-01')
			)
		).toThrow('differs from its summary');
		expect(
			assembling((copy) => (copy.root.summaries.deployments[deploymentId]!.part = parts.length))
		).toThrow(`deployments ${deploymentId} names no part of the root`);
		expect(
			assembling((copy) => (entry(copy, modelPart).graph.models![modelId]!.name = 'Other'))
		).toThrow('differs from its summary');
		expect(
			assembling(
				(copy) =>
					(copy.parts[modelPart]!.schedule = copy.parts[modelPart]!.schedule.filter(
						({ graph }) => !graph.models
					))
			)
		).toThrow(`The catalog parts omit models ${modelId} in a state.`);
		expect(assembling((copy) => (entry(copy, part).start = '2027-01-02T00:00:00Z'))).toThrow(
			'is not in the root'
		);
	});

	test('assemble the records of the parts read, beside every summary', () => {
		const catalog = synthetic(6000, 1500, (index) => (index % 2 ? day(index % 300) : null));
		const { root, parts } = files(partitionCatalog(catalog));
		const assembled = assembleCatalog(
			root,
			parts.map((part, index) => (index % 2 ? part : null))
		);
		expect(Object.keys(assembled.graph.deployments!)).toEqual(
			Object.entries(root.summaries.deployments)
				.filter(([, { part }]) => part % 2)
				.map(([id]) => id)
		);
		expect(assembled.read).toEqual(parts.flatMap((_, index) => (index % 2 ? [index] : [])));
		for (const id of Object.keys(assembled.graph.deployments!))
			expect(assembled.graph.deployments![id]).toEqual(catalog.graph.deployments![id]!);
		expect(assembled.summaries).toEqual(root.summaries);
		expect(assembled.graph.providers).toEqual(catalog.graph.providers!);
		expect(
			assembleCatalog<Source>(
				root,
				parts.map(() => null)
			).graph.deployments
		).toEqual({});
	});
});

describe('retirement', () => {
	test('retires a record once its date has ended everywhere on Earth', () => {
		// The date ends last at 24:00 in UTC−12, which is 12:00 UTC on the next day.
		expect(retiredFrom('2027-03-01')).toBe(Date.parse('2027-03-02T12:00:00Z'));
		expect(isRetired('2027-03-01', Date.parse('2027-03-02T11:59:59.999Z'))).toBe(false);
		expect(isRetired('2027-03-01', Date.parse('2027-03-02T12:00:00Z'))).toBe(true);
		expect(isRetired('2027-03-01', new Date('2027-03-02T12:00:00Z'))).toBe(true);
		expect(isRetired('2027-12-31', Date.parse('2028-01-01T12:00:00Z'))).toBe(true);
		expect(isRetired(null, Date.parse('2100-01-01T00:00:00Z'))).toBe(false);
	});

	test('dates each record by the records that it exists for', () => {
		const graph = {
			authors: { author: {}, empty: {} },
			groups: {
				parent: { parentIds: [] },
				child: { parentIds: ['parent'] },
				empty: { parentIds: [] }
			},
			models: {
				grouped: { authorId: 'author', groupIds: ['child'] },
				listed: { authorId: 'author', groupIds: [] },
				unserved: { authorId: 'author', groupIds: [] }
			},
			providers: { provider: {}, empty: {} },
			routes: { first: { providerId: 'provider' }, second: { providerId: 'provider' } },
			deployments: {
				early: { modelId: 'grouped', retirementDate: '2027-01-01', routes: { first: {} } },
				late: {
					modelId: 'grouped',
					retirementDate: '2027-02-01',
					routes: { first: {}, second: {} }
				},
				lasting: { modelId: 'listed', retirementDate: null, routes: { second: {} } }
			}
		};
		expect(retirementDates(graph)).toEqual({
			authors: { author: null, empty: null },
			groups: { parent: '2027-02-01', child: '2027-02-01', empty: null },
			models: { grouped: '2027-02-01', listed: null, unserved: null },
			providers: { provider: null, empty: null },
			routes: { first: '2027-02-01', second: null },
			deployments: { early: '2027-01-01', late: '2027-02-01', lasting: null }
		});
		graph.deployments.lasting.retirementDate = '2027-03-01' as never;
		delete (graph.models as Record<string, unknown>).unserved;
		expect(retirementDates(graph)).toMatchObject({
			authors: { author: '2027-03-01' },
			models: { listed: '2027-03-01' },
			providers: { provider: '2027-03-01' },
			routes: { second: '2027-03-01' }
		});
	});

	test('a route retires on its own date before the records it exists for', () => {
		// The build has applied the dates that a provider names for a route or for itself to the
		// route and to the deployments that it ends.
		const graph = {
			authors: { author: {} },
			groups: {},
			models: { model: { authorId: 'author', groupIds: [] } },
			providers: { closing: {}, lasting: {} },
			routes: {
				old: { providerId: 'lasting', retirementDate: '2027-03-01' },
				next: { providerId: 'lasting' },
				closing: { providerId: 'closing', retirementDate: '2027-05-01' }
			},
			deployments: {
				both: { modelId: 'model', retirementDate: null, routes: { old: {}, next: {} } },
				closed: { modelId: 'model', retirementDate: '2027-05-01', routes: { closing: {} } }
			}
		};
		expect(retirementDates(graph)).toEqual({
			authors: { author: null },
			groups: {},
			models: { model: null },
			providers: { closing: '2027-05-01', lasting: null },
			routes: { old: '2027-03-01', next: null, closing: '2027-05-01' },
			deployments: { both: null, closed: '2027-05-01' }
		});
	});

	test('leaves each part out once all its records have retired', () => {
		const { root } = files(
			partitionCatalog(synthetic(6000, 1500, (index) => (index % 2 ? day(index % 300) : null)))
		);
		const [[index, through]] = root.parts.flatMap(({ through }, position) =>
			through ? [[position, through] as const] : []
		);
		expect(partsInEffect(root, retiredFrom(through) - 1)).toContain(index);
		expect(partsInEffect(root, retiredFrom(through))).not.toContain(index);
		expect(partsInEffect(root, Date.parse('2100-01-01T00:00:00Z'))).toEqual(
			root.parts.flatMap(({ through }, position) => (through === null ? [position] : []))
		);
	});

	test('finds the parts that hold given records, once each', () => {
		const { root } = files(partitionCatalog(synthetic(6000)));
		const { part } = root.summaries.deployments['deployment-5999']!;
		expect(
			partsOfRecords(root, [
				['deployments', 'deployment-5999'],
				['deployments', 'deployment-5999'],
				['models', 'model'],
				['deployments', 'missing']
			])
		).toEqual([...new Set([root.summaries.models.model!.part, part])].sort((a, b) => a - b));
	});
});

describe('catalog limits', () => {
	const file = (sha256 = 'a'.repeat(64), size = 1, through: string | null = null) => ({
		sha256,
		size,
		through,
		stogasUnsupported: false
	});
	const root = (parts: unknown, fields: object = {}) =>
		Buffer.from(
			JSON.stringify({
				schema: 'stogas.catalog.v11',
				locations: {},
				summaries: {},
				parts,
				...fields
			})
		);

	test('list every part that a root names, and refuse an invalid one', () => {
		const parts = [file(), file('b'.repeat(64), mib / 2, '2027-01-01')];
		expect(catalogFileList(root(parts))).toEqual(parts);
		expect(catalogFileList(root([]))).toEqual([]);
		for (const invalid of [
			root(undefined),
			root({}),
			root([], { schema: 'stogas.catalog.v9' }),
			root([], { locations: undefined }),
			root([], { summaries: [] })
		])
			expect(() => catalogFileList(invalid)).toThrow('root is invalid');
		for (const invalid of [
			[file(), file()],
			[file('A'.repeat(64))],
			[file('a'.repeat(63))],
			[file(undefined, 0)],
			[file(undefined, 1.5)],
			[file(undefined, mib + 1)],
			[file(undefined, 1, '2027-02-30')],
			[file(undefined, 1, '2027-1-01')],
			[{ sha256: 'a'.repeat(64), size: 1 }],
			[{ ...file(), extra: true }]
		])
			expect(() => catalogFileList(root(invalid))).toThrow('names an invalid part');
	});

	test('bound the root and the catalog with every part, warning past three quarters', () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {});
		const parts = (count: number) =>
			Array.from({ length: count }, (_, index) => file(index.toString(16).padStart(64, '0'), mib));
		try {
			catalogFileList(root(parts(64)));
			expect(warn).not.toHaveBeenCalled();
			catalogFileList(root(parts(100)));
			expect(warn.mock.calls.at(-1)?.[0]).toContain('78% of its 128 MiB limit');
			expect(() => catalogFileList(root(parts(128)))).toThrow('the limit is 134217728');
			catalogFileList(root([], { padding: 'x'.repeat(13 * mib) }));
			expect(warn.mock.calls.at(-1)?.[0]).toContain('81% of its 16 MiB limit');
			expect(() => catalogFileList(root([], { padding: 'x'.repeat(16 * mib) }))).toThrow(
				'the limit is 16777216'
			);
		} finally {
			warn.mockRestore();
		}
	});
});
