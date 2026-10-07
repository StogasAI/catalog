/** RFC 8785 payload followed by one LF for a JSON document file. */
export function canonicalJson(value) {
	return `${canonicalJsonValue(value)}\n`;
}

/** RFC 8785 payload bytes: no file newline is included in a document signature or identity. */
export function canonicalJsonValue(value) {
	return stringifyCanonical(value);
}

function stringifyCanonical(value) {
	if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) {
		throw new Error('Cannot canonicalize invalid Unicode.');
	}
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number.');
		return JSON.stringify(value);
	}
	if (Array.isArray(value))
		return `[${Array.from(value, (item) => stringifyCanonical(item)).join(',')}]`;
	if (typeof value === 'object') {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error('Cannot canonicalize a non-JSON object.');
		}
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${stringifyCanonical(key)}:${stringifyCanonical(Reflect.get(value, key))}`)
			.join(',')}}`;
	}
	throw new Error(`Cannot canonicalize ${typeof value}.`);
}
