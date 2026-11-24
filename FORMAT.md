# Catalog format

The rules that the YAML records in `source/data/` and the compiled files in `generated/` follow. The schema in `source/cue/` enforces them.

## Records

- Records inherit facts from their parents. The compiler resolves inheritance, so every reader, the gateway included, reads the same flat files.
- `generated/catalog.json` is the root. It lists every record with the fields that list, link, and resolve it, and names each part in `generated/catalog.parts/` by SHA-256 and size. A page that shows one model reads one part.
- A record can list named, dated periods that change its facts for a time, such as a promotional price. Periods of one record can run at the same time only when they change different fields, so a price that two reasons change at once needs a period of its own. The catalog holds the base graph and, for each dated state, the records that differ from it.
- Prices are decimal USD strings. `retentionDays: null` and `trainingUse: null` mean unknown, not zero or false.
- A record states only the guarantees that hold: a provider's `zeroDataRetention`, `tee`, `teeVerified` and `isolatedPromptCache`, and a route's `endToEndEncrypted`. Compiled records state each one, false where the source omits it. `isolatedPromptCache` means that the provider keeps each account's prompt cache apart, so that no other account can learn from cached token counts or response times what one account sent. A route with a managed credential never states it, because every customer shares that account.
- `source/data/companies.yaml` lists each company that a record names, with its headquarters, a country that `locations` lists. An author and a provider name their company with `companyId`, so one company can own several of them.
- `hosting` names the company that runs a model, or `unknown`. It is the provider's company unless a route names another for all of its deployments, or a deployment names its own. Every compiled deployment states it.
- `sharedWith`, a data handling fact, lists every other company that receives requests on its own terms, such as the model's developer for abuse monitoring, or `unknown` for the website publishers that a fetch tool calls. The provider's company, the hosting, and these companies are all that receive a request.
- `certifications`, a data handling fact, lists the independent audits and government authorizations of the service that processes requests, from a closed list: `soc2-type2`, `iso-27001`, `iso-27017`, `iso-27018`, `iso-27701`, `iso-42001`, `pci-dss`, `csa-star-level-2`, `hipaa-eligible`, `fedramp-moderate`, `fedramp-high`, `dod-il2`, `dod-il4` and `dod-il5`. A record lists one only where a page of the company that runs the service names that service in the audit's scope, so an empty list means that no such page exists. `hipaa-eligible` means that the company signs a business associate agreement for the service, not that a customer has one. A FedRAMP or DoD entry also lists the levels below it. A route's or a deployment's list replaces its parent's, and a deployment that another company runs states its own, because an audit covers the company that runs the service. A hosted tool's `certifications` lists the entries of its route's list that cover a request which lets the model call the tool, and is left out when all of them do. Each deployment keeps those of its own entries that the tool's list names. The request names the server of an `mcp` tool, so its offer states no data handling in source, and the build states every fact of it as unknown and an empty list of certifications.
- A provider's `accountOptions` lists what an account with the provider can hold that changes how the provider handles requests: an agreement, a setting, or a place for stored content. Each option names the provider's routes that it covers, the data handling facts that it sets as whole values (`storageLocation`, `retentionDays`, `trainingUse` and `zeroDataRetention: true`), and the certifications that it `grants`. `hipaa` is the only granted certification, and it holds where the record lists `hipaa-eligible` and the account holds the option. Options that share a `group` are values of one setting, so an account holds one of them at most. The catalog states what an option changes. Whether an account holds it is a fact of the credential, which no catalog states.
- The build writes on each route record of a compiled deployment the `accountOptions` that reach it: the provider's options that cover the route, that the deployment does not remove with `overrides.accountOptions.<id>: false`, that set no fact which the deployment's own terms leave unknown, as the preview terms of Azure do, whose retention is not under the model's minimum, and that change the record, by a fact that differs or a certification that the record is eligible for. A deployment removes an option that would change its record and that its own terms leave out for another reason, such as a model that another company runs.
- A model's `minimumRetentionDays` is the fewest days that its author requires every provider to keep content. Each record of the model takes it in place of a shorter retention, so no deployment repeats it, and a retention that the provider leaves unknown stays unknown.
- A deployment takes the data handling that its upstream fields decide and does not restate it. An inference geography sets where inference runs, an Azure Data Zone that Microsoft runs keeps processing and storage in its zone, and Azure Instant, Flex and preview models leave storage, retention and training unknown and list no certification. The `us-gov` geography is Bedrock's profile of the AWS GovCloud (US) Regions, which runs in the United States.
- A route is one API of a provider. AWS and Google Cloud have a route for each product that serves Claude, such as Amazon Bedrock and Claude Platform on AWS, and each product's company runs every deployment on it.
- A route's `interfaces` lists the client APIs that Stogas serves on it: `chat_completions`, `responses` and `messages`. `convertedInterfaces` lists those among them that the provider's API does not take itself, whose requests the gateway converts to the provider's API and whose replies it converts back; compiled records state it, empty where the route converts none. Each route of a deployment takes different interfaces itself, and a request goes to the route that takes its interface itself where the deployment has one.
- A route's `endpoint` is the URL that every account calls for it, and `null` where the URL names an account's region, project or resource, as on AWS, Google Cloud and Azure. An OpenAI deployment with `upstream.inferenceGeo` calls the same path on its data residency host, such as `eu.api.openai.com`. Readers show it: the gateway calls the hosts in its own code, so a catalog cannot send requests elsewhere.
- `source/data/locations.yaml` lists places as a graph. Each place has a kind, `world`, `continent`, `region`, `union`, `country` or `subdivision`. A continent, region or union lists every country that it covers, and the build derives the places that directly contain each place from those lists. A record names a place for data handling, as a company's headquarters, or in a provider's `accountLocations`, where an account's resources can keep data. The file lists every country, because a headquarters and an access policy can name any, and a subdivision only while a data handling or account location names it.

