// Groups describe an author's naming structure. They never supply execution facts.
export function orderModelGroups(groups) {
	const remaining = new Map();
	const children = new Map();
	for (const id of Object.keys(groups).sort()) {
		const parents = groups[id].parentIds;
		if (!Array.isArray(parents) || new Set(parents).size !== parents.length) {
			throw new Error(`Group ${id}: parentIds must be a unique list`);
		}
		remaining.set(id, parents.length);
		for (const parent of parents) {
			if (!Object.hasOwn(groups, parent)) throw new Error(`Group ${id}: missing parent ${parent}`);
			const siblings = children.get(parent) ?? [];
			siblings.push(id);
			children.set(parent, siblings);
		}
	}
	const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
	const depths = new Map();
	for (let index = 0; index < ready.length; index++) {
		const id = ready[index];
		let depth = 1;
		for (const parent of groups[id].parentIds) depth = Math.max(depth, depths.get(parent) + 1);
		depths.set(id, depth);
		for (const child of children.get(id) ?? []) {
			const count = remaining.get(child) - 1;
			remaining.set(child, count);
			if (count === 0) ready.push(child);
		}
	}
	if (depths.size !== remaining.size) throw new Error('Model groups must be acyclic');
	return depths;
}

export function ancestorGroupIds(groups, directIds) {
	const ids = new Set();
	const pending = [...directIds];
	while (pending.length) {
		const id = pending.pop();
		if (ids.has(id)) continue;
		const group = Object.hasOwn(groups, id) ? groups[id] : null;
		if (!group) throw new Error(`Missing model group ${id}`);
		ids.add(id);
		for (const parent of group.parentIds) pending.push(parent);
	}
	return [...orderModelGroups(Object.fromEntries([...ids].map((id) => [id, groups[id]]))).keys()];
}
