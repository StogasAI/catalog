package catalog

#ProviderDataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	// Maximum retention of stored prompts and responses; null means unknown.
	// Temporary in-memory prompt caching is excluded.
	retentionDays: null | (int & >=0)
	// Whether the provider trains on prompts and responses; null means unknown.
	trainingUse: null | bool
	// No persistent retention of prompts or responses for this offering.
	// Temporary in-memory prompt caching is compatible with ZDR.
	zeroDataRetention: bool
	// tee means provider inference processes request content inside a TEE.
	tee: bool
	// teeVerified is true only when Stogas verifies the approved measured
	// workload for the concrete request target, independent of provider claims.
	teeVerified: bool
})

// A route states only what differs from its provider. It may state any fact of a deployment's
// override, such as a Chutes route that relays requests to operators outside a TEE.
#RouteDataHandling: close({
	#DeploymentDataHandlingOverride
	endToEndEncrypted: bool
})

#DeploymentDataHandlingOverride: close({
	processingLocation?: #ProcessingLocation
	storageLocation?:    #StorageLocation
	retentionDays?:     null | (int & >=0)
	trainingUse?:       null | bool
	zeroDataRetention?: bool
	tee?:               bool
	teeVerified?:       bool
})
