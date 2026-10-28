/**
 * The public catalog is a root and the parts that it names by SHA-256 and size. The root holds
 * every author, group, model, provider and route, and a summary of each deployment; each part
 * holds whole deployments. Evidence approves the root, so a reader that shows one deployment
 * fetches one part, and readers that show none need only the root.
 *
 * A deployment that retired on or before the release policy's `archive_through` date moves to the
 * archive, and a model with it once all its deployments have. The archive is an index, which
 * summarizes each archived record and names the archive part that holds it, and those parts. The
 * root names the index and the archive parts too, or holds `archive: null` while nothing has
 * moved there, so its digest covers every file.
 */
export const PUBLIC_CATALOG_SCHEMA = 'stogas.catalog.public.v8';
export const PUBLIC_CATALOG_PART_SCHEMA = 'stogas.catalog.public.part.v8';
export const CATALOG_ARCHIVE_INDEX_SCHEMA = 'stogas.catalog.archive.index.v1';
export const CATALOG_ARCHIVE_PART_SCHEMA = 'stogas.catalog.archive.part.v1';

/**
 * The largest root, archive index and part, and the largest root with all its parts and archive
 * index with all the archive parts, in bytes. The build rejects larger ones, so readers can refuse
 * them before they download them.
 */
export const PUBLIC_CATALOG_ROOT_LIMIT = 16 * 1024 * 1024;
export const CATALOG_ARCHIVE_INDEX_LIMIT = 16 * 1024 * 1024;
export const PUBLIC_CATALOG_PART_LIMIT = 1024 * 1024;
export const PUBLIC_CATALOG_LIMIT = 64 * 1024 * 1024;
export const CATALOG_ARCHIVE_LIMIT = 64 * 1024 * 1024;

/**
 * What the root keeps of a deployment, and the archive index of an archived one: what pages need
 * to place it in the graph, and the part that holds its record.
 */
export function deploymentSummary(deployment, part) {
	return {
		modelId: deployment.modelId,
		part,
		retirementDate: deployment.retirementDate,
		routeIds: Object.keys(deployment.routes).sort()
	};
}

/** Every file that a root names, each by SHA-256 and size: its parts, then the archive's. */
export function publicCatalogFiles(root) {
	return [...root.parts, ...(root.archive ? [root.archive.index, ...root.archive.parts] : [])];
}

/**
 * Every file that a root of `rootSize` bytes names, after checking each name and size, and the
 * size of the catalog and of the archive with all their files, so that a reader can refuse them
 * before it downloads them. Throws when one fails.
 */
export function checkedPublicCatalogFiles(root, rootSize) {
	const seen = new Set();
	const named = (file, limit) =>
		hasKeys(file, ['sha256', 'size']) &&
		typeof file.sha256 === 'string' &&
		/^[0-9a-f]{64}$/.test(file.sha256) &&
		!seen.has(file.sha256) &&
		seen.add(file.sha256) &&
		Number.isSafeInteger(file.size) &&
		file.size > 0 &&
		file.size <= limit;
	const parts = (list) =>
		Array.isArray(list) && list.every((file) => named(file, PUBLIC_CATALOG_PART_LIMIT));
	const archive = root?.archive;
	if (
		!parts(root?.parts) ||
		!(
			archive === null ||
			(hasKeys(archive, ['index', 'parts']) &&
				named(archive.index, CATALOG_ARCHIVE_INDEX_LIMIT) &&
				parts(archive.parts) &&
				archive.parts.length > 0)
		)
	)
		throw new Error('The public catalog names an invalid file.');
	const within = (name, files, size, limit) => {
		const bytes = files.reduce((sum, file) => sum + file.size, size);
		if (bytes > limit) throw new Error(`${name} is ${bytes} bytes; the limit is ${limit}.`);
	};
	within('The public catalog with its parts', root.parts, rootSize, PUBLIC_CATALOG_LIMIT);
	if (archive)
		within(
			'The catalog archive with its parts',
			[archive.index, ...archive.parts],
			0,
			CATALOG_ARCHIVE_LIMIT
		);
	return publicCatalogFiles(root);
}

/**
 * The whole catalog from a root and its parts, in the root's order: each deployment's record as
 * its part holds it, and each schedule entry lists every node that differs from the base graph,
 * as the root's entries do for the other kinds. Throws when a part does not match the root.
 */
