package catalog

#DataHandling: close({
	processingRegions:  [...#Id]
	storageRegions:     [...#Id]
	retentionDays:      null | (int & >=0)
	trainingUse:       #TrainingUse
	zeroDataRetention: #ZDRAvailability
})

#DataHandlingOverride: close({
	processingRegions?:  [...#Id]
	storageRegions?:     [...#Id]
	retentionDays?:      null | (int & >=0)
	trainingUse?:       #TrainingUse
	zeroDataRetention?: #ZDRAvailability
})

#Moderation: close({
	input:  #Moderator
	output: #Moderator
})

#ModerationOverride: close({
	input?:  #Moderator
	output?: #Moderator
})
