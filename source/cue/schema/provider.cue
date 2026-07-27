package catalog

#Provider: close({
	name:        string & !=""
	slugs:       #Slugs
	description: string
	headquarters?: close({
		countryCode: #CountryCode
		locality?:   string
	})
})

