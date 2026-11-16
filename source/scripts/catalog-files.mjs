/**
 * A catalog is a root and the parts that it names by SHA-256 and size; the gateway, the website and
 * every other reader read the same files. The root holds the locations, the places that data
 * handling names, and the companies that records name, and summarizes every record of every kind,
 * current or retired: what readers need to list, link, search and resolve selectors. Authors, groups and providers are few and small, so
 * their summaries are their whole records; a model, route or deployment summary names the part that
 * holds its record, with the record's scheduled versions.
 *
 * Each summary also gives the record's retirement date. The provider can name one for a
 * deployment, a route or itself; a provider's date ends each of its routes, and a deployment also
 * retires once its routes have all retired. Any record retires with the last of the records it
 * exists for, once all of them have dates: a model or a route with its deployments, a provider
 * with its routes, an author with its models, and a group with the models in it and in its child
 * groups. Parts hold the records without a date first and then those with one, by date, and the
 * root gives each part the latest date in it. A reader skips each part whose records have all
 * retired, so a record leaves what readers load as it retires, without a release.
 *
 * The catalog also lists what Stogas does not serve, so that it shows the whole market. Each
 * summary says whether Stogas serves its record, and the records that it does not serve sit in
 * parts of their own after the others, which the root marks. The gateway never reads those parts,
 * so it never routes to them.
 *
 * The root and its parts share a schema version, and a change to either names a new version of
 * both, so a reader knows from the root alone whether it reads a catalog, and readers that find
 * another format keep the newest catalog whose root they read.
 */
export const CATALOG_SCHEMA = 'stogas.catalog.v1';
export const CATALOG_PART_SCHEMA = 'stogas.catalog.part.v1';

export const CATALOG_KINDS = Object.freeze([
	'authors',
	'groups',
	'models',
	'providers',
	'routes',
	'deployments'
]);
/** The kinds whose records the root holds whole. */
export const WHOLE_KINDS = Object.freeze(['authors', 'groups', 'providers']);
/** The kinds whose records parts hold, and the record fields that their summaries repeat. */
export const PART_KINDS = Object.freeze({
	models: Object.freeze(['aliases', 'authorId', 'groupIds', 'name', 'releaseDate']),
	routes: Object.freeze(['interfaces', 'providerId']),
	deployments: Object.freeze(['modelId', 'retirementDate'])
});

/**
 * The largest root and part, and the largest root with every part, in bytes. The build rejects
 * larger ones, so readers can refuse them before they download them.
 */
export const CATALOG_ROOT_LIMIT = 16 * 1024 * 1024;
export const CATALOG_PART_LIMIT = 1024 * 1024;
export const CATALOG_LIMIT = 128 * 1024 * 1024;

const DAY = 86_400_000;

/**
 * When a record that retires on `date` stops serving, in milliseconds: once the date has ended
 * everywhere on Earth, at 12:00 UTC on the next day. A provider that names a date may mean its
 * start or its end in any time zone, so readers never stop a record before the provider does.
 */
export function retiredFrom(date) {
	return Date.parse(`${date}T12:00:00Z`) + DAY;
}

/** Whether a record that retires on `date`, or never when null, has retired at `at`. */
export function isRetired(date, at = Date.now()) {
	return date !== null && date !== undefined && at.valueOf() >= retiredFrom(date);
}

/**
 * The ways that Stogas serves a record: with a customer's own credential, and with its own account,
 * which it bills the customer for. Every route, deployment, summary and part states both.
 */
export const STOGAS_MODES = Object.freeze(['stogasByok', 'stogasManaged']);

/** Whether Stogas serves a record, summary or part in either way. */
export function stogasServes(record) {
	return record.stogasByok || record.stogasManaged;
}

/**
 * What the root keeps of a record that a part holds, or of a whole record, with how Stogas serves
 * it.
 */
export function recordSummary(kind, record, part, retirementDate, modes) {
	const serving = Object.fromEntries(STOGAS_MODES.map((mode) => [mode, modes[mode]]));
	const fields = Object.hasOwn(PART_KINDS, kind) ? PART_KINDS[kind] : null;
	if (!fields) return { ...record, retirementDate, ...serving };
	const summary = { part, retirementDate, ...serving };
	for (const field of fields) if (Object.hasOwn(record, field)) summary[field] = record[field];
	if (kind === 'deployments') summary.routeIds = Object.keys(record.routes).sort();
	return summary;
}

