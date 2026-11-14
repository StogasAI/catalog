package catalog

authors: close({[#Id]: #Author})
groups: close({[#Id]: #Group})
locations: close({[#LocationId]: #Location})
models: close({[#Id]: #Model})
providers: close({[#Id]: #Provider})
routes: close({[#Id]: #Route})
companies: close({[#Id]: #Company})

// Each deployment has its own file in its provider's directory, and the build files it under
// that provider, so each one meets its provider's upstream fields without a lookup across the
// catalog, and validation time grows with the number of deployments rather than its square.
deployments: close({})
deploymentsByProvider: close({[#Id]: close({[#Id]: #Deployment})})
deploymentsByProvider: openai?: [#Id]: upstream:         #OpenAIUpstream
deploymentsByProvider: anthropic?: [#Id]: upstream:      #AnthropicUpstream
deploymentsByProvider: chutes?: [#Id]: upstream:         #ChutesUpstream
deploymentsByProvider: azure?: [#Id]: upstream:          #AzureUpstream
deploymentsByProvider: aws?: [#Id]: upstream:            #AWSUpstream
deploymentsByProvider: "google-cloud"?: [#Id]: upstream: #GoogleCloudUpstream
