import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
	CATALOG_ARCHIVE_INDEX_SCHEMA,
	CATALOG_ARCHIVE_PART_SCHEMA,
	PUBLIC_CATALOG_PART_SCHEMA,
	PUBLIC_CATALOG_SCHEMA,
	deploymentSummary
} from './public-catalog.mjs';

// Records go to parts in a fixed order: deployments by provider and ID, and archived records by
// the day they retired, kind and ID, so a release that archives more records adds parts after
// the others. A part ends before a record whose ID hash marks a boundary once its records take
// PART_MIN_BYTES, so adding or removing a record changes only the parts around it and other
// parts keep their digests, and it ends before its file would pass PART_MAX_BYTES unless one
// record alone passes it.
export const PART_MIN_BYTES = 128 * 1024;
export const PART_MAX_BYTES = 512 * 1024;
const BOUNDARY_ONE_IN = 64;

/**
 * Splits a public catalog into its root and parts. Each part's `json` is the exact file; the
 * root names each by SHA-256 and size, and the build adds the archive.
 */
export function partitionPublicCatalog(catalog) {
	const { deployments, routes } = catalog.graph;
	// Every route of a deployment belongs to its provider.
	const provider = (id) => routes[Object.keys(deployments[id].routes)[0]]?.providerId ?? '';
	const ids = Object.keys(deployments).sort(
		(left, right) => compare(provider(left), provider(right)) || compare(left, right)
	);
	// What each deployment adds to its part's file: its member of `deployments`, and its member of
	// each schedule entry that changes it with that entry's frame, which is at least the file's
	// share because deployments that change at the same start share one entry.
	const weights = new Map(ids.map((id) => [id, memberBytes(id, deployments[id])]));
	for (const { start, graph } of catalog.schedule)
		for (const [id, record] of Object.entries(graph.deployments ?? {}))
			weights.set(id, weights.get(id) + entryBytes(start) + memberBytes(id, record));
	const cuts = cut(
		ids.map((id) => [id, weights.get(id)]),
		{ schema: PUBLIC_CATALOG_PART_SCHEMA, deployments: {}, schedule: [] }
	);
	const assignment = new Map(ids.map((id, position) => [id, cuts[position]]));
	const contents = Array.from({ length: ids.length ? cuts.at(-1) + 1 : 0 }, () => ({
		deployments: {},
		schedule: []
	}));
	for (const id of ids) contents[assignment.get(id)].deployments[id] = deployments[id];
	for (const { start, graph } of catalog.schedule) {
		const entries = new Map();
		for (const [id, record] of Object.entries(graph.deployments ?? {})) {
			const index = assignment.get(id);
			if (!entries.has(index)) {
				entries.set(index, { start, deployments: {} });
				contents[index].schedule.push(entries.get(index));
			}
			entries.get(index).deployments[id] = record;
		}
	}
	const parts = contents.map((content) => file({ schema: PUBLIC_CATALOG_PART_SCHEMA, ...content }));
	const summaries = Object.fromEntries(
		ids.map((id) => [id, deploymentSummary(deployments[id], assignment.get(id))])
	);
	const root = {
		schema: PUBLIC_CATALOG_SCHEMA,
		graph: { ...catalog.graph, deployments: summaries },
		parts: parts.map(reference),
		periods: catalog.periods,
		// Every start stays, because parts can change when the root does not.
		schedule: catalog.schedule.map(({ start, graph }) => {
			const { deployments: changed = {}, ...nodes } = graph;
			const differing = Object.entries(changed).flatMap(([id, record]) => {
				const summary = deploymentSummary(record, assignment.get(id));
				return canonicalJson(summary) === canonicalJson(summaries[id]) ? [] : [[id, summary]];
			});
			return {
				start,
				graph: differing.length ? { ...nodes, deployments: Object.fromEntries(differing) } : nodes
			};
		})
	};
	return { root, parts };
}

/**
 * Splits the archive into its index and parts, or returns null while it is empty. The index
 * summarizes each deployment as the root does, and gives each model its aliases and the day its
 * last deployment retired, so pages can place an archived record and resolve an alias before
 * they read its part.
 */
export function partitionCatalogArchive(archive) {
	const retired = { deployments: new Map(), models: new Map() };
	for (const [id, { modelId, retirementDate }] of Object.entries(archive.deployments)) {
		retired.deployments.set(id, retirementDate);
		if (!(retired.models.get(modelId) >= retirementDate))
			retired.models.set(modelId, retirementDate);
	}
	const records = Object.entries(archive)
		.flatMap(([kind, nodes]) => Object.keys(nodes).map((id) => [kind, id]))
		.sort(
			([leftKind, left], [rightKind, right]) =>
				compare(retired[leftKind].get(left), retired[rightKind].get(right)) ||
				compare(leftKind, rightKind) ||
				compare(left, right)
		);
	if (!records.length) return null;
	const assignment = cut(
		records.map(([kind, id]) => [id, memberBytes(id, archive[kind][id])]),
		{ schema: CATALOG_ARCHIVE_PART_SCHEMA, deployments: {}, models: {} }
	);
	const contents = Array.from({ length: assignment.at(-1) + 1 }, () => ({
		deployments: {},
		models: {}
	}));
	const index = { schema: CATALOG_ARCHIVE_INDEX_SCHEMA, deployments: {}, models: {} };
	records.forEach(([kind, id], position) => {
		const part = assignment[position];
		const record = archive[kind][id];
		contents[part][kind][id] = record;
		index[kind][id] =
			kind === 'deployments'
				? deploymentSummary(record, part)
				: { aliases: record.aliases, part, retirementDate: retired.models.get(id) };
	});
	return {
		index: file(index),
		parts: contents.map((content) => file({ schema: CATALOG_ARCHIVE_PART_SCHEMA, ...content }))
	};
}

/** The part of each record, in order, from its ID and the bytes it adds to a part's file. */
function cut(records, emptyPart) {
	const frame = byteLength(canonicalJson(emptyPart));
	const parts = [];
	let part = 0;
	let size = 0;
	for (const [id, weight] of records) {
		if (
			size > 0 &&
			((size >= PART_MIN_BYTES && isBoundary(id)) || frame + size + weight > PART_MAX_BYTES)
		) {
			part += 1;
			size = 0;
		}
		parts.push(part);
		size += weight;
	}
	return parts;
}

function file(value) {
	const json = canonicalJson(value);
	return { json, sha256: sha256(json), size: byteLength(json) };
}

function reference({ sha256, size }) {
	return { sha256, size };
}

// A member and the comma that can follow it.
function memberBytes(id, record) {
	return byteLength(JSON.stringify(id)) + 2 + byteLength(canonicalJson(record));
}

function entryBytes(start) {
	return byteLength(canonicalJson({ start, deployments: {} })) + 1;
}

function isBoundary(id) {
	return createHash('sha256').update(id).digest().readUInt32BE(0) % BOUNDARY_ONE_IN === 0;
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
