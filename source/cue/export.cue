package catalog

let sourceAuthors = authors
let sourceGroups = groups
let sourceModels = models
let sourceProviders = providers
let sourceRoutes = routes
let sourceDeployments = deployments

compiledSource: {
	_checks: #Catalog
	graph: {
		authors:     sourceAuthors
		groups:      sourceGroups
		models:      sourceModels
		providers:   sourceProviders
		routes:      sourceRoutes
		deployments: sourceDeployments
	}
}
