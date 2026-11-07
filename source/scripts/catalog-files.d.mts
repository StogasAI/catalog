import type { Locations } from './locations.mjs';

export const CATALOG_SCHEMA: 'stogas.catalog.v12';
export const CATALOG_PART_SCHEMA: 'stogas.catalog.part.v12';
/**
 * A root or part of the previous format as one of the current format. The formats differ only in
 * their schema names, so the previous format's facts keep their meaning. Any other value comes back
 * as it is, for the reader to check.
 */
export function currentCatalogFile(value: unknown): unknown;
export const CATALOG_KINDS: readonly [
	'authors',
	'groups',
	'models',
	'providers',
	'routes',
	'deployments'
];
/** The kinds whose records the root holds whole. */
export const WHOLE_KINDS: readonly ['authors', 'groups', 'providers'];
/** The kinds whose records parts hold, and the record fields that their summaries repeat. */
export const PART_KINDS: Readonly<Record<PartKind, readonly string[]>>;
export const CATALOG_ROOT_LIMIT: number;
export const CATALOG_PART_LIMIT: number;
export const CATALOG_LIMIT: number;

export type CatalogKind = (typeof CATALOG_KINDS)[number];
export type WholeKind = (typeof WHOLE_KINDS)[number];
export type PartKind = 'models' | 'routes' | 'deployments';

type Nodes = Record<string, object>;

/**
 * When a record that retires on `date` stops serving, in milliseconds: once the date has ended
 * everywhere on Earth, at 12:00 UTC on the next day.
 */
export function retiredFrom(date: string): number;
/** Whether a record that retires on `date`, or never when null, has retired at `at`. */
export function isRetired(date: string | null | undefined, at?: Date | number): boolean;

/**
 * A part that the root names: the SHA-256 of its bytes in hex, its size, the latest retirement
 * date of its records, or null when one of them has none, and whether it holds the records that
 * Stogas does not serve.
 */
export type CatalogPartFile = {
	sha256: string;
	size: number;
	through: string | null;
	stogasUnsupported: boolean;
};

/** Why Stogas does not serve a record; a record that it serves has none. */
type Unsupported = { stogasUnsupported?: string };
type Summary = { part: number; retirementDate: string | null } & Unsupported;
export type ModelSummary = Summary & {
	aliases: string[];
	authorId: string;
	derivedFrom?: string[];
	groupIds: string[];
	name: string;
	releaseDate: string;
};
export type RouteSummary = Summary & { interfaces: string[]; providerId: string };
export type DeploymentSummary = Summary & { modelId: string; routeIds: string[] };
/**
 * An author, group or provider: its whole record, its retirement date, and why Stogas does not
 * serve it when it does not.
 */
export type WholeSummary = Record<string, unknown> & {
	retirementDate: string | null;
} & Unsupported;

export type CatalogSummaries = {
	authors: Record<string, WholeSummary>;
	groups: Record<string, WholeSummary>;
	models: Record<string, ModelSummary>;
	providers: Record<string, WholeSummary>;
	routes: Record<string, RouteSummary>;
	deployments: Record<string, DeploymentSummary>;
};

/**
 * The root: the locations, a summary of every record, the parts that hold the records of models,
 * routes and deployments, the dated periods, and for each scheduled state the summaries that
 * differ.
 */
export type CatalogRoot = {
	schema: typeof CATALOG_SCHEMA;
	locations: Locations;
	summaries: CatalogSummaries;
	parts: CatalogPartFile[];
	periods: object[];
	schedule: { start: string; summaries: Partial<CatalogSummaries> }[];
};

export type CatalogPart = {
	schema: typeof CATALOG_PART_SCHEMA;
	graph: Partial<Record<PartKind, Nodes>>;
	schedule: { start: string; graph: Partial<Record<PartKind, Nodes>> }[];
};

/**
 * A catalog from a root and the parts that a reader read: every whole record and each record of
 * the parts read, with the root's summaries of every record and the positions of the parts read.
 * Each schedule entry keeps the root's summaries that differ then, and the records read that do.
 */
export type Catalog = {
	schema: typeof CATALOG_SCHEMA;
	locations: Locations;
	parts: CatalogPartFile[];
	read: number[];
	periods: object[];
	summaries: CatalogSummaries;
	graph: Record<CatalogKind, Nodes>;
	schedule: {
		start: string;
		summaries: Partial<CatalogSummaries>;
		graph: Partial<Record<CatalogKind, Nodes>>;
	}[];
};

/** What the root keeps of a record that a part holds, or of a whole record. */
export function recordSummary(
	kind: CatalogKind,
	record: object,
	part: number | undefined,
	retirementDate: string | null,
	stogasUnsupported?: string | null
): object;

/**
 * Each part that a root of `rootSize` bytes names, after checking each name, size and date and the
 * size of the root with every part. Throws when one fails.
 */
export function checkedCatalogFiles(root: unknown, rootSize: number): CatalogPartFile[];

/**
 * The positions of the parts that hold a record that has not retired at `at`. Without
 * `unsupported`, it leaves out the parts of the records that Stogas does not serve.
 */
export function partsInEffect(
	root: { parts: readonly CatalogPartFile[] },
	at?: Date | number,
	options?: { unsupported?: boolean }
): number[];

/** The positions of the parts that hold the records of the given kinds and IDs, once each. */
export function partsOfRecords(
	root: { summaries: { [Kind in PartKind]?: Record<string, { part: number }> } },
	records: Iterable<readonly [PartKind, string]>
): number[];

/**
 * The catalog from a root and the parts that a reader read, null for each part not read. Work
 * grows with the parts read, not the root. Throws when a part does not match the root.
 * `Assembled` names the caller's own type for the result.
 */
export function assembleCatalog<Assembled = Catalog>(
	root: CatalogRoot,
	parts: readonly (CatalogPart | null | undefined)[]
): Assembled;
