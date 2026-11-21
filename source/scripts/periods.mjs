import { canonicalJson } from './canonical-json.mjs';

const nodeKinds = ['authors', 'groups', 'models', 'providers', 'routes', 'deployments'];

// A period changes facts about a node, never its identity, its edges, when it retires or whether
// Stogas serves it, so every dated state has the same nodes, selectors and links as the base
// graph, and each record has one retirement date and one answer to whether Stogas serves it.
const structuralFields = new Set([
	'aliases',
	'authorId',
	'groupIds',
	'modelId',
	'parentIds',
	'periods',
	'providerId',
	'retirementDate',
	'routeIds',
	'stogasByok',
	'stogasManaged'
]);

/**
 * Splits source periods into the base graph, which has no periods, and one complete graph
 * for each instant at which a period starts or ends. A state lasts until the next one.
 * The index names each period and its node, which the states alone cannot say.
 */
export function periodStates(graph) {
	const base = {};
	const periods = [];
	for (const kind of nodeKinds) {
		base[kind] = {};
		for (const [id, node] of Object.entries(graph[kind] ?? {})) {
			const { periods: nodePeriods = [], ...facts } = node;
			base[kind][id] = facts;
			periods.push(...validatePeriods(kind, id, facts, nodePeriods));
		}
	}
	const boundaries = [
		...new Set(periods.flatMap(({ start, end }) => [start, end]).filter(Number.isFinite))
	].sort((left, right) => left - right);
	const states = boundaries.map((at) => {
		const state = Object.fromEntries(nodeKinds.map((kind) => [kind, { ...base[kind] }]));
		for (const period of periods) {
			if (period.start <= at && at < period.end) {
				state[period.kind][period.id] = applyPeriod(state[period.kind][period.id], period);
			}
		}
		return { start: timestamp(at), graph: state };
	});
	const index = periods
		.sort(
			(left, right) =>
				left.start - right.start ||
				nodeKinds.indexOf(left.kind) - nodeKinds.indexOf(right.kind) ||
				(left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
		)
		.map(({ kind, id, name, start, end }) => ({
			kind,
			id,
			name,
			start: timestamp(start),
			end: Number.isFinite(end) ? timestamp(end) : null
		}));
	return { base, states, periods: index };
}

function validatePeriods(kind, id, node, periods) {
	const checked = periods.map((period, index) => {
		const owner = `${kind}.${id}.periods[${index}]`;
		const start = instant(period.start, owner);
		const end = period.end === undefined ? Infinity : instant(period.end, owner);
		if (end <= start) throw new Error(`${owner} must end after it starts`);
		const set = period.set ?? {};
		const unset = period.unset ?? [];
		const paths = [...Object.keys(set), ...unset].sort();
		if (paths.length === 0) throw new Error(`${owner} changes nothing`);
		for (const [position, path] of paths.entries()) {
			if (structuralFields.has(path.split('.')[0])) {
				throw new Error(`${owner} cannot change ${path}; add or edit nodes instead`);
			}
			const inside = paths.slice(position + 1).find((other) => nested(path, other));
			if (inside !== undefined) throw new Error(`${owner} changes both ${path} and ${inside}`);
		}
		for (const [path, value] of Object.entries(set)) {
			const current = valueAt(node, path, owner);
			if (current !== undefined && canonicalJson(current) === canonicalJson(value)) {
				throw new Error(`${owner} sets ${path} to the value it already has`);
			}
		}
		for (const path of unset) {
			if (valueAt(node, path, owner) === undefined) {
				throw new Error(`${owner} unsets ${path}, which the node does not have`);
			}
		}
		return { owner, paths, period: { kind, id, name: period.name, start, end, set, unset } };
	});
	// Periods of a node can run at the same time when they change different fields, so each field
	// has one value at every instant, whatever order the periods apply in. A price that two reasons
	// change at once is a period of its own, because only its provider says how the two combine.
	for (const [index, { owner, paths, period }] of checked.entries()) {
		for (const other of checked.slice(0, index)) {
			if (period.start >= other.period.end || other.period.start >= period.end) continue;
			for (const path of paths) {
				const shared = other.paths.find((otherPath) => nested(path, otherPath));
				if (shared !== undefined) {
					throw new Error(`${owner} changes ${path} while ${other.owner} changes ${shared}`);
				}
			}
		}
	}
	return checked.map(({ period }) => period);
}

// Two paths name the same value, or one value holds the other.
function nested(left, right) {
	return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function applyPeriod(node, { set, unset }) {
	const result = structuredClone(node);
	for (const [path, value] of Object.entries(set)) {
		const keys = path.split('.');
		let target = result;
		for (const key of keys.slice(0, -1)) {
			if (!Object.hasOwn(target, key)) target[key] = {};
			target = target[key];
		}
		target[keys.at(-1)] = structuredClone(value);
	}
	for (const path of unset) {
		const keys = path.split('.');
		let target = result;
		for (const key of keys.slice(0, -1)) target = target[key];
		delete target[keys.at(-1)];
	}
	return result;
}

// Returns undefined for a missing field; a path may not pass through a list or a scalar.
function valueAt(node, path, owner) {
	let value = node;
	for (const key of path.split('.')) {
		if (value === undefined) return undefined;
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(`${owner}: ${path} passes through a value that is not an object`);
		}
		value = Object.hasOwn(value, key) ? value[key] : undefined;
	}
	return value;
}

function instant(value, owner) {
	const at = Date.parse(value);
	if (Number.isNaN(at) || timestamp(at) !== value) {
		throw new Error(`${owner} has an invalid time ${value}`);
	}
	return at;
}

function timestamp(at) {
	return new Date(at).toISOString().replace('.000Z', 'Z');
}
