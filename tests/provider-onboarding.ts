import { expect } from 'bun:test';

type Catalog = {
	graph: {
		authors: Record<string, unknown>;
		deployments: Record<
			string,
			Record<string, unknown> & {
				pricing: Record<string, unknown>;
				routeIds: string[];
			}
		>;
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

type ProviderDataHandlingContract = Omit<DataHandlingContract, 'endToEndEncrypted'>;

type RouteDataHandlingContract = Pick<DataHandlingContract, 'endToEndEncrypted'>;

type ProviderRouteContract = {
	capabilities?: Record<string, boolean>;
	dataHandling?: RouteDataHandlingContract;
	endpoint?: string;
	id: string;
	interfaces: string[];
	moderated?: boolean;
	pricing?: Record<string, Record<string, string>>;
};

export type ProviderDeploymentContract = {
	aliases: string[];
	authorId: string;
	capabilities: Record<string, boolean>;
	contextWindowTokens: number;
	dataHandling?: DataHandlingContract;
	deprecationDate: string | null;
	id: string;
	inputModalities: string[];
	maxOutputTokens: number;
	modelContextWindowTokens?: number;
	modelId: string;
	modelInputModalities?: string[];
	modelMaxOutputTokens?: number;
	modelReasoningEfforts?: string[];
	modelReasoning?: 'optional' | 'required' | 'unsupported';
	modelReasoningMaxTokens?: { maximum: number; minimum: number } | null;
	moderated?: boolean;
	outputModalities: string[];
	pricing: Record<string, Record<string, string>>;
	publicOverrides?: Record<string, unknown>;
	reasoningEfforts?: string[];
	reasoning?: 'optional' | 'required' | 'unsupported';
	reasoningMaxTokens?: { maximum: number; minimum: number } | null;
	routeOverrides?: Record<string, { reasoningEfforts: string[] }>;
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
		moderated: boolean;
		name: string;
		pricing?: Record<string, Record<string, string>>;
	};
	deployments: ProviderDeploymentContract[];
	routes: ProviderRouteContract[];
};

export function assertProviderOnboardingContract(
	runtimeCatalog: Catalog,
	publicCatalog: Catalog,
	contract: ProviderOnboardingContract
) {
	const runtime = runtimeCatalog.graph;
	const published = publicCatalog.graph;
	const providerId = contract.provider.id;
	const providerRoutes = Object.entries(runtime.routes)
		.filter(([, route]) => route.providerId === providerId)
		.map(([id]) => id)
		.sort();
	expect(providerRoutes).toEqual(contract.routes.map(({ id }) => id).sort());
	expect(runtime.providers[providerId]).toEqual({
		aliases: contract.provider.aliases,
		credentialModes: contract.provider.credentialModes,
		name: contract.provider.name
	});
	expect(published.providers[providerId]).toEqual({
		aliases: contract.provider.aliases,
		capabilities: contract.provider.capabilities,
		credentialModes: contract.provider.credentialModes,
		dataHandling: providerDataHandling(contract.provider.dataHandling),
		moderated: contract.provider.moderated,
		name: contract.provider.name,
		...(contract.provider.pricing ? { pricing: contract.provider.pricing } : {}),
		...(contract.provider.headquarteredCountry
			? { headquarteredCountry: contract.provider.headquarteredCountry }
			: {})
	});

	for (const route of contract.routes) {
		const dataHandling = route.dataHandling ?? routeDataHandling(contract.provider.dataHandling);
		expect(runtime.routes[route.id]).toEqual({
			interfaces: route.interfaces,
			providerId
		});
		expect(published.routes[route.id]).toEqual({
			...(route.endpoint ? { endpoint: route.endpoint } : {}),
			dataHandling,
			interfaces: route.interfaces,
			providerId,
			...(route.pricing ? { pricing: route.pricing } : {}),
			...(route.capabilities || route.moderated !== undefined
				? {
						overrides: {
							...(route.capabilities ? { capabilities: route.capabilities } : {}),
							...(route.moderated !== undefined ? { moderated: route.moderated } : {})
						}
					}
				: {})
		});
	}

	const deploymentIds = Object.entries(runtime.deployments)
		.filter(([, deployment]) =>
			deployment.routeIds.some((routeId: string) => providerRoutes.includes(routeId))
		)
		.map(([id]) => id)
		.sort();
	expect(deploymentIds).toEqual(contract.deployments.map(({ id }) => id).sort());

	for (const expected of contract.deployments) {
		const routeContracts = expected.routeIds.map((routeId) => {
			const route = contract.routes.find(({ id }) => id === routeId);
			if (!route) throw new Error(`${expected.id}: unknown contract route ${routeId}`);
			return route;
		});
		const routeHandling = routeContracts.map((route) => ({
			...providerDataHandling(contract.provider.dataHandling),
			...(route.dataHandling ?? routeDataHandling(contract.provider.dataHandling))
		}));
		const routeModerated = routeContracts.map(
			(route) => route.moderated ?? contract.provider.moderated
		);
		const firstModerated = routeModerated[0];
		for (const value of routeModerated) expect(value).toBe(firstModerated);
		const dataHandlingByRoute = Object.fromEntries(
			routeContracts.map((route, index) => [
				route.id,
				expected.dataHandling ?? routeHandling[index]
			])
		);

		const runtimeDeployment = {
			aliases: expected.aliases,
			capabilities: expected.capabilities,
			contextWindowTokens: expected.contextWindowTokens,
			deprecationDate: expected.deprecationDate,
			inputModalities: expected.inputModalities,
			maxOutputTokens: expected.maxOutputTokens,
			modelId: expected.modelId,
			outputModalities: expected.outputModalities,
			pricing: expected.pricing,
			reasoning: expected.reasoning ?? expected.modelReasoning ?? 'unsupported',
			reasoningEfforts: expected.reasoningEfforts ?? expected.modelReasoningEfforts ?? [],
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			routeIds: [...expected.routeIds].sort(),
			...(expected.routeOverrides ? { routeOverrides: expected.routeOverrides } : {}),
			upstream: expected.upstream,
			dataHandlingByRoute,
			...(expected.weightPrecision ? { weightPrecision: expected.weightPrecision } : {})
		};
		expect(runtime.deployments[expected.id]).toEqual(runtimeDeployment);
		expect(runtime.deployments[expected.id]).not.toHaveProperty('default');
		expect(runtime.deployments[expected.id]).not.toHaveProperty('release');
		expect(runtime.deployments[expected.id]).not.toHaveProperty('providerResourceId');
		expect(Object.keys(runtime.deployments[expected.id].pricing).sort()).toEqual(
			Object.keys(expected.pricing).sort()
		);
		expect(published.deployments[expected.id]).toEqual({
			aliases: expected.aliases,
			modelId: expected.modelId,
			pricing: expected.pricing,
			routeIds: [...expected.routeIds].sort(),
			upstream: expected.upstream,
			...(expected.publicOverrides ? { overrides: expected.publicOverrides } : {}),
			...(expected.weightPrecision ? { weightPrecision: expected.weightPrecision } : {})
		});

		const model = published.models[expected.modelId];
		expect(model).toMatchObject({
			authorId: expected.authorId,
			contextWindowTokens: expected.modelContextWindowTokens ?? expected.contextWindowTokens,
			inputModalities: expected.modelInputModalities ?? expected.inputModalities,
			maxOutputTokens: expected.modelMaxOutputTokens ?? expected.maxOutputTokens,
			outputModalities: expected.outputModalities,
			reasoningEfforts: expected.modelReasoningEfforts ?? [],
			reasoning: expected.modelReasoning ?? 'unsupported',
			reasoningMaxTokens: expected.modelReasoningMaxTokens ?? null
		});
		expect(published.authors[expected.authorId]).toBeDefined();
	}
}

function providerDataHandling(value: DataHandlingContract): ProviderDataHandlingContract {
	const { endToEndEncrypted: _endToEndEncrypted, ...provider } = value;
	return provider;
}

function routeDataHandling(value: DataHandlingContract): RouteDataHandlingContract {
	return {
		endToEndEncrypted: value.endToEndEncrypted
	};
}
