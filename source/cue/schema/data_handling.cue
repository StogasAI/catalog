package catalog

#ProviderDataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	// Maximum retention of stored prompts and responses; null means unknown.
	// Temporary in-memory prompt caching is excluded.
	retentionDays: null | (int & >=0)
	// Whether the provider trains on prompts and responses; null means unknown.
	trainingUse: null | bool
	// The guarantees below are stated only when they hold; omitted, each is false.
	// No persistent retention of prompts or responses for this offering.
	// Temporary in-memory prompt caching is compatible with ZDR.
	zeroDataRetention?: true
	// tee means provider inference processes request content inside a TEE.
	tee?: true
	// teeVerified is true only when Stogas verifies the approved measured
	// workload for the concrete request target, independent of provider claims.
	teeVerified?: true
	// The companies, other than the provider's company and the hosting, that receive requests and
	// responses: one that passes them on to the hosting, or one that the hosting shares them with,
	// such as the model's developer for abuse monitoring. A company that only supplies
	// infrastructure to one of those two under its contract is not listed. Omitted when the provider
	// documents none.
	sharedWith?: [#CompanyRef, ...#CompanyRef]
})

// A route states only what differs from its provider. It may state any fact of a deployment's
// override, such as a Chutes route that relays requests to operators outside a TEE, and whether
// requests are encrypted end to end, which is false when omitted.
#RouteDataHandling: close({
	#DeploymentDataHandlingOverride
	endToEndEncrypted?: true
})

#DeploymentDataHandlingOverride: close({
	processingLocation?: #ProcessingLocation
	storageLocation?:    #StorageLocation
	retentionDays?:     null | (int & >=0)
	trainingUse?:       null | bool
	zeroDataRetention?: bool
	tee?:               bool
	teeVerified?:       bool
	sharedWith?: [...#CompanyRef]
})
