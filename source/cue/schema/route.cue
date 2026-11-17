package catalog

// File types the provider reads natively from a document part. Image and audio
// parts follow inputModalities. A route that reads none omits documentFormats.
#MediaType: string & =~"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$"
#DocumentFormats: close({
	mediaTypes: [#MediaType, ...#MediaType]
	extensions: [...string & =~"^\\.[a-z0-9][a-z0-9._+-]*$"]
})

#RouteCapabilities: close({
	streaming:               bool
	functionCalling:         bool
	parallelFunctionCalling: bool
	implicitPromptCaching:   bool
	explicitPromptCaching:   bool
	structuredOutputs:       bool
	systemMessages:          bool
	toolChoice:              bool
	// A tool result takes the images and documents that a user message takes. Chat Completions
	// at OpenAI and Azure refuses a file there, and answers 200 for an image that the model
	// never sees.
	toolResultAttachments: bool
})

// A model or deployment can only take away what its routes offer.
#UnsupportedCapabilities: close({
	streaming?:               false
	functionCalling?:         false
	parallelFunctionCalling?: false
	implicitPromptCaching?:   false
	explicitPromptCaching?:   false
	structuredOutputs?:       false
	systemMessages?:          false
	toolChoice?:              false
	toolResultAttachments?:   false
})

#Route: close({
	providerId: #Id
	// The URL that every account calls for the route. A route whose URL names an account's
	// region, project or resource states none. An OpenAI deployment with upstream.inferenceGeo
	// calls the same path on its data residency host, the endpoint's host behind the geography,
	// such as eu.api.openai.com. The gateway calls the hosts in its own code and never reads it.
	endpoint?: string & =~"^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(/[A-Za-z0-9._~-]+)+$"
	interfaces: [#Interface, ...#Interface]
	// The route is a provider's batch API, which runs a file of requests within
	// a window at its batch prices. Its deployments serve no other route and
	// name no service tier. The gateway has no batch API, so Stogas serves no
	// batch route.
	batch?: true

	// Content the route carries to the provider. A deployment accepts the
	// modalities that both its model and the route accept.
	inputModalities: [#Modality, ...#Modality]
	documentFormats?: #DocumentFormats
	inputLimits?:     #InputLimits
	// What the route's API offers and which sampling parameters it takes. Every route states both
	// in full, because they describe an API and one provider's APIs differ: a batch API cannot
	// stream, and Responses takes no seed.
	capabilities: #RouteCapabilities
	sampling:     #Sampling
	// The company that runs every model of the route, when it is not the provider's company: the
	// company whose service the provider resells, or unknown when the provider forwards requests
	// to companies that it does not name. A deployment can name another.
	hosting?:      #CompanyRef
	dataHandling?: #RouteDataHandling
	// Tools that run at the provider, or at a service that it calls, when a
	// request lists them. Every deployment of the route offers them unless its
	// overrides leave one out, and requests that list a tool route only to
	// deployments that offer it.
	hostedTools?: [#HostedTool, ...#HostedTool]
	// The date that the provider names for shutting this route down, such as an
	// API that it retires. Its deployments stop serving through it then, and a
	// deployment that no other route serves retires.
	retirementDate?: #Date
	// Stogas does not serve this route, or its deployments, with a customer's own credential or
	// with its own account, although its provider does.
	stogasByok?:    false
	stogasManaged?: false
	notes?:         #Note
	periods?: [#Period, ...#Period]
})
