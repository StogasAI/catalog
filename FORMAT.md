# Catalog format

The rules that the YAML records in `source/data/` and the compiled files in `generated/` follow. The schema in `source/cue/` enforces them.

## Records

- Records inherit facts from their parents. The compiler resolves inheritance, so every reader, the gateway included, reads the same flat files.
- `generated/catalog.json` is the root. It lists every record with the fields that list, link, and resolve it, and names each part in `generated/catalog.parts/` by SHA-256 and size. A page that shows one model reads one part.
- A record can list named, dated periods that change its facts for a time, such as a promotional price. The catalog holds the base graph and, for each dated state, the records that differ from it.
- Prices are decimal USD strings. `retentionDays: null` and `trainingUse: null` mean unknown, not zero or false.
- A record states only the guarantees that hold: a provider's `zeroDataRetention`, `tee` and `teeVerified`, and a route's `endToEndEncrypted`. Compiled records state each one, false where the source omits it.
- `source/data/companies.yaml` lists each company that a record names, with its headquarters. An author and a provider name their company with `companyId`, so one company can own several of them.
- `hosting` names the company that runs a model, or `unknown`. It is the provider's company unless a route names another for all of its deployments, or a deployment names its own. Every compiled deployment states it.
- `sharedWith`, a data handling fact, lists every other company that receives requests on its own terms, such as the model's developer for abuse monitoring, or `unknown` for the website publishers that a fetch tool calls. The provider's company, the hosting, and these companies are all that receive a request.
- A deployment takes the data handling that its upstream fields decide and does not restate it. An inference geography sets where inference runs, an Azure Data Zone that Microsoft runs keeps processing and storage in its zone, and Azure Instant and Flex leave storage, retention and training unknown.
- A route is one API of a provider. AWS and Google Cloud have a route for each product that serves Claude, such as Amazon Bedrock and Claude Platform on AWS, and each product's company runs every deployment on it.
- `source/data/locations.yaml` lists places as a graph. Each place has a kind, `world`, `continent`, `region`, `union`, `country` or `subdivision`. A continent, region or union lists every country that it covers, and the build derives the places that directly contain each place from those lists. A record names a place for data handling, a headquarters, or a provider's `accountLocations`, where an account's resources can keep data. A place stays listed only while a record names it or a place inside it.

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

## What Stogas does not serve

The catalog lists the whole market, including what Stogas does not serve. A provider, route, or deployment says so with `stogasSupported: false`. The answer passes down the same way a retirement date does: from a provider to its routes, and from a route to its deployments. A deployment serves on all of its routes or on none of them, so a route without Stogas support needs deployments of its own. A model, provider, author, or group goes unserved once all of its records in the table above do.

Compiled route and deployment records, and every summary in the root, state `stogasSupported` as `true` or `false`. A record's `notes` state a surprising fact that no field can say. Each compiled record lists its notes with the record that states each one, such as `{ "kind": "route", "id": "chutes-chat-completions", "text": "…" }`. A route record also lists its provider's notes, and a deployment record those of its provider, routes and model.

OpenAI's Batch API, Azure's batch jobs, Anthropic's Message Batches API on Anthropic, AWS and Google Cloud, and Amazon Bedrock's batch inference are listed this way, on routes of their own that state `batch: true`. Their deployments serve no other route and name no service tier, and on Azure they take a batch deployment type, `global_batch` or `data_zone_batch_us`, because Azure runs batch jobs only on those. The gateway has no batch API, so the schema marks every batch route as unserved.

Unserved records sit in their own parts, which the root marks with `stogasSupported: false`. The gateway never reads those parts, so it never routes to these records. A request that names one fails.

## Releases

- Each release has an increasing sequence number and a manifest with the source commit, a source digest, and the root's hash and size. The root names every part by hash, so the manifest covers the parts too.
- The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420), and SHA-256, sorted by path.
- `bun run build:release` builds and checks the catalog in a disposable Docker container with a read-only copy of the source. Publication uses the files it copies out and runs no package scripts. `bun run test:release` tests this isolation.
- `bun run check:periods` lists dated periods that have ended, or that started without an end, so that their changes can move into the records.
