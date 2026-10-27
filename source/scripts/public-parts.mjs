import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import {
	PUBLIC_CATALOG_PART_SCHEMA,
	PUBLIC_CATALOG_SCHEMA,
	deploymentSummary
} from './public-catalog.mjs';

// Deployments go to parts in provider and ID order. A part ends before a deployment whose ID
// hash marks a boundary once its deployments take PART_MIN_BYTES, so adding or removing a
// deployment changes only the parts around it and other parts keep their digests, and it ends
// before its file would pass PART_MAX_BYTES unless one deployment alone passes it.
export const PART_MIN_BYTES = 128 * 1024;
export const PART_MAX_BYTES = 512 * 1024;
const BOUNDARY_ONE_IN = 64;

/**
 * Splits a whole public catalog into its root and parts. Each part's `json` is the exact file;
 * the root names each by SHA-256 and size.
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
	const frame = byteLength(
		canonicalJson({ schema: PUBLIC_CATALOG_PART_SCHEMA, deployments: {}, schedule: [] })
	);
	const assignment = new Map();
	let part = 0;
	let size = 0;
	for (const id of ids) {
		const weight = weights.get(id);
		if (
			size > 0 &&
			((size >= PART_MIN_BYTES && isBoundary(id)) || frame + size + weight > PART_MAX_BYTES)
		) {
			part += 1;
			size = 0;
		}
		assignment.set(id, part);
		size += weight;
	}
	const contents = Array.from({ length: ids.length ? part + 1 : 0 }, () => ({
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
	const parts = contents.map((content) => {
		const json = canonicalJson({ schema: PUBLIC_CATALOG_PART_SCHEMA, ...content });
		return { json, sha256: sha256(json), size: byteLength(json) };
	});
	const summaries = Object.fromEntries(
		ids.map((id) => [id, deploymentSummary(deployments[id], assignment.get(id))])
	);
	const root = {
		schema: PUBLIC_CATALOG_SCHEMA,
		graph: { ...catalog.graph, deployments: summaries },
		parts: parts.map(({ sha256, size }) => ({ sha256, size })),
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
