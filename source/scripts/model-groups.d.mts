export type ModelGroup = {
	authorId: string;
	name: string;
	parentIds: string[];
};

export function orderModelGroups(groups: Record<string, ModelGroup>): Map<string, number>;
export function ancestorGroupIds(
	groups: Record<string, ModelGroup>,
	directIds: readonly string[]
): string[];
