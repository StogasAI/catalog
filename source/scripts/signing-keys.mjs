import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from './canonical-json.mjs';

export function catalogSigningKeys(environment) {
	if (environment !== 'staging' && environment !== 'prod') {
		throw new Error('CATALOG_PUBLICATION_ENVIRONMENT must be staging or prod.');
	}
	const name =
		environment === 'staging' ? 'catalog-staging-signing-keys.json' : 'catalog-signing-keys.json';
	return JSON.parse(readFileSync(new URL(`../../keys/${name}`, import.meta.url), 'utf8'));
}

export function catalogVerificationKeys(environment) {
	return { ...catalogSigningKeys('prod'), ...catalogSigningKeys(environment) };
}

export function verifyCatalogReleaseSignature(envelope, keys) {
	if (envelope?.schema !== 'stogas.release-evidence.v1') {
		throw new Error('Catalog release evidence schema is unsupported.');
	}
	try {
		const encodedKey = keys[envelope.signature.key_id];
		if (
			typeof encodedKey !== 'string' ||
			!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature.signature)
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
			key.asymmetricKeyType !== 'ed25519' ||
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
