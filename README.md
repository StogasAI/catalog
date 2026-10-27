# Stogas Catalog

The signed catalog of models, providers, deployments, prices, and data-handling facts used by the Stogas gateway and public model directory.

[Field reference](https://stogas.ai/docs/policies/routing-fields) · [Security](SECURITY.md)

## Repository

- `source/`: reviewable catalog records, CUE schema, and build scripts
- `generated/`: committed runtime and public bundles, so every change stays reviewable
- `editor/`: the local catalog editor

The catalog has six record types: author, group, model, provider, route, and deployment. A record can list named, dated periods that change its facts for a time, such as a promotional price. The compiler resolves inheritance and emits flattened bundles with the base graph and, for each dated state, the records that differ from it: `catalog.runtime.json` for gateways and `catalog.public.json` for everyone else. A deployment that retired on or before the `archive_through` date in `source/release-policy.json` moves to `catalog.archive.json` as it was on its last day, and a model moves there once all its deployments have. The public bundle names the archive by SHA-256 and size, and the runtime bundle keeps only each archived record's retirement date. Releases move the date forward, so readers load only current records while the archive keeps the history. Request conversion, credentials, and routing stay in the gateway. Prices are decimal USD strings; `retentionDays: null` means unknown, not zero.

## Develop

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

`bun run check:periods` lists dated periods that have ended or that started without an end, so their changes can move into the records.

## Releases

Each release has an increasing sequence number and a manifest with the source commit, a source digest, and each artifact's hash and size. The public bundle names the archive by its hash, so the manifest covers the archive too. The source digest is the SHA-256 of the canonical JSON list of every committed file's path, executable mode (493 or 420) and SHA-256, sorted by path. GitHub attests the manifest and artifacts. Stogas rebuilds the same bytes from its own copy of the source, then approves the manifest in its signed evidence. Gateways load only approved catalogs.

Stogas builds releases with `bun run build:release`, which needs Docker. It installs, builds and checks the catalog in a disposable container with a read-only copy of the source, then copies out the artifacts after the container stops. Publication uses those artifacts and runs no package scripts. `bun run test:release` tests this isolation.

## License

[Apache-2.0](LICENSE).
