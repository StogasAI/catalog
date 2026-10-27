/** RFC 8785 payload followed by one LF for a JSON document file. */
export function canonicalJson(value: unknown): string;

/** RFC 8785 payload bytes: no file newline is included in a document signature or identity. */
export function canonicalJsonValue(value: unknown): string;
