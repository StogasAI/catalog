export function stableJson(value) {
	return `${canonicalJson(value)}\n`;
}

export function canonicalJson(value) {
	return JSON.stringify(stableValue(value));
}

function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, stableValue(value[key])])
	);
}
