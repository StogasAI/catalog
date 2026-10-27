type ReleaseArtifact = { sha256: string; size_bytes: number };

/** The largest size of each artifact that a release names, in bytes. */
export const CATALOG_ARTIFACT_LIMITS: Readonly<
	Record<'catalog.public.json' | 'catalog.runtime.json', number>
>;

/** The staging build proof for a catalog release manifest and its two artifacts. */
export function stagingDevelopmentProvenance(manifest: {
	artifacts: Record<'catalog.public.json' | 'catalog.runtime.json', ReleaseArtifact>;
}): {
	_type: 'https://in-toto.io/Statement/v1';
	predicate: { environment: 'staging' };
	predicateType: 'https://stogas.ai/attestations/staging-development/v1';
	subject: { digest: { sha256: string }; name: string }[];
};
