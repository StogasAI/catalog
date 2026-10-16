export type ScheduleEntry<G> = {
	start: string;
	graph: { [K in keyof G]?: G[K] };
};

/** `at` is a Date or milliseconds since the epoch; it defaults to now. */
export function catalogAt<G extends { [K in keyof G]?: Record<string, unknown> }>(
	catalog: { graph: G; schedule: readonly ScheduleEntry<G>[] },
	at?: Date | number
): G;