## Retirement

Deployments, routes, and providers take a `retirementDate` from their provider, and a provider's date also ends its routes. A record also retires once all of these have retired:

| Record       | Retires with                                   |
| ------------ | ---------------------------------------------- |
| Deployment   | its routes                                     |
| Model, route | its deployments                                |
| Provider     | its routes                                     |
| Author       | its models                                     |
| Group        | its models, including its child groups' models |

A record serves until its date ends everywhere on Earth, at 12:00 UTC the next day.

## How Stogas serves

The catalog lists the whole market, including what Stogas does not serve. Stogas serves a record in up to two ways: with the customer's own credential for the provider, and with Stogas's own provider account. A provider offers each way with `stogasByok: true` and `stogasManaged: true`. A route or deployment withdraws a way that its parents offer with `stogasByok: false` or `stogasManaged: false`, and the build rejects a `false` that withdraws nothing. A deployment's routes must agree on each way, so a route that differs needs deployments of its own.

A record that offers neither way is unserved. A model, provider, author, or group offers a way once one of its records in the retirement table above does, and a part once one of the records in it does. Compiled route and deployment records, every summary in the root, and every part that the root names state `stogasByok` and `stogasManaged` as `true` or `false`.

A record's `notes` state a surprising fact that no field can say. Each compiled record lists its notes with the record that states each one, such as `{ "kind": "route", "id": "chutes-chat-completions", "text": "…" }`. A route record also lists its provider's notes, and a deployment record those of its provider, routes and model.

OpenAI's Batch API, Azure's batch jobs, Anthropic's Message Batches API on Anthropic, AWS and Google Cloud, and Amazon Bedrock's batch inference are listed on routes of their own that state `batch: true`. Their deployments serve no other route and name no service tier, and on Azure they take a batch deployment type, `global_batch` or `data_zone_batch_us`, because Azure runs batch jobs only on those. The gateway has no batch API, so a batch route offers neither way and states neither flag.

A route states `supportsCancellation: true` when its streams report the usage so far before they end and its provider bills a stream that the client stops for no more than the last report. The gateway then stops the provider call when the client stops, and bills the usage that the stream reported. Every compiled route states it as `true` or `false`.

Unserved records sit in their own parts. The gateway never reads those parts, so it never routes to these records, and a request that names one fails.

## Releases

- Each release has an increasing sequence number and a manifest with the source commit, a source digest, and the root's hash and size. The root names every part by hash, so the manifest covers the parts too.
- The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420), and SHA-256, sorted by path.
- `bun run build:release` builds and checks the catalog in a disposable Docker container with a read-only copy of the source. Publication uses the files it copies out and runs no package scripts. `bun run test:release` tests this isolation.
- `bun run check:periods` lists dated periods that have ended, or that started without an end, so that their changes can move into the records.
