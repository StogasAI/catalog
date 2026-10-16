package catalog

authors: close({[#Id]: #Author})
groups: close({[#Id]: #Group})
models: close({[#Id]: #Model})
providers: close({[#Id]: #Provider})
routes: close({[#Id]: #Route})
deployments: close({[#Id]: #Deployment})

#Catalog: {
	_providerUpstreams: {
		for id, deployment in deployments {
			for routeId in deployment.routeIds {
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
