import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
	CATALOG_KINDS,
	CATALOG_PART_LIMIT,
	CATALOG_PART_SCHEMA,
	CATALOG_SCHEMA,
	PART_KINDS,
	recordSummary
} from './catalog-files.mjs';
import { ancestorGroupIds } from './model-groups.mjs';

// Records go to parts in a fixed order: those without a retirement date by kind, owner and ID,
// then those with one by date, kind, owner and ID, so that a part's records retire together and a
// release with later retirements adds parts after the others. A part ends before a record whose
// kind and ID hash below the record's share of PART_BYTES, so parts take PART_BYTES on average
// whatever the size of their records, and where a part ends depends only on the record there:
// adding, changing or removing a record changes its part, and the part beside it only when the
// record starts or stops ending one. A part also ends where the dated records start, and before
// its file would pass the limit of a part.
export const PART_BYTES = 128 * 1024;
const KIND_RANKS = new Map(Object.keys(PART_KINDS).map((kind, rank) => [kind, rank]));

/**
 * The record that owns another for ordering: a model's author, and a route's or a deployment's
 * provider, so that a provider's records sit together.
 */
function owner(graph, kind, record) {
	if (kind === 'models') return record.authorId;
	if (kind === 'routes') return record.providerId;
	return graph.routes[Object.keys(record.routes)[0]]?.providerId ?? '';
}

/**
 * Splits a catalog into its root and parts. Each part's `json` is the exact file, which the root
 * names by SHA-256, size and the latest retirement date of its records.
 */
export function partitionCatalog(catalog) {
	const { graph, schedule } = catalog;
	const dates = retirementDates(graph);
	const dateOf = (kind, id) => dates[kind][id];
	const records = Object.keys(PART_KINDS).flatMap((kind) =>
		Object.entries(graph[kind]).map(([id, record]) => ({
			kind,
			id,
			date: dateOf(kind, id),
			owner: owner(graph, kind, record),
			// What the record adds to its part's file: its member, and its member of each schedule
			// entry that changes it with that entry's frame, which is at least the file's share because
			// records that change at the same start share one entry.
			weight:
				memberBytes(id, record) +
				schedule.reduce(
					(sum, { start, graph: changed }) =>
						Object.hasOwn(changed[kind] ?? {}, id)
							? sum + entryBytes(start, kind) + memberBytes(id, changed[kind][id])
							: sum,
					0
				)
		}))
	);
	records.sort(
		(left, right) =>
			Number(left.date !== null) - Number(right.date !== null) ||
			compare(left.date ?? '', right.date ?? '') ||
			KIND_RANKS.get(left.kind) - KIND_RANKS.get(right.kind) ||
			compare(left.owner, right.owner) ||
			compare(left.id, right.id)
	);
	const assignment = cut(records);
	const contents = Array.from({ length: records.length ? assignment.at(-1) + 1 : 0 }, () => ({
		graph: {},
		schedule: new Map(),
		through: null
	}));
	const partOf = Object.fromEntries(Object.keys(PART_KINDS).map((kind) => [kind, new Map()]));
	records.forEach(({ kind, id, date }, position) => {
		const content = contents[assignment[position]];
		(content.graph[kind] ??= {})[id] = graph[kind][id];
		if (date !== null && (content.through === null || date > content.through))
			content.through = date;
		partOf[kind].set(id, assignment[position]);
	});
	for (const { start, graph: changed } of schedule)
		for (const kind of Object.keys(PART_KINDS))
			for (const [id, record] of Object.entries(changed[kind] ?? {})) {
				const entries = contents[partOf[kind].get(id)].schedule;
				if (!entries.has(start)) entries.set(start, { start, graph: {} });
				(entries.get(start).graph[kind] ??= {})[id] = record;
			}
	const parts = contents.map(({ graph: held, schedule: entries }) =>
		file({ schema: CATALOG_PART_SCHEMA, graph: held, schedule: [...entries.values()] })
	);
	for (const { size } of parts)
		if (size > CATALOG_PART_LIMIT)
			throw new Error(`A catalog part is ${size} bytes; the limit is ${CATALOG_PART_LIMIT}.`);
	const summarize = (kind, id, record) =>
		recordSummary(kind, record, partOf[kind]?.get(id), dateOf(kind, id));
	const summaries = Object.fromEntries(
		CATALOG_KINDS.map((kind) => [
			kind,
			Object.fromEntries(
				Object.entries(graph[kind]).map(([id, record]) => [id, summarize(kind, id, record)])
			)
		])
	);
	const root = {
		schema: CATALOG_SCHEMA,
		locations: catalog.locations,
		summaries,
		parts: parts.map(({ sha256, size }, index) => ({
			sha256,
			size,
			through: contents[index].through
		})),
		periods: catalog.periods,
		// Every start stays, because parts can change where the root does not.
		schedule: schedule.map(({ start, graph: changed }) => {
			const differing = {};
			for (const kind of CATALOG_KINDS)
				for (const [id, record] of Object.entries(changed[kind] ?? {})) {
					const summary = summarize(kind, id, record);
					if (canonicalJson(summary) !== canonicalJson(summaries[kind][id]))
						(differing[kind] ??= {})[id] = summary;
				}
			return { start, summaries: differing };
		})
	};
	return { root, parts };
}

