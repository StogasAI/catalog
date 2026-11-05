package catalog

// A place that data handling can name. kind says what sort of place it is, and description says
// what it covers when its name alone could mean more than one area. A continent, region or union
// lists every country that it covers, and the build derives the places that contain each place
// from those lists.
#Location: close({
	name:         string & !=""
	kind:         #LocationKind
	description?: string & !=""
	// The build checks that a continent, region or union lists its countries and that no other
	// place does.
	countries?: [#CountryCode, ...#CountryCode]
})

// world is the one place that holds every other. A continent follows UN M.49. A region is a group
// of countries that is neither a continent nor a union, such as apac. A union is a group of
// countries under shared law, such as eu. A country is an ISO 3166-1 code and a subdivision an
// ISO 3166-2 code.
#LocationKind: "world" | "continent" | "region" | "union" | "country" | "subdivision"
