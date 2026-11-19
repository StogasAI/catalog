import type { CatalogPartFile } from './catalog-files.mjs';

type ReleaseArtifact = { sha256: string; size_bytes: number };

/** The release's one artifact, the catalog's root, which names every part. */
export const CATALOG_ROOT: 'catalog.json';
/** Where the build writes each part that the root names, by its SHA-256. */
export const CATALOG_PARTS_DIRECTORY: 'catalog.parts';

/**
 * Every part that a root names, after checking the root, each part and the root with every part.
 * Warns as the root or the whole nears its limit.
 */
export function catalogFileList(rootBytes: Uint8Array | string): CatalogPartFile[];

/** The release manifest of the built catalog at the checkout's commit. */
export function catalogManifest(
	repositoryRoot: string,
	sequence: number
): { source: { commit: string; tag: string } };

/** The staging build proof for a catalog release manifest and its root. */
export function stagingDevelopmentProvenance(manifest: {
	artifacts: Record<typeof CATALOG_ROOT, ReleaseArtifact>;
}): {
	_type: 'https://in-toto.io/Statement/v1';
	predicate: { environment: 'staging' };
	predicateType: 'https://stogas.ai/attestations/staging-development/v1';
	subject: { digest: { sha256: string }; name: string }[];
};
