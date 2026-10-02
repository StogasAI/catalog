package catalog

#DataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	endToEndEncrypted: bool
	// Maximum retention of stored prompts and responses; null means unknown.
	// Temporary in-memory prompt caching is excluded.
	retentionDays:     null | (int & >=0)
	trainingUse:       bool
	// No persistent retention of prompts or responses for this offering.
	// Temporary in-memory prompt caching is compatible with ZDR.
	zeroDataRetention: bool
	// tee means provider inference processes request content inside a TEE.
	tee: bool
	// teeVerified is true only when Stogas verifies the approved measured
	// workload for the concrete request target, independent of provider claims.
	teeVerified: bool
})

#ProviderDataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	retentionDays:     null | (int & >=0)
	trainingUse:       bool
	zeroDataRetention: bool
	tee:               bool
	teeVerified:       bool
})

#RouteDataHandling: close({
	endToEndEncrypted: bool
})

#DeploymentDataHandlingOverride: close({
	processingLocation?: #ProcessingLocation
	storageLocation?:    #StorageLocation
	retentionDays?:     null | (int & >=0)
	trainingUse?:       bool
	zeroDataRetention?: bool
	tee?:               bool
	teeVerified?:       bool
})
