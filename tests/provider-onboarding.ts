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

export type ProviderDeploymentContract = {
	aliases: string[];
	authorId: string;
	capabilities: { functionCalling: boolean; structuredOutputs: boolean };
	chuteRelease: {
		chuteId: string;
		chuteVersion: string;
		imageId: string;
		imageName: string;
		imageTag: string;
		modelRevision: string;
		runtimeVersion: string;
	};
	contextWindowTokens: number;
	id: string;
	inputModalities: string[];
	maxOutputTokens: number;
	modelId: string;
	modelReasoningEfforts?: string[];
	pricing: Record<string, Record<string, string>>;
	upstreamModel: string;
	weightPrecision: string;
	externalNetworkEgress?: 'allowed' | 'blocked' | 'unknown';
};

export type ProviderOnboardingContract = {
	dataHandling: {
		processingRegions: string[];
		retentionDays: number | null;
		storageRegions: string[];
		trainingUse: boolean;
		zeroDataRetention: boolean;
	};
	deployments: ProviderDeploymentContract[];
	moderated: boolean;
	providerId: string;
	route: {
		capabilities: Record<string, boolean>;
		endpoint: string;
		id: string;
		interfaces: string[];
	};
	tee: {
		externalNetworkEgress: 'allowed' | 'blocked' | 'unknown';
		mechanism: string;
		status: string;
	};
};

export function assertProviderOnboardingContract(
	runtimeCatalog: Catalog,
	publicCatalog: Catalog,
	contract: ProviderOnboardingContract
) {
	const runtime = runtimeCatalog.graph;
	const published = publicCatalog.graph;
	const providerRoutes = Object.entries(runtime.routes)
		.filter(([, route]) => route.providerId === contract.providerId)
		.map(([id]) => id)
		.sort();
	expect(providerRoutes).toEqual([contract.route.id]);
	expect(runtime.providers[contract.providerId]).toBeDefined();
	expect(published.providers[contract.providerId]).toMatchObject({
		capabilities: contract.route.capabilities,
		dataHandling: contract.dataHandling,
		moderated: contract.moderated
	});
	expect(runtime.routes[contract.route.id]).toEqual({
		interfaces: contract.route.interfaces,
		providerId: contract.providerId
	});
	expect(published.routes[contract.route.id]).toMatchObject({
		capabilities: contract.route.capabilities,
		dataHandling: contract.dataHandling,
		endpoint: contract.route.endpoint,
		interfaces: contract.route.interfaces,
		moderated: contract.moderated,
		providerId: contract.providerId,
		tee: contract.tee
	});

	const deploymentIds = Object.entries(runtime.deployments)
		.filter(([, deployment]) =>
			deployment.routeIds.some((routeId: string) => providerRoutes.includes(routeId))
		)
		.map(([id]) => id)
		.sort();
	expect(deploymentIds).toEqual(contract.deployments.map(({ id }) => id).sort());
	expect(new Set(contract.deployments.map(({ upstreamModel }) => upstreamModel)).size).toBe(
		contract.deployments.length
	);

	for (const expected of contract.deployments) {
		const deployment = runtime.deployments[expected.id];
		const publicDeployment = published.deployments[expected.id];
		const expectedTee = {
			...contract.tee,
			externalNetworkEgress: expected.externalNetworkEgress ?? contract.tee.externalNetworkEgress
		};
		expect(deployment).toMatchObject({
			aliases: expected.aliases,
			capabilities: {
				functionCalling: expected.capabilities.functionCalling,
				parallelFunctionCalling: false,
				structuredOutputs: expected.capabilities.structuredOutputs
			},
			contextWindowTokens: expected.contextWindowTokens,
			deprecationDate: null,
			inputModalities: expected.inputModalities,
			maxOutputTokens: expected.maxOutputTokens,
			modelId: expected.modelId,
			outputModalities: ['text'],
			pricing: expected.pricing,
			reasoningEfforts: [],
			routeIds: [contract.route.id],
			tee: expectedTee,
			upstream: {
				chuteId: expected.chuteRelease.chuteId,
				model: expected.upstreamModel
			},
			weightPrecision: expected.weightPrecision
		});
		expect(deployment).not.toHaveProperty('default');
		expect(deployment).not.toHaveProperty('release');
		expect(Object.keys(deployment.pricing).sort()).toEqual(Object.keys(expected.pricing).sort());
		expect(publicDeployment).toMatchObject({
			dataHandling: contract.dataHandling,
			moderated: contract.moderated,
			release: {
				chuteVersion: expected.chuteRelease.chuteVersion,
				imageId: expected.chuteRelease.imageId,
				imageName: expected.chuteRelease.imageName,
				imageTag: expected.chuteRelease.imageTag,
				modelRevision: expected.chuteRelease.modelRevision,
				runtimeVersion: expected.chuteRelease.runtimeVersion
			},
			tee: expectedTee
		});

		const model = published.models[expected.modelId];
		expect(model).toMatchObject({
			authorId: expected.authorId,
			contextWindowTokens: expected.contextWindowTokens,
			inputModalities: expected.inputModalities,
			maxOutputTokens: expected.maxOutputTokens,
			outputModalities: ['text'],
			reasoningEfforts: expected.modelReasoningEfforts ?? []
		});
		expect(published.authors[expected.authorId]).toBeDefined();
	}
}
