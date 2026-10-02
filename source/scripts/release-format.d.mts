export function catalogManifest(
	repositoryRoot: string,
	sequenceInput: string | number
): {
	schema: 'stogas.catalog.release.v1';
	catalogSchema: 1;
	minimumGatewaySequence: number;
	sequence: number;
	public: string;
	runtime: string;
	source: { commit: string; repository: string; tag: string; tree: string };
};
