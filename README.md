# Stogas Catalog

The signed catalog of models, providers, deployments, prices, and data-handling facts that the Stogas gateway routes with and the public model directory shows. The gateway, not the catalog, converts requests, holds credentials, and routes.

[Field reference](https://stogas.ai/docs/policies/routing-fields) · [Security](SECURITY.md)

## Repository

| Path              | Contents                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| `source/data/`    | One YAML record for each author, group, model, provider, route, and deployment |
| `source/cue/`     | The schema that every record passes                                            |
| `source/scripts/` | The compiler and release tools                                                 |
| `generated/`      | The compiled catalog, committed so that every change is reviewable             |
| `editor/`         | A local editor for the records                                                 |

## Format

- Records inherit facts from their parents. The compiler resolves inheritance, so every reader, the gateway included, reads the same flat files.
- `generated/catalog.json` is the root. It lists every record with the fields that list, link, and resolve it, and names each part in `generated/catalog.parts/` by SHA-256 and size. A page that shows one model reads one part.
- A record can list named, dated periods that change its facts for a time, such as a promotional price. The catalog holds the base graph and, for each dated state, the records that differ from it.
- Prices are decimal USD strings. `retentionDays: null` and `trainingUse: null` mean unknown, not zero or false.
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

The catalog lists the whole market, including what Stogas does not serve. A provider, route, or deployment says so with `stogasSupported: false`, and its `notes` say why. The answer passes down the same way a retirement date does: from a provider to its routes, and from a route to its deployments. A deployment serves on all of its routes or on none of them, so a route without Stogas support needs deployments of its own. A model, provider, author, or group goes unserved once all of its records in the table above do.

Compiled route and deployment records, and every summary in the root, state `stogasSupported` as `true` or `false`. Each compiled record lists its `notes` with the record that states each one, such as `{ "kind": "route", "id": "aws-batch-messages", "text": "…" }`. A route record also lists its provider's notes, and a deployment record those of its routes, so an unserved record carries the reason.

OpenAI's Batch API, Anthropic's Message Batches API and Amazon Bedrock's batch inference are listed this way, on routes of their own that state `batch: true`. Their deployments serve no other route and name no service tier. The gateway has no batch API, so the schema marks every batch route as unserved.

Unserved records sit in their own parts, which the root marks with `stogasSupported: false`. The gateway never reads those parts, so it never routes to these records. A request that names one fails.

## Develop

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

`bun run check:periods` lists dated periods that have ended, or that started without an end, so that their changes can move into the records.

## Releases

- Each release has an increasing sequence number and a manifest with the source commit, a source digest, and the root's hash and size. The root names every part by hash, so the manifest covers the parts too.
- The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420), and SHA-256, sorted by path.
- GitHub attests the manifest and the root. Stogas rebuilds the same bytes from its own copy of the source and approves the manifest in its signed evidence. Gateways load only approved catalogs.
- `bun run build:release` builds and checks the catalog in a disposable Docker container with a read-only copy of the source. Publication uses the files it copies out and runs no package scripts. `bun run test:release` tests this isolation.

## License

[Apache-2.0](LICENSE).