/** A whole record from its summary in the root. */
function wholeRecord(summary) {
	const {
		retirementDate: _retirementDate,
		stogasByok: _byok,
		stogasManaged: _managed,
		...record
	} = summary;
	return record;
}

/**
 * Each part that a root of `rootSize` bytes names, after checking each name, size and date and
 * the size of the root with every part, so that a reader can refuse a catalog before it downloads
 * it. Throws when one fails.
 */
export function checkedCatalogFiles(root, rootSize) {
	if (
		root?.schema !== CATALOG_SCHEMA ||
		!Array.isArray(root.parts) ||
		!isObject(root.locations) ||
		!isObject(root.companies) ||
		!isObject(root.summaries)
	)
		throw new Error('The catalog root is invalid.');
	if (!(Number.isSafeInteger(rootSize) && rootSize > 0 && rootSize <= CATALOG_ROOT_LIMIT))
		throw new Error(`The catalog root is ${rootSize} bytes; the limit is ${CATALOG_ROOT_LIMIT}.`);
	const seen = new Set();
	let bytes = rootSize;
	for (const file of root.parts) {
		if (
			!hasKeys(file, ['sha256', 'size', 'through', ...STOGAS_MODES]) ||
			STOGAS_MODES.some((mode) => typeof file[mode] !== 'boolean') ||
			typeof file.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(file.sha256) ||
			seen.has(file.sha256) ||
			!Number.isSafeInteger(file.size) ||
			file.size < 1 ||
			file.size > CATALOG_PART_LIMIT ||
			!(file.through === null || isDate(file.through))
		)
			throw new Error('The catalog names an invalid part.');
		seen.add(file.sha256);
		bytes += file.size;
	}
	if (bytes > CATALOG_LIMIT)
		throw new Error(`The catalog with its parts is ${bytes} bytes; the limit is ${CATALOG_LIMIT}.`);
	return root.parts;
}

/**
 * The positions of the parts that hold a record that has not retired at `at`, which is every part
 * whose records do not all retire by then. Without `unserved`, it leaves out the parts of the
 * records that Stogas does not serve, as the gateway does.
 */
export function partsInEffect(root, at = Date.now(), { unserved = false } = {}) {
	return root.parts.flatMap((part, index) =>
		isRetired(part.through, at) || !(stogasServes(part) || unserved) ? [] : [index]
	);
}

/** The positions of the parts that hold the records of the given kinds and IDs, once each. */
export function partsOfRecords(root, records) {
	const positions = new Set();
	for (const [kind, id] of records) {
		const summary = own(root.summaries[kind], id);
		if (summary && Number.isSafeInteger(summary.part)) positions.add(summary.part);
	}
	return [...positions].sort((left, right) => left - right);
}

/**
 * The catalog from a root and the parts that a reader read: `parts` has one entry for each part
 * that the root names, null for one not read. It keeps the root's locations and companies. The graph holds every
 * whole record and each record of the parts read, in the root's order, and each schedule entry
 * keeps the root's summaries that differ then, with every such record that differs from the base
 * graph. `summaries` is the root's, so a reader also knows the records that it did not read, and
 * `read` lists the parts read. Work grows with the parts read, not the root. Throws when a part
 * does not match the root.
 */
