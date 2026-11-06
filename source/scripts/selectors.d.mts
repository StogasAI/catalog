/**
 * The form in which a request's model field matches a catalog ID: case ignored, and dots and
 * underscores read as hyphens, so `Claude-Opus-4.5` matches `claude-opus-4-5`.
 */
export function selectorKey(id: string): string;
