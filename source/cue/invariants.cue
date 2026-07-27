package catalog

authors:     [#Id]: #Author
models:      [#Id]: #Model
providers:   [#Id]: #Provider
routes:      [#Id]: #Route
deployments: [#Id]: #Deployment
evidence:    [#Id]: #Evidence

#Catalog: {
	_modelRefs: {
		for id, model in models {
			"\(id):author": authors[model.authorId]
			for parentId in model.derivedFrom {
				"\(id):derivedFrom:\(parentId)": models[parentId]
			}
		}
	}

	_routeRefs: {
		for id, route in routes {
			"\(id):provider": providers[route.providerId]
			for evidenceId in route.dataHandling.evidenceIds {
				"\(id):dataHandling:\(evidenceId)": evidence[evidenceId]
			}
			for evidenceId in route.moderation.evidenceIds {
				"\(id):moderation:\(evidenceId)": evidence[evidenceId]
			}
		}
	}

	_deploymentRefs: {
		for id, deployment in deployments {
			"\(id):model": models[deployment.modelId]
			for routeId in deployment.routeIds {
				"\(id):route:\(routeId)": routes[routeId]
			}
			if deployment.modelSelection.mode == "provider_alias" && deployment.modelSelection.observedModelId != _|_ {
				"\(id):observedModel": models[deployment.modelSelection.observedModelId]
			}
			if deployment.modelSelection.mode == "provider_routed" && deployment.modelSelection.candidateModelIds != _|_ {
				for candidateId in deployment.modelSelection.candidateModelIds {
					"\(id):candidate:\(candidateId)": models[candidateId]
				}
			}
		}
	}

	_providerSlugUniqueness: {
		for id, provider in providers {
			for slug in provider.slugs {
				(slug): id
			}
		}
	}
}
