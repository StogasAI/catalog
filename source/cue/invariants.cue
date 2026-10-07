package catalog

authors: [#Id]:     #Author
groups: [#Id]:      #Group
models: [#Id]:      #Model
providers: [#Id]:   #Provider
routes: [#Id]:      #Route
deployments: [#Id]: #Deployment

#Catalog: {
	_groupRefs: {
		for id, group in groups {
			"\(id):author": authors[group.authorId]
			for parentId in group.parentIds {
				"\(id):parent:\(parentId)": groups[parentId]
			}
		}
	}
	_modelRefs: {
		for id, model in models {
			"\(id):author": authors[model.authorId]
			for groupId in model.groupIds {
				"\(id):group:\(groupId)": groups[groupId]
			}
			for parentId in model.derivedFrom {
				"\(id):derivedFrom:\(parentId)": models[parentId]
			}
		}
	}

	_routeRefs: {
		for id, route in routes {
			"\(id):provider": providers[route.providerId]
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
				if routes[routeId].providerId == "chutes" {
					"\(id):chutesUpstream:\(routeId)": deployment.upstream & #ChutesUpstream
				}
				if routes[routeId].providerId == "azure" {
					"\(id):azureUpstream:\(routeId)": deployment.upstream & #AzureUpstream
				}
			}
		}
	}

}
