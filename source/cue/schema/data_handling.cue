package catalog

#DataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	endToEndEncrypted: bool
	retentionDays:     null | (int & >=0)
	trainingUse:       bool
	zeroDataRetention: bool
	tee:               null | #Tee
})

#ProviderDataHandling: close({
	processingLocation: #ProcessingLocation
	storageLocation:    #StorageLocation
	retentionDays:     null | (int & >=0)
	trainingUse:       bool
	zeroDataRetention: bool
	tee:               null | #Tee
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
	tee?:               null | #TeeOverride
})

#TeeOverride: close({
	attestation?:           #TeeAttestation
	technology?:            #TeeTechnology
	externalNetworkEgress?: "blocked" | "allowed" | "unknown"
})
