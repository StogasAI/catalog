/**
 * The public catalog is one file, which evidence approves, with every record that has not moved
 * to the archive. A deployment moves there once it retired on or before the release policy's
 * `archive_through` date, and a model with it once all its deployments have. The public catalog
 * names the archive by SHA-256 and size, or `null` while it is empty, so its digest covers both.
 */
export const PUBLIC_CATALOG_SCHEMA = 'stogas.catalog.public.v7';
export const CATALOG_ARCHIVE_SCHEMA = 'stogas.catalog.archive.v1';

/** The largest public catalog and archive, in bytes. Readers refuse larger ones unread. */
export const PUBLIC_CATALOG_LIMIT = 32 * 1024 * 1024;
export const CATALOG_ARCHIVE_LIMIT = 32 * 1024 * 1024;

/**
 * The catalog with the archived deployments and models beside the others. Archived records keep
 * their state on the day before they retired, and they reference only nodes that the catalog or
 * the archive holds.
 */
export function withArchive(catalog, archive) {
	if (archive?.schema !== CATALOG_ARCHIVE_SCHEMA) throw new Error('Catalog archive is invalid.');
	const { deployments, models } = catalog.graph;
	for (const [kind, active] of [
		['deployments', deployments],
		['models', models]
	])
		for (const id of Object.keys(archive.graph[kind]))
			if (Object.hasOwn(active, id)) throw new Error(`Archived ${kind} ${id} is also active.`);
	return {
		...catalog,
		graph: {
			...catalog.graph,
			deployments: { ...deployments, ...archive.graph.deployments },
			models: { ...models, ...archive.graph.models }
		}
	};
}
