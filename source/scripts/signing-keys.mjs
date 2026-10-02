import { createPublicKey, verify } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

export function catalogSigningKeys(environment, encodedKeys) {
	if (environment !== 'staging' && environment !== 'prod') {
		throw new Error('CATALOG_PUBLICATION_ENVIRONMENT must be staging or prod.');
	}
	// The publisher receives current authorization from its operator. A source
	// checkout must not permanently pin an online key that needs to rotate.
	if (typeof encodedKeys !== 'string' || encodedKeys.length > 4096)
		throw new Error('Current catalog signing authorization is required.');
	const keys = JSON.parse(encodedKeys);
	if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length !== 1)
		throw new Error('Exactly one current catalog signing key is required.');
	for (const [id, value] of Object.entries(keys)) {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof value !== 'string')
			throw new Error('Invalid current catalog signing key.');
		const bytes = Buffer.from(value, 'base64');
		const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
		if (
			bytes.length !== 1974 ||
			bytes.subarray(0, 22).toString('hex') !== '308207b2300b0609608648016503040312038207a100' ||
			key.export({ format: 'der', type: 'spki' }).toString('base64') !== value
		)
			throw new Error('Invalid current catalog signing key.');
	}
	return keys;
}

export function verifyCatalogReleaseSignature(envelope, keys) {
	if (envelope?.schema !== 'stogas.release-evidence.v1') {
		throw new Error('Catalog release evidence schema is unsupported.');
	}
	try {
		const encodedKey = keys[envelope.signature.key_id];
		if (
			typeof encodedKey !== 'string' ||
			!/^[A-Za-z0-9_-]{4412}$/.test(envelope.signature.signature)
		) {
			throw new Error();
		}
		const key = createPublicKey({
			key: Buffer.from(encodedKey, 'base64'),
			format: 'der',
			type: 'spki'
		});
		const signature = Buffer.from(envelope.signature.signature, 'base64url');
		if (
			Buffer.from(encodedKey, 'base64').length !== 1974 ||
			Buffer.from(encodedKey, 'base64').subarray(0, 22).toString('hex') !==
				'308207b2300b0609608648016503040312038207a100' ||
			signature.toString('base64url') !== envelope.signature.signature ||
			!verify(
				null,
				Buffer.from(`stogas signed document v1\n${canonicalJson(envelope.manifest)}`),
				key,
				signature
			)
		)
			throw new Error();
	} catch {
		throw new Error('Catalog release signature is invalid or its key is not trusted.');
	}
}
