package catalog

#RegionalHandling: close({
	regionIds: [...#Id]
	guarantee: #Guarantee
})

#Retention: close({
	mode:  #RetentionMode
	days?: null | (int & >=0)
})

#ZeroDataRetention: close({
	availability:  #ZDRAvailability
	applicability: #Applicability
})

#DataHandling: close({
	processing:        #RegionalHandling
	storage:           #RegionalHandling
	retention:         #Retention
	trainingUse:       #TrainingUse
	zeroDataRetention: #ZeroDataRetention
	evidenceIds:       [#Id, ...#Id]
})

#DataHandlingOverride: close({
	processing?:        #RegionalHandling
	storage?:           #RegionalHandling
	retention?:         #Retention
	trainingUse?:       #TrainingUse
	zeroDataRetention?: #ZeroDataRetention
	evidenceIds?:       [#Id, ...#Id]
})

#Moderation: close({
	input:       #Moderator
	output:      #Moderator
	evidenceIds: [#Id, ...#Id]
})

#ModerationOverride: close({
	input?:       #Moderator
	output?:      #Moderator
	evidenceIds?: [#Id, ...#Id]
})

