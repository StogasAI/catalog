// The gateway reads a request's model field in the same form, so build checks and search agree with it.
export function selectorKey(id) {
	return id.toLowerCase().replaceAll(/[._]/gu, '-');
}
