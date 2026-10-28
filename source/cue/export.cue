package catalog

let sourceAuthors = authors
let sourceGroups = groups
let sourceModels = models
let sourceProviders = providers
let sourceRoutes = routes
let sourceDeployments = deploymentsByProvider
let deploymentCollections = deployments

compiledSource: {
	// Exporting it reports a deployment outside its own file.
	_deployments: deploymentCollections
	graph: {
		authors:               sourceAuthors
		groups:                sourceGroups
		models:                sourceModels
		providers:             sourceProviders
		routes:                sourceRoutes
		deploymentsByProvider: sourceDeployments
	}
}
