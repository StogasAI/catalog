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
				if routes[routeId].providerId == "openai" {
					"\(id):openaiUpstream:\(routeId)": deployment.upstream & #OpenAIUpstream
				}
				if routes[routeId].providerId == "anthropic" {
					"\(id):anthropicUpstream:\(routeId)": deployment.upstream & #AnthropicUpstream
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
