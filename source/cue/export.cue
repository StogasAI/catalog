package catalog

let sourceAuthors = authors
let sourceModels = models
let sourceProviders = providers
let sourceRoutes = routes
let sourceDeployments = deployments
let sourceEvidence = evidence

compiledSource: {
	_checks: #Catalog
	graph: {
		authors:     sourceAuthors
		models:      sourceModels
		providers:   sourceProviders
		routes:      sourceRoutes
		deployments: sourceDeployments
	}
	evidence: sourceEvidence
}

