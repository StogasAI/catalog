export type ArchiveReference = { sha256: string; size_bytes: number };
export const catalogCollections: readonly [
	'authors',
	'groups',
	'models',
	'providers',
	'routes',
	'deployments'
];
export const catalogPublicSizeLimit: number;
export function parseArchiveReference(value: unknown): ArchiveReference;
export function mergeCatalogArchive<T extends { graph?: object }>(catalog: T, archive: unknown): T;
