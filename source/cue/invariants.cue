package catalog

authors: close({[#Id]: #Author})
groups: close({[#Id]: #Group})
locations: close({[#LocationId]: #Location})
models: close({[#Id]: #Model})
providers: close({[#Id]: #Provider})
routes: close({[#Id]: #Route})

// Each deployment has its own file in its provider's directory, and the build files it under
// that provider, so each one meets its provider's hostings and upstream fields without a lookup across the
// catalog, and validation time grows with the number of deployments rather than its square.
deployments: close({})
deploymentsByProvider: close({[#Id]: close({[#Id]: #Deployment})})
deploymentsByProvider: openai?: [#Id]: {hosting: "openai", upstream: #OpenAIUpstream}
deploymentsByProvider: anthropic?: [#Id]: {hosting: "anthropic", upstream: #AnthropicUpstream}
deploymentsByProvider: chutes?: [#Id]: #ChutesDeployment
deploymentsByProvider: azure?: [#Id]: {hosting: "azure" | "anthropic" | "fireworks", upstream: #AzureUpstream}
deploymentsByProvider: aws?: [#Id]: #AWSDeployment
deploymentsByProvider: "google-cloud"?: [#Id]: #GoogleCloudDeployment