/** The earlier of two dates, either of which can be null. */
export function earliest(left, right) {
	return left === null || (right !== null && right < left) ? right : left;
}

/**
 * Each record's retirement date, by kind and ID, or null. A record retires with the last of the
 * records it exists for, once all of them have dates: a model or a route with its deployments, a
 * provider with its routes, an author with its models, and a group with the models in it and in
 * its child groups. A record without such records is listed on purpose, so it has no date of that
 * kind. A deployment retires on its own date, and a route on its own date if that comes first; the
 * build has applied the dates that a provider names for a route or for itself to the route and to
 * each deployment that it ends. Periods change neither dates nor edges, so every state has the
 * base graph's dates.
 */
export function retirementDates(graph) {
	const latest = (dates = []) =>
		dates.length && dates.every((date) => date !== null)
			? dates.reduce((later, date) => (date > later ? date : later))
			: null;
	// Each record's date from the dates of the records it exists for, listed by its ID.
	const dated = (kind, pairs) => {
		const members = new Map();
		for (const [id, date] of pairs) members.set(id, [...(members.get(id) ?? []), date]);
		return Object.fromEntries(Object.keys(graph[kind]).map((id) => [id, latest(members.get(id))]));
	};
	const deployments = Object.fromEntries(
		Object.entries(graph.deployments).map(([id, { retirementDate }]) => [id, retirementDate])
	);
	const models = dated(
		'models',
		Object.entries(graph.deployments).map(([id, { modelId }]) => [modelId, deployments[id]])
	);
	const routes = dated(
		'routes',
		Object.entries(graph.deployments).flatMap(([id, deployment]) =>
			Object.keys(deployment.routes).map((routeId) => [routeId, deployments[id]])
		)
	);
	for (const [id, route] of Object.entries(graph.routes))
		routes[id] = earliest(route.retirementDate ?? null, routes[id]);
	const providers = dated(
		'providers',
		Object.entries(graph.routes).map(([id, { providerId }]) => [providerId, routes[id]])
	);
	const authors = dated(
		'authors',
		Object.entries(graph.models).map(([id, { authorId }]) => [authorId, models[id]])
	);
	const groups = dated(
		'groups',
		Object.entries(graph.models).flatMap(([id, model]) =>
			ancestorGroupIds(graph.groups, model.groupIds).map((groupId) => [groupId, models[id]])
		)
	);
	return { authors, groups, models, providers, routes, deployments };
}

/** The part of each record, in order. */
function cut(records) {
	const frame = byteLength(canonicalJson({ schema: CATALOG_PART_SCHEMA, graph: {}, schedule: [] }));
	const parts = [];
	let part = 0;
	let size = 0;
	let kinds = new Set();
	let dated = false;
	for (const { kind, id, date, weight } of records) {
		// The first record of a kind in a part adds the kind's member too.
		const grows = () => weight + (kinds.has(kind) ? 0 : byteLength(JSON.stringify(kind)) + 3);
		if (
			size > 0 &&
			(isBoundary(kind, id, weight) ||
				frame + size + grows() > CATALOG_PART_LIMIT ||
				(date !== null && !dated))
		) {
			part += 1;
			size = 0;
			kinds = new Set();
		}
		dated ||= date !== null;
		parts.push(part);
		size += grows();
		kinds.add(kind);
	}
	return parts;
}

function file(value) {
	const json = canonicalJson(value);
	return { json, sha256: sha256(json), size: byteLength(json) };
}

// A member and the comma that can follow it.
function memberBytes(id, record) {
	return byteLength(JSON.stringify(id)) + 2 + byteLength(canonicalJson(record));
}

function entryBytes(start, kind) {
	return byteLength(canonicalJson({ start, graph: { [kind]: {} } })) + 1;
}

function isBoundary(kind, id, weight) {
	const hash = createHash('sha256').update(`${kind}\0${id}`).digest().readUInt32BE(0);
	return hash < (Math.min(weight, PART_BYTES) / PART_BYTES) * 2 ** 32;
}

function compare(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function byteLength(value) {
	return Buffer.byteLength(value);
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