export function assembleCatalog(root, parts) {
	if (
		root?.schema !== CATALOG_SCHEMA ||
		!Array.isArray(root.parts) ||
		!isObject(root.locations) ||
		!isObject(root.companies) ||
		!isObject(root.summaries) ||
		!Array.isArray(root.schedule)
	)
		throw new Error('The catalog root is invalid.');
	if (!Array.isArray(parts) || parts.length !== root.parts.length)
		throw new Error('The catalog parts differ from the root.');
	const members = partMembers(root);
	const starts = new Map(root.schedule.map((entry, index) => [entry.start, index]));
	// The records that the parts read hold, by kind and ID, in the base graph and in each state.
	const held = Array.from({ length: root.schedule.length + 1 }, () => new Map());
	const records = (position, kind) => {
		let found = held[position].get(kind);
		if (!found) held[position].set(kind, (found = new Map()));
		return found;
	};
	const hold = (position, kind, id, record, summary, index) => {
		if (summary?.part !== index || !Object.hasOwn(PART_KINDS, kind))
			throw new Error(`${kind} ${id} is not in this part.`);
		records(position, kind).set(id, matching(kind, id, record, summary));
	};
	const read = [];
	parts.forEach((part, index) => {
		if (part === null || part === undefined) return;
		if (
			part?.schema !== CATALOG_PART_SCHEMA ||
			!isObject(part.graph) ||
			!Array.isArray(part.schedule)
		)
			throw new Error('A catalog part is invalid.');
		read.push(index);
		for (const [kind, nodes] of Object.entries(part.graph))
			for (const [id, record] of Object.entries(nodes))
				hold(0, kind, id, record, own(root.summaries[kind], id), index);
		for (const entry of part.schedule) {
			const position = starts.get(entry.start);
			if (position === undefined)
				throw new Error(`Part schedule entry ${entry.start} is not in the root.`);
			for (const [kind, nodes] of Object.entries(entry.graph)) {
				const changed = root.schedule[position].summaries[kind];
				for (const [id, record] of Object.entries(nodes))
					hold(
						position + 1,
						kind,
						id,
						record,
						own(changed, id) ?? own(root.summaries[kind], id),
						index
					);
			}
		}
	});
	// A part holds every record whose summary names it, and a summary in a schedule entry names a
	// record that differs from the base graph, so the part that holds it lists it there too.
	for (const index of read)
		for (const [kind, id] of members[index])
			if (!records(0, kind).has(id)) throw new Error(`The catalog parts omit ${kind} ${id}.`);
	const isRead = new Set(read);
	root.schedule.forEach(({ summaries }, position) => {
		for (const kind of Object.keys(PART_KINDS))
			for (const [id, summary] of Object.entries(summaries[kind] ?? {}))
				if (isRead.has(summary.part) && !records(position + 1, kind).has(id))
					throw new Error(`The catalog parts omit ${kind} ${id} in a state.`);
	});
	// The records of one kind, in the root's order.
	const inOrder = (kind, found) =>
		Object.fromEntries(
			[...found].sort(
				([left], [right]) => order(root.summaries[kind], left) - order(root.summaries[kind], right)
			)
		);
	const graph = {};
	for (const kind of CATALOG_KINDS)
		graph[kind] = WHOLE_KINDS.includes(kind)
			? Object.fromEntries(
					Object.entries(root.summaries[kind] ?? {}).map(([id, summary]) => [
						id,
						wholeRecord(summary)
					])
				)
			: inOrder(kind, records(0, kind));
	return {
		schema: root.schema,
		locations: root.locations,
		companies: root.companies,
		parts: root.parts,
		read,
		periods: root.periods,
		summaries: root.summaries,
		graph,
		schedule: root.schedule.map(({ start, summaries }, position) => {
			const changed = {};
			for (const kind of CATALOG_KINDS) {
				if (WHOLE_KINDS.includes(kind)) {
					const ids = Object.keys(summaries[kind] ?? {});
					if (ids.length)
						changed[kind] = Object.fromEntries(
							ids.map((id) => [id, wholeRecord(summaries[kind][id])])
						);
				} else if (held[position + 1].get(kind)?.size)
					changed[kind] = inOrder(kind, held[position + 1].get(kind));
			}
			return { start, summaries, graph: changed };
		})
	};
}

// The records that each part holds by the root, as kinds and IDs, once for each root.
const memberships = new WeakMap();
function partMembers(root) {
	let members = memberships.get(root);
	if (!members) {
		members = root.parts.map(() => []);
		for (const kind of Object.keys(PART_KINDS))
			for (const [id, summary] of Object.entries(root.summaries[kind] ?? {})) {
				if (!Number.isSafeInteger(summary?.part) || !members[summary.part])
					throw new Error(`${kind} ${id} names no part of the root.`);
				members[summary.part].push([kind, id]);
			}
		memberships.set(root, members);
	}
	return members;
}

/** The record, after checking that the summary repeats its fields. */
function matching(kind, id, record, summary) {
	const expected = recordSummary(kind, record, summary.part, summary.retirementDate, summary);
	if (canonical(expected) !== canonical(summary))
		throw new Error(`${kind} ${id} differs from its summary.`);
	return record;
}

// The position of a record in the root, so that assembled graphs keep the root's order.
const positions = new WeakMap();
function order(summaries, id) {
	let ids = positions.get(summaries);
	if (!ids) {
		ids = new Map(Object.keys(summaries).map((key, at) => [key, at]));
		positions.set(summaries, ids);
	}
	return ids.get(id);
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (isObject(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

function isDate(value) {
	return (
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
	);
}

function own(record, key) {
	return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value, keys) {
	return (
		isObject(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
