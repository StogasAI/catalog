# Stogas Catalog

The signed catalog of models, providers, deployments, prices, and data-handling facts used by the Stogas gateway and public model directory.

[Field reference](https://stogas.ai/docs/policies/routing-fields) · [Security](SECURITY.md)

## Repository

- `source/`: reviewable catalog records, CUE schema, and build scripts
- `generated/`: the committed catalog, a root and the parts it names, so every change stays reviewable
- `editor/`: the local catalog editor

The catalog has six record types: author, group, model, provider, route, and deployment. A record can list named, dated periods that change its facts for a time, such as a promotional price. The compiler resolves inheritance and emits one flattened catalog with the base graph and, for each dated state, the records that differ from it. Every reader, the gateway included, reads the same files. The root, `catalog.json`, summarizes every record, current or retired: authors, groups and providers whole, and for each model, route and deployment the fields that list, link and resolve it, with the part that holds the whole record. Parts in `catalog.parts/` hold those records: first the records without a retirement date, then the others by date. A part ends before a record whose ID hash falls below the record's share of 128 KiB, so a change rewrites only the part around it. The root names each part by SHA-256 and size with the latest retirement date in it, so a page that shows one model reads one part, and readers skip a part once all its records have retired, without a release. A deployment, a route or a provider can have a `retirementDate`: the date that the provider names for its shutdown or retirement, as the provider names it. A provider's date ends each of its routes, and a deployment retires once its routes have all retired. A model or a route retires with its last deployment, a provider with its last route, an author with its last model, and a group with the last model in it or its child groups, once all of them have dates. Readers treat a record as serving until its date has ended everywhere on Earth, at 12:00 UTC on the next day, so it never retires before its provider stops it. Request conversion, credentials, and routing stay in the gateway. Prices are decimal USD strings; `retentionDays: null` means unknown, not zero.

## Develop

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

`bun run check:periods` lists dated periods that have ended or that started without an end, so their changes can move into the records.

## Releases

Each release has an increasing sequence number and a manifest with the source commit, a source digest, and the root's hash and size. The root names every part by hash, so the manifest covers them too. The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420) and SHA-256, sorted by path. GitHub attests the manifest and the root. Stogas rebuilds the same bytes from its own copy of the source, then approves the manifest in its signed evidence. Gateways load only approved catalogs.

Stogas builds releases with `bun run build:release`, which needs Docker. It installs, builds and checks the catalog in a disposable container with a read-only copy of the source, then copies out the root and its parts after the container stops. Publication uses those files and runs no package scripts. `bun run test:release` tests this isolation.

## License

[Apache-2.0](LICENSE).
