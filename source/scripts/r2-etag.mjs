export function r2WriteConditionETag(etag) {
	if (typeof etag !== 'string') return etag;
	return /^W\/"[^"]+"$/.test(etag) ? etag.slice(2) : etag;
}
