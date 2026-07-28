package catalog

#Provider: close({
	name:                 string & !=""
	aliases:              [...#Slug]
	headquartersCountry?: #CountryCode
	capabilities?:        #RouteCapabilityOverrides
	dataHandling?:        #DataHandlingOverride
	moderation?:          #ModerationOverride
	pricing?:             #Pricing
})
