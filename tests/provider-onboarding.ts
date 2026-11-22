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
	isolatedPromptCache: boolean;
	/** The companies, other than the provider's and the hosting, that receive requests. */
	sharedWith?: string[];
	/** The audits and authorizations that name the service. */
	certifications?: string[];
};

export type ProviderRouteContract = {
	capabilities?: Record<string, boolean>;
	dataHandling?: Partial<DataHandlingContract>;
	documentFormats: { extensions: string[]; mediaTypes: string[] };
	/** The provider's limits on one request; a limit that it does not state is omitted. */
	inputLimits?: {
		requestBytes?: number;
		images?: { bytes?: number; count?: number; pixels?: number; totalBytes?: number };
		documents?: { bytes?: number; count?: number; pages?: number; totalBytes?: number };
	};
	/** The URL that every account calls, omitted where it names an account's region, project or resource. */
	endpoint?: string;
	id: string;
	inputModalities: string[];
	interfaces: string[];
	/** The sampling parameters that the route's API takes, where they differ from the provider's. */
	sampling?: string[];
	/** The route is a batch API. */
	batch?: true;
	supportsCancellation?: true;
	hostedTools?: HostedToolContract[];
	/** The ways of serving that the route withdraws from what its provider offers. */
	stogasByok?: false;
	stogasManaged?: false;
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
	/** The document formats of its routes that the deployment reads, where it reads fewer. */
	documentFormats?: { extensions: string[]; mediaTypes: string[] };
	id: string;
	// The model's input modalities; each route keeps those it carries.
	inputModalities: string[];
	/** The input modalities of its model that the deployment takes away. */
	withoutInputModalities?: string[];
	// Omitted when the input ceiling is the context window.
	maxInputTokens?: number;
	maxOutputTokens: number;
	modelContextWindowTokens?: number;
	modelId: string;
	modelMaxOutputTokens?: number;
	/** The provider's own shortest cached prompt, where it differs from the model's. */
	promptCacheMinimumTokens?: number | null;
	modelReasoningEfforts?: string[];
	modelReasoning?: 'optional' | 'required' | 'unsupported';
	modelReasoningMaxTokens?: { maximum: number; minimum: number } | null;
	/** The deployment's reasoning and its default, where they differ from the model's. */
	reasoning?: 'optional' | 'required' | 'unsupported';
	reasoningDefault?: string | null;
	/** The sampling parameters that the deployment takes away from its routes. */
	withoutSampling?: string[];
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
	/** The ways of serving that the deployment withdraws from what its routes offer. */
	stogasByok?: false;
	stogasManaged?: false;
	upstream: Record<string, number | string | string[]>;
	weightPrecision?: string;
};

