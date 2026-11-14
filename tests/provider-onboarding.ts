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
	trainingUse: boolean | null;
	zeroDataRetention: boolean;
	tee: boolean;
	teeVerified: boolean;
	/** The companies, other than the provider's and the hosting, that receive requests. */
	sharedWith?: string[];
};

export type ProviderRouteContract = {
	capabilities?: Record<string, boolean>;
	dataHandling?: Partial<DataHandlingContract>;
	documentFormats: { extensions: string[]; mediaTypes: string[] };
	endpoint?: string;
	id: string;
	inputModalities: string[];
	interfaces: string[];
	/** The route is a batch API. */
	batch?: true;
	hostedTools?: HostedToolContract[];
	/** Stogas does not serve the route or its deployments. */
	stogasSupported?: false;
	notes?: string;
};

type HostedToolContract = {
	dataHandling: Partial<DataHandlingContract>;
	pricing?: Record<string, Record<string, string>>;
	tool: 'mcp' | 'web_fetch' | 'web_search';
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
	// Omitted when the input ceiling is the context window.
	maxInputTokens?: number;
	maxOutputTokens: number;
	modelContextWindowTokens?: number;
	modelId: string;
	modelMaxOutputTokens?: number;
	modelReasoningEfforts?: string[];
	modelReasoning?: 'optional' | 'required' | 'unsupported';
	modelReasoningMaxTokens?: { maximum: number; minimum: number } | null;
	/** The company that runs the model, or unknown. */
	hosting: string;
	/** The companies, other than the provider's and the hosting, that receive its requests. */
	sharedWith?: string[];
	notes?: string;
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
		companyId: string;
		headquarteredCountry: string;
		id: string;
		name: string;
	};
	deployments: ProviderDeploymentContract[];
	/**
	 * Deployments that Anthropic runs on the provider's cloud. Each serves what Anthropic's own
	 * deployment of the same upstream model, tier and inference geography serves, on a batch route
	 * when it is on one, with the data handling that the cloud changes.
	 */
	anthropicHosted?: string[];
	anthropicHostedDataHandling?: Partial<DataHandlingContract>;
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
		companyId: contract.provider.companyId,
		headquarteredCountry: contract.provider.headquarteredCountry,
		notes: []
	};
	expect(graph.providers[providerId]).toEqual(provider);

	const routes = new Map(contract.routes.map((route) => [route.id, route]));
	const routeNotes = (route: ProviderRouteContract) =>
		route.notes === undefined ? [] : [{ kind: 'route', id: route.id, text: route.notes }];
	const routeHandling = (route: ProviderRouteContract) => ({
		sharedWith: [],
		...contract.provider.dataHandling,
		...route.dataHandling
	});
	for (const route of contract.routes) {
		expect(graph.routes[route.id]).toEqual({
			capabilities: { ...contract.provider.capabilities, ...route.capabilities },
			dataHandling: routeHandling(route),
			documentFormats: route.documentFormats,
			endpoint: route.endpoint ?? null,
			inputModalities: route.inputModalities,
			interfaces: route.interfaces,
			batch: route.batch === true,
			hostedTools: (route.hostedTools ?? []).map((offer) => ({ dataHandling: {}, ...offer })),
			providerId,
			retirementDate: null,
			stogasSupported: route.stogasSupported !== false,
			notes: routeNotes(route)
		});
	}

	const deploymentIds = Object.entries(graph.deployments)
		.filter(([, deployment]) =>
			Object.keys(deployment.routes).some((routeId) => providerRoutes.includes(routeId))
		)
		.map(([id]) => id)
		.sort();
	expect(deploymentIds).toEqual(
		[...contract.deployments.map(({ id }) => id), ...(contract.anthropicHosted ?? [])].sort()
	);
	const batch = (deployment: { routes: Record<string, unknown> }) =>
		Object.keys(deployment.routes).some((routeId) => graph.routes[routeId]?.batch === true);
	for (const id of contract.anthropicHosted ?? []) {
		const copy = graph.deployments[id] as Record<string, unknown> & {
			routes: Record<string, { chainHash: string }>;
			upstream: Record<string, string>;
		};
		expect(copy.hosting).toBe('anthropic');
		const sorted = (upstream: unknown) =>
			JSON.stringify(Object.entries(upstream as object).sort(([a], [b]) => a.localeCompare(b)));
		const sources = Object.entries(graph.deployments).filter(
			([, deployment]) =>
				sorted(deployment.upstream) === sorted(copy.upstream) &&
				batch(deployment) === batch(copy) &&
				Object.keys(deployment.routes).every(
					(routeId) => graph.routes[routeId]?.providerId === 'anthropic'
				)
		);
		expect(sources.map(([sourceId]) => sourceId)).toHaveLength(1);
		const [, source] = sources[0]!;
		// Route IDs, chain hashes and notes name the provider; everything that the routes serve
		// matches, except the data handling that the cloud changes.
		const served = (deployment: typeof copy, dataHandling = {}) => ({
			...deployment,
			notes: undefined,
			routes: Object.values(deployment.routes).map(({ chainHash: _, ...route }) => ({
				...route,
				dataHandling: { ...(route as { dataHandling: object }).dataHandling, ...dataHandling }
			})),
			upstream: undefined
		});
		expect(served(copy)).toEqual(
			served(source as typeof copy, contract.anthropicHostedDataHandling)
		);
	}

	for (const expected of contract.deployments) {
		const servedRoutes = Object.fromEntries(
			[...expected.routeIds].sort().map((routeId) => {
				const route = routes.get(routeId);
				if (!route) throw new Error(`${expected.id}: unknown contract route ${routeId}`);
				const offers = route.hostedTools ?? [];
				return [
					routeId,
					{
						capabilities: expected.capabilities,
						dataHandling: {
							...routeHandling(route),
							...expected.dataHandling,
							...(expected.sharedWith && { sharedWith: expected.sharedWith })
						},
						inputModalities: expected.inputModalities.filter((modality) =>
							route.inputModalities.includes(modality)
						),
						hostedTools: Object.fromEntries(
							offers.map((offer) => [
								offer.tool,
								{ dataHandling: offer.dataHandling, pricing: offer.pricing ?? {} }
							])
						),
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
			maxInputTokens: expected.maxInputTokens ?? expected.contextWindowTokens,
			maxOutputTokens: expected.maxOutputTokens,
			modelId: expected.modelId,
			hosting: expected.hosting,
			outputModalities: expected.outputModalities,
			pricing: expected.pricing,
			reasoning: expected.modelReasoning ?? 'unsupported',
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			retirementDate: expected.retirementDate,
			routes: servedRoutes,
			stogasSupported: expected.routeIds.every(
				(routeId) => routes.get(routeId)?.stogasSupported !== false
			),
			notes: [
				...expected.routeIds.flatMap((routeId) => routeNotes(routes.get(routeId)!)),
				...(graph.models[expected.modelId]!.notes as unknown[]),
				...(expected.notes === undefined
					? []
					: [{ kind: 'deployment', id: expected.id, text: expected.notes }])
			],
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
