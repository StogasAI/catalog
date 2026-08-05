import { expect } from 'bun:test';

type Catalog = {
	graph: {
		authors: Record<string, unknown>;
		deployments: Record<string, any>;
		models: Record<string, any>;
		providers: Record<string, any>;
		routes: Record<string, any>;
	};
};

export type DataHandlingContract = {
	processingRegions: string[];
	retentionDays: number | null;
	storageRegions: string[];
	trainingUse: boolean;
	zeroDataRetention: boolean;
};

export type TeeContract = {
	externalNetworkEgress: 'allowed' | 'blocked' | 'unknown';
	mechanism: string;
	status: string;
};

export type ProviderRouteContract = {
	capabilities?: Record<string, boolean>;
	dataHandling?: DataHandlingContract;
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
	modelId: string;
	modelReasoningEfforts?: string[];
	modelReasoningAvailability?: 'optional' | 'required' | 'unsupported';
	modelReasoningMaxTokens?: { maximum: number; minimum: number } | null;
	moderated?: boolean;
	outputModalities: string[];
	pricing: Record<string, Record<string, string>>;
	reasoningEfforts?: string[];
	reasoningAvailability?: 'optional' | 'required' | 'unsupported';
	reasoningMaxTokens?: { maximum: number; minimum: number } | null;
	routeIds: string[];
	tee?: TeeContract;
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
		dataHandling: contract.provider.dataHandling,
		moderated: contract.provider.moderated,
		name: contract.provider.name,
		...(contract.provider.headquarteredCountry
			? { headquarteredCountry: contract.provider.headquarteredCountry }
			: {})
	});

	for (const route of contract.routes) {
		const capabilities = route.capabilities ?? contract.provider.capabilities;
		const dataHandling = route.dataHandling ?? contract.provider.dataHandling;
		const moderated = route.moderated ?? contract.provider.moderated;
		expect(runtime.routes[route.id]).toEqual({
			interfaces: route.interfaces,
			providerId
		});
		expect(published.routes[route.id]).toEqual({
			capabilities,
			dataHandling,
			...(route.endpoint ? { endpoint: route.endpoint } : {}),
			interfaces: route.interfaces,
			moderated,
			pricing: route.pricing ?? {},
			providerId
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
		const routeDataHandling = routeContracts.map(
			(route) => route.dataHandling ?? contract.provider.dataHandling
		);
		const routeModerated = routeContracts.map(
			(route) => route.moderated ?? contract.provider.moderated
		);
		const firstDataHandling = routeDataHandling[0];
		const firstModerated = routeModerated[0];
		for (const value of routeDataHandling) expect(value).toEqual(firstDataHandling);
		for (const value of routeModerated) expect(value).toBe(firstModerated);

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
			reasoningAvailability:
				expected.reasoningAvailability ?? expected.modelReasoningAvailability ?? 'unsupported',
			reasoningEfforts: expected.reasoningEfforts ?? expected.modelReasoningEfforts ?? [],
			reasoningMaxTokens:
				expected.reasoningMaxTokens !== undefined
					? expected.reasoningMaxTokens
					: (expected.modelReasoningMaxTokens ?? null),
			routeIds: [...expected.routeIds].sort(),
			upstream: expected.upstream,
			...(expected.tee ? { tee: expected.tee } : {}),
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
			...runtimeDeployment,
			dataHandling: expected.dataHandling ?? firstDataHandling,
			moderated: expected.moderated ?? firstModerated
		});

		const model = published.models[expected.modelId];
		expect(model).toMatchObject({
			authorId: expected.authorId,
			contextWindowTokens: expected.contextWindowTokens,
			inputModalities: expected.inputModalities,
			maxOutputTokens: expected.maxOutputTokens,
			outputModalities: expected.outputModalities,
			reasoningEfforts: expected.modelReasoningEfforts ?? [],
			reasoningAvailability: expected.modelReasoningAvailability ?? 'unsupported',
			reasoningMaxTokens: expected.modelReasoningMaxTokens ?? null
		});
		expect(published.authors[expected.authorId]).toBeDefined();
	}
}
