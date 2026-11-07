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
	/** Why Stogas does not serve the route, which its deployments carry. */
	stogasUnsupported?: string;
};

type HostedToolContract = {
	dataHandling: Partial<DataHandlingContract>;
	hostings?: string[];
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
	/**
	 * Deployments that Anthropic runs on the provider's cloud. Each serves what Anthropic's own
	 * deployment of the same upstream model, tier and inference geography serves, on a batch route
	 * when it is on one.
	 */
	anthropicHosted?: string[];
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
			...(route.batch ? { batch: true } : {}),
			hostedTools: route.hostedTools ?? [],
			providerId,
			...(route.stogasUnsupported ? { stogasUnsupported: route.stogasUnsupported } : {})
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
		const { hosting, ...upstream } = copy.upstream;
		expect(hosting).toBe('anthropic');
		const sources = Object.entries(graph.deployments).filter(
			([, deployment]) =>
				JSON.stringify(deployment.upstream) === JSON.stringify(upstream) &&
				batch(deployment) === batch(copy) &&
				Object.keys(deployment.routes).every(
					(routeId) => graph.routes[routeId]?.providerId === 'anthropic'
				)
		);
		expect(sources.map(([sourceId]) => sourceId)).toHaveLength(1);
		const [, source] = sources[0]!;
		// Route IDs and chain hashes name the provider; everything that the routes serve matches.
		const served = (deployment: typeof copy) => ({
			...deployment,
			routes: Object.values(deployment.routes).map(({ chainHash: _, ...route }) => route),
			upstream: undefined
		});
		expect(served(copy)).toEqual(served(source as typeof copy));
	}

	for (const expected of contract.deployments) {
		const servedRoutes = Object.fromEntries(
			[...expected.routeIds].sort().map((routeId) => {
				const route = routes.get(routeId);
				if (!route) throw new Error(`${expected.id}: unknown contract route ${routeId}`);
				const offers = (route.hostedTools ?? []).filter(
					(offer) => !offer.hostings || offer.hostings.includes(String(expected.upstream.hosting))
				);
				return [
					routeId,
					{
						capabilities: expected.capabilities,
						dataHandling: expected.dataHandling ?? routeHandling(route),
						inputModalities: expected.inputModalities.filter((modality) =>
							route.inputModalities.includes(modality)
						),
						hostedTools: Object.fromEntries(
							offers.map((offer) => [offer.tool, { dataHandling: offer.dataHandling }])
						),
						pricing: Object.assign(
							{},
							...offers.map((offer) => offer.pricing ?? {}),
							expected.pricing
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
			outputModalities: expected.outputModalities,
			reasoning: expected.modelReasoning ?? 'unsupported',
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			retirementDate: expected.retirementDate,
			routes: servedRoutes,
			...Object.fromEntries(
				expected.routeIds.flatMap((routeId) => {
					const reason = routes.get(routeId)?.stogasUnsupported;
					return reason ? [['stogasUnsupported', reason]] : [];
				})
			),
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