export function assemblePublicCatalog(root, parts) {
	if (root?.schema !== PUBLIC_CATALOG_SCHEMA || !Array.isArray(root.parts))
		throw new Error('Public catalog root is invalid.');
	if (!Array.isArray(parts) || parts.length !== root.parts.length)
		throw new Error('Public catalog parts differ from the root.');
	const summaries = root.graph.deployments;
	const order = new Map(Object.keys(summaries).map((id, index) => [id, index]));
	const starts = new Map(root.schedule.map((entry, index) => [entry.start, index]));
	const deployments = new Map();
	const scheduled = root.schedule.map(() => new Map());
	parts.forEach((part, index) => {
		if (part?.schema !== PUBLIC_CATALOG_PART_SCHEMA)
			throw new Error('Public catalog part is invalid.');
		for (const [id, record] of Object.entries(part.deployments)) {
			const summary = own(summaries, id);
			if (summary?.part !== index) throw new Error(`Deployment ${id} is not in this part.`);
			deployments.set(id, matchingSummary(id, record, summary));
		}
		for (const entry of part.schedule) {
			const position = starts.get(entry.start);
			if (position === undefined)
				throw new Error(`Part schedule entry ${entry.start} is not in the root.`);
			const changed = root.schedule[position].graph.deployments;
			for (const [id, record] of Object.entries(entry.deployments)) {
				const summary = own(changed, id) ?? own(summaries, id);
				if (summary?.part !== index) throw new Error(`Deployment ${id} is not in this part.`);
				scheduled[position].set(id, matchingSummary(id, record, summary));
			}
		}
	});
	// Each part holds only its own deployments, so equal counts mean every deployment is there.
	if (deployments.size !== order.size) throw new Error('Public catalog parts omit a deployment.');
	const inRootOrder = (records) =>
		Object.fromEntries([...records].sort(([left], [right]) => order.get(left) - order.get(right)));
	return {
		schema: root.schema,
		archive: root.archive,
		graph: { ...root.graph, deployments: inRootOrder(deployments) },
		schedule: root.schedule.map(({ start, graph }, position) => {
			for (const id of Object.keys(graph.deployments ?? {}))
				if (!scheduled[position].has(id))
					throw new Error(`Part omits deployment ${id} at ${start}.`);
			const { deployments: _summaries, ...nodes } = graph;
			return {
				start,
				graph: scheduled[position].size
					? { ...nodes, deployments: inRootOrder(scheduled[position]) }
					: nodes
			};
		}),
		periods: root.periods
	};
}

/**
 * The archived deployments and models from the archive's index and its parts, in the index's
 * order. Throws when a part does not match the index.
 */
export function assembleCatalogArchive(index, parts) {
	if (index?.schema !== CATALOG_ARCHIVE_INDEX_SCHEMA)
		throw new Error('Catalog archive index is invalid.');
	const records = { deployments: new Map(), models: new Map() };
	parts.forEach((part, position) => {
		if (part?.schema !== CATALOG_ARCHIVE_PART_SCHEMA)
			throw new Error('Catalog archive part is invalid.');
		for (const kind of ['deployments', 'models'])
			for (const [id, record] of Object.entries(part[kind])) {
				const entry = own(index[kind], id);
				if (entry?.part !== position)
					throw new Error(`Archived ${kind} ${id} is not in this part.`);
				records[kind].set(id, kind === 'deployments' ? matchingSummary(id, record, entry) : record);
			}
	});
	return Object.fromEntries(
		Object.entries(records).map(([kind, held]) => {
			if (held.size !== Object.keys(index[kind]).length)
				throw new Error(`Catalog archive parts omit archived ${kind}.`);
			return [kind, Object.fromEntries(Object.keys(index[kind]).map((id) => [id, held.get(id)]))];
		})
	);
}

/**
 * The catalog with the archived deployments and models beside the others. Archived records keep
 * their state on the day before they retired, and they reference only nodes that the catalog or
 * the archive holds.
 */
export function withArchive(catalog, archive) {
	const { deployments, models } = catalog.graph;
	for (const [kind, active] of [
		['deployments', deployments],
		['models', models]
	])
		for (const id of Object.keys(archive[kind]))
			if (Object.hasOwn(active, id)) throw new Error(`Archived ${kind} ${id} is also active.`);
	return {
		...catalog,
		graph: {
			...catalog.graph,
			deployments: { ...deployments, ...archive.deployments },
			models: { ...models, ...archive.models }
		}
	};
}

function matchingSummary(id, record, summary) {
	const routeIds = Object.keys(record.routes).sort();
	if (
		record.modelId !== summary.modelId ||
		record.retirementDate !== summary.retirementDate ||
		routeIds.join('\n') !== summary.routeIds.join('\n')
	)
		throw new Error(`Deployment ${id} differs from its summary.`);
	return record;
}

function own(record, key) {
	return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function hasKeys(value, keys) {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
