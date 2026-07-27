package catalog

#Author: close({
	name:        string & !=""
	slugs:       #Slugs
	description: string
	headquarters?: close({
		countryCode: #CountryCode
		locality?:   string
	})
})

