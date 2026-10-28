import { expect } from 'bun:test';

type Catalog = {
	graph: {
		authors: Record<string, unknown>;
		deployments: Record<string, Record<string, unknown> & { routes: Record<string, unknown> }>;
		models: Record<string, Record<string, unknown>>;
		providers: Record<string, Record<string, unknown>>;
		routes: Record<string, Record<string, unknown> & { providerId: string }>;
	};
};

export type DataHandlingContract = {
	processingLocation: string;
	storageLocation: string;
	endToEndEncrypted: boolean;
	retentionDays: number | null;
	trainingUse: boolean;
	zeroDataRetention: boolean;
	tee: boolean;
	teeVerified: boolean;
};

type ProviderRouteContract = {
	capabilities?: Record<string, boolean>;
	dataHandling?: Partial<DataHandlingContract>;
	documentFormats: { extensions: string[]; mediaTypes: string[] };
	endpoint?: string;
	id: string;
	inputModalities: string[];
	interfaces: string[];
	pricing?: Record<string, Record<string, string>>;
};

export type ProviderDeploymentContract = {
	approvalRequired?: boolean;
	authorId: string;
	// What every route of the deployment serves.
	capabilities: Record<string, boolean>;
	contextWindowTokens: number;
	dataHandling?: DataHandlingContract;
	id: string;
	// The model's input modalities; each route keeps those it carries.
	inputModalities: string[];
	maxOutputTokens: number;
	modelContextWindowTokens?: number;
	modelId: string;
	modelMaxOutputTokens?: number;
	modelReasoningEfforts?: string[];
	modelReasoning?: 'optional' | 'required' | 'unsupported';
	modelReasoningMaxTokens?: { maximum: number; minimum: number } | null;
	outputModalities: string[];
	pricing: Record<string, Record<string, string>>;
	reasoningEfforts?: string[];
	reasoningEffortsByRoute?: Record<string, string[]>;
	reasoningMaxTokens?: { maximum: number; minimum: number } | null;
	retirementDate: string | null;
	routeIds: string[];
	upstream: Record<string, number | string>;
	weightPrecision?: string;
};

export type ProviderOnboardingContract = {
	provider: {
		aliases: string[];
		capabilities: Record<string, boolean>;
		credentialModes: Array<'managed' | 'byok'>;
		dataHandling: DataHandlingContract;
		headquarteredCountry?: string;
		id: string;
		name: string;
	};
	deployments: ProviderDeploymentContract[];
	routes: ProviderRouteContract[];
};

export function assertProviderOnboardingContract(
	catalog: Catalog,
	contract: ProviderOnboardingContract
) {
	const { graph } = catalog;
	const providerId = contract.provider.id;
	const providerRoutes = Object.entries(graph.routes)
		.filter(([, route]) => route.providerId === providerId)
		.map(([id]) => id)
		.sort();
	expect(providerRoutes).toEqual(contract.routes.map(({ id }) => id).sort());
	const provider = {
		aliases: contract.provider.aliases,
		credentialModes: contract.provider.credentialModes,
		name: contract.provider.name,
		...(contract.provider.headquarteredCountry
			? { headquarteredCountry: contract.provider.headquarteredCountry }
			: {})
	};
	expect(graph.providers[providerId]).toEqual(provider);

	const routes = new Map(contract.routes.map((route) => [route.id, route]));
	const routeHandling = (route: ProviderRouteContract) => ({
		...contract.provider.dataHandling,
		...route.dataHandling
	});
	for (const route of contract.routes) {
		expect(graph.routes[route.id]).toEqual({
			capabilities: { ...contract.provider.capabilities, ...route.capabilities },
			dataHandling: routeHandling(route),
			documentFormats: route.documentFormats,
			...(route.endpoint ? { endpoint: route.endpoint } : {}),
			inputModalities: route.inputModalities,
			interfaces: route.interfaces,
			pricing: route.pricing ?? {},
			providerId
		});
	}

	const deploymentIds = Object.entries(graph.deployments)
		.filter(([, deployment]) =>
			Object.keys(deployment.routes).some((routeId) => providerRoutes.includes(routeId))
		)
		.map(([id]) => id)
		.sort();
	expect(deploymentIds).toEqual(contract.deployments.map(({ id }) => id).sort());

	for (const expected of contract.deployments) {
		const servedRoutes = Object.fromEntries(
			[...expected.routeIds].sort().map((routeId) => {
				const route = routes.get(routeId);
				if (!route) throw new Error(`${expected.id}: unknown contract route ${routeId}`);
				return [
					routeId,
					{
						capabilities: expected.capabilities,
						dataHandling: expected.dataHandling ?? routeHandling(route),
						inputModalities: expected.inputModalities.filter((modality) =>
							route.inputModalities.includes(modality)
						),
						pricing: { ...route.pricing, ...expected.pricing },
						reasoningEfforts:
							expected.reasoningEffortsByRoute?.[routeId] ??
							expected.reasoningEfforts ??
							expected.modelReasoningEfforts ??
							[]
					}
				];
			})
		);
		const deployment = {
			approvalRequired: expected.approvalRequired ?? false,
			contextWindowTokens: expected.contextWindowTokens,
			maxInputTokens: expected.contextWindowTokens,
			maxOutputTokens: expected.maxOutputTokens,
			modelId: expected.modelId,
			outputModalities: expected.outputModalities,
			reasoning: expected.modelReasoning ?? 'unsupported',
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			retirementDate: expected.retirementDate,
			routes: servedRoutes,
			upstream: expected.upstream,
			weightPrecision: expected.weightPrecision ?? 'unknown'
		};
		expect(graph.deployments[expected.id]).toEqual({
			...deployment,
			routes: Object.fromEntries(
				Object.entries(servedRoutes).map(([routeId, route]) => [
					routeId,
					{ ...route, chainHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }
				])
			)
		});

		expect(graph.models[expected.modelId]).toMatchObject({
			authorId: expected.authorId,
			contextWindowTokens: expected.modelContextWindowTokens ?? expected.contextWindowTokens,
			inputModalities: expected.inputModalities,
			maxOutputTokens: expected.modelMaxOutputTokens ?? expected.maxOutputTokens,
			outputModalities: expected.outputModalities,
			reasoningEfforts: expected.modelReasoningEfforts ?? [],
			reasoning: expected.modelReasoning ?? 'unsupported',
			reasoningMaxTokens: expected.modelReasoningMaxTokens ?? null
		});
		expect(graph.authors[expected.authorId]).toBeDefined();
	}
}