export type ProviderOnboardingContract = {
	provider: {
		/** What an account with the provider can hold, as the compiled record states each option. */
		accountOptions?: {
			dataHandling: Record<string, unknown>;
			grants: string[];
			group: string | null;
			id: string;
			name: string;
			routes: string[];
		}[];
		aliases: string[];
		capabilities: Record<string, boolean>;
		/** The sampling parameters that the provider's API takes. */
		sampling: string[];
		/** Whether Stogas serves the provider with a customer's credential and with its own account. */
		stogasByok: boolean;
		stogasManaged: boolean;
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

const samplingNames = [
	'temperature',
	'topP',
	'topK',
	'frequencyPenalty',
	'presencePenalty',
	'repetitionPenalty',
	'seed',
	'logitBias'
];

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
	// A route offers what its provider offers and it does not withdraw, and a batch route nothing.
	const routeServing = (route: ProviderRouteContract) => ({
		stogasByok: contract.provider.stogasByok && route.stogasByok !== false && !route.batch,
		stogasManaged: contract.provider.stogasManaged && route.stogasManaged !== false && !route.batch
	});
	const provider = {
		accountOptions: contract.provider.accountOptions ?? [],
		aliases: contract.provider.aliases,
		name: contract.provider.name,
		companyId: contract.provider.companyId,
		headquarteredCountry: contract.provider.headquarteredCountry
	};
	expect(graph.providers[providerId]).toEqual(provider);

	const routes = new Map(contract.routes.map((route) => [route.id, route]));
	const routeNotes = (route: ProviderRouteContract) =>
		route.notes === undefined ? [] : [{ kind: 'route', id: route.id, text: route.notes }];
	// A record without a note leaves the field out.
	const noted = (notes: unknown[]) => (notes.length > 0 ? { notes } : {});
	const routeHandling = (route: ProviderRouteContract) => ({
		sharedWith: [],
		certifications: [],
		...contract.provider.dataHandling,
		...route.dataHandling
	});
	for (const route of contract.routes) {
		expect(graph.routes[route.id]).toEqual({
			capabilities: { ...contract.provider.capabilities, ...route.capabilities },
			dataHandling: routeHandling(route),
			documentFormats: route.documentFormats,
			inputLimits: {
				requestBytes: route.inputLimits?.requestBytes ?? null,
				images: {
					bytes: null,
					count: null,
					pixels: null,
					totalBytes: null,
					...route.inputLimits?.images
				},
				documents: {
					bytes: null,
					count: null,
					pages: null,
					totalBytes: null,
					...route.inputLimits?.documents
				}
			},
			sampling: Object.fromEntries(
				samplingNames.map((name) => [
					name,
					(route.sampling ?? contract.provider.sampling).includes(name)
				])
			),
			inputModalities: route.inputModalities,
			interfaces: route.interfaces,
			batch: route.batch === true,
			supportsCancellation: route.supportsCancellation === true,
			hostedTools: (route.hostedTools ?? []).map((offer) => ({ dataHandling: {}, ...offer })),
			providerId,
			endpoint: route.endpoint ?? null,
			retirementDate: null,
			...routeServing(route),
			...noted(routeNotes(route))
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
		const relayed = graph.deployments[id] as Record<string, unknown> & {
			routes: Record<string, { chainHash: string }>;
			upstream: Record<string, string>;
		};
		expect(relayed.hosting).toBe('anthropic');
		const sorted = (upstream: unknown) =>
			JSON.stringify(Object.entries(upstream as object).sort(([a], [b]) => a.localeCompare(b)));
		const sources = Object.entries(graph.deployments).filter(
			([, deployment]) =>
				sorted(deployment.upstream) === sorted(relayed.upstream) &&
				batch(deployment) === batch(relayed) &&
				Object.keys(deployment.routes).every(
					(routeId) => graph.routes[routeId]?.providerId === 'anthropic'
				)
		);
		expect(sources.map(([sourceId]) => sourceId)).toHaveLength(1);
		const [, source] = sources[0]!;
		// Route IDs, chain hashes and notes name the provider; everything that the routes serve
		// matches, except the data handling that the cloud changes, its own request limits and the
		// account options, which are each provider's own.
		// A hosted tool keeps those certifications of the record that its list names, so each tool's
		// list compares under the cloud's own.
		type Served = {
			dataHandling: { certifications: string[] };
			hostedTools: Record<string, { dataHandling: { certifications?: string[] } }>;
		};
		const served = (deployment: typeof relayed, dataHandling = {}) => ({
			...deployment,
			notes: undefined,
			routes: Object.values(deployment.routes).map(({ chainHash: _, ...route }) => {
				const { dataHandling: own, hostedTools } = route as unknown as Served;
				const handling = { ...own, ...dataHandling };
				return {
					...route,
					accountOptions: undefined,
					inputLimits: undefined,
					dataHandling: handling,
					hostedTools: Object.fromEntries(
						Object.entries(hostedTools).map(([tool, offer]) => {
							const { certifications: covering, ...effect } = offer.dataHandling;
							const kept =
								covering && handling.certifications.filter((id) => covering.includes(id));
							return [
								tool,
								{
									...offer,
									dataHandling: {
										...effect,
										...(kept &&
											kept.length < handling.certifications.length && { certifications: kept })
									}
								}
							];
						})
					)
				};
			}),
			upstream: undefined
		});
		expect(served(relayed)).toEqual(
			served(source as typeof relayed, contract.anthropicHostedDataHandling)
		);
	}

	for (const expected of contract.deployments) {
		const model = graph.models[expected.modelId] as unknown as {
			promptCacheMinimumTokens: number | null;
			reasoningDefault: string | null;
			sampling: Record<string, boolean>;
		};
		const servedRoutes = Object.fromEntries(
			[...expected.routeIds].sort().map((routeId) => {
				const route = routes.get(routeId);
				if (!route) throw new Error(`${expected.id}: unknown contract route ${routeId}`);
				const offers = route.hostedTools ?? [];
				return [
					routeId,
					{
						// The options that reach a record follow the build's rule, which its own test states.
						accountOptions: expect.any(Array),
						capabilities: expected.capabilities,
						dataHandling: {
							...routeHandling(route),
							...expected.dataHandling,
							...(expected.sharedWith && { sharedWith: expected.sharedWith })
						},
						documentFormats: Object.fromEntries(
							(['extensions', 'mediaTypes'] as const).map((field) => [
								field,
								route.documentFormats[field].filter(
									(format) => expected.documentFormats?.[field].includes(format) ?? true
								)
							])
						),
						// The route's limits, narrowed by the model's, which the model's own test states.
						inputLimits: expect.any(Object),
						inputModalities: expected.inputModalities.filter(
							(modality) =>
								route.inputModalities.includes(modality) &&
								!expected.withoutInputModalities?.includes(modality)
						),
						sampling: Object.fromEntries(
							samplingNames.map((name) => [
								name,
								(route.sampling ?? contract.provider.sampling).includes(name) &&
									model.sampling[name] !== false &&
									!expected.withoutSampling?.includes(name)
							])
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
			// A deployment takes its model's minimum unless its provider states another, and has
			// none where it caches no prompts.
			promptCacheMinimumTokens:
				expected.promptCacheMinimumTokens !== undefined
					? expected.promptCacheMinimumTokens
					: expected.capabilities.implicitPromptCaching ||
						  expected.capabilities.explicitPromptCaching
						? model.promptCacheMinimumTokens
						: null,
			reasoning: expected.reasoning ?? expected.modelReasoning ?? 'unsupported',
			reasoningDefault:
				expected.reasoningDefault !== undefined
					? expected.reasoningDefault
					: model.reasoningDefault,
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			retirementDate: expected.retirementDate,
			routes: servedRoutes,
			...Object.fromEntries(
				(['stogasByok', 'stogasManaged'] as const).map((mode) => [
					mode,
					expected[mode] !== false &&
						expected.routeIds.every((routeId) => routeServing(routes.get(routeId)!)[mode])
				])
			),
			...noted([
				...expected.routeIds.flatMap((routeId) => routeNotes(routes.get(routeId)!)),
				...((graph.models[expected.modelId]!.notes as unknown[] | undefined) ?? []),
				...(expected.notes === undefined
					? []
					: [{ kind: 'deployment', id: expected.id, text: expected.notes }])
			]),
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
