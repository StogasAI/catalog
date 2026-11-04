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
- Prices are decimal USD strings. `retentionDays: null` means unknown, not zero.

## Retirement

- A deployment, a route, or a provider can have a `retirementDate`, as its provider names it. A provider's date ends each of its routes.
- A deployment retires once all its routes have. A model or a route retires with its last deployment, a provider with its last route, an author with its last model, and a group with the last model in it or in its child groups. A record retires this way only once all those records have dates.
- A record serves until its date has ended everywhere on Earth, at 12:00 UTC on the next day, so it never retires before its provider stops it.

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
