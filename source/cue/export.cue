package catalog

let sourceAuthors = authors
let sourceGroups = groups
let sourceLocations = locations
let sourceModels = models
let sourceProviders = providers
let sourceRoutes = routes
let sourceDeployments = deploymentsByProvider
let deploymentCollections = deployments

compiledSource: {
	// Exporting it reports a deployment outside its own file.
	_deployments: deploymentCollections
	// Locations have no periods, so they stay outside the graph that periods change.
	locations: sourceLocations
	graph: {
		authors:               sourceAuthors
		groups:                sourceGroups
		models:                sourceModels
		providers:             sourceProviders
		routes:                sourceRoutes
		deploymentsByProvider: sourceDeployments
	}
}
