package catalog

#DataHandling: close({
	processingRegions: [...#Id]
	storageRegions: [...#Id]
	retentionDays:     null | (int & >=0)
	trainingUse:       bool
	zeroDataRetention: bool
})

#DataHandlingOverride: close({
	processingRegions?: [...#Id]
	storageRegions?: [...#Id]
	retentionDays?:     null | (int & >=0)
	trainingUse?:       bool
	zeroDataRetention?: bool
})
