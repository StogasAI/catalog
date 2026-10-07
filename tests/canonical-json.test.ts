import { describe, expect, test } from 'bun:test';
import { canonicalJson, canonicalJsonValue } from '../source/scripts/canonical-json.mjs';

describe('RFC 8785 encoding', () => {
	test('sorts numeric property names lexically and uses ECMAScript number formatting', () => {
		const value = { '2': -0, '10': [1e30, 4.5, 0.002, 1e-27], דּ: 'last', '😀': 'before' };
		const expected = '{"10":[1e+30,4.5,0.002,1e-27],"2":0,"😀":"before","דּ":"last"}';
		expect(canonicalJsonValue(value)).toBe(expected);
		expect(canonicalJson(value)).toBe(expected + '\n');
	});

	test('rejects values which cannot be signed as JSON without changing their meaning', () => {
		for (const value of [
			NaN,
			Infinity,
			undefined,
			1n,
			'\ud800',
			{ '\udfff': 1 },
			[undefined],
			Array(1),
			new Date(0)
		]) {
			expect(() => canonicalJsonValue(value)).toThrow();
		}
	});
});
