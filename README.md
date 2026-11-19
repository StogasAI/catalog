# Stogas Catalog

The models, providers, deployments, prices, and data handling facts that the Stogas gateway routes with and the [model catalog](https://stogas.ai/catalog) shows. The catalog lists the whole market, and each record says whether Stogas serves it.

[Browse the catalog](https://stogas.ai/catalog) · [Format](FORMAT.md) · [Field reference](https://stogas.ai/docs/policies/routing-fields) · [Security](SECURITY.md)

## Repository

| Path              | Contents                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `source/data/`    | One YAML record for each author, group, model, provider, route, and deployment, and the lists of companies and locations |
| `source/cue/`     | The schema that every record passes                                                                                      |
| `source/scripts/` | The compiler and the release tools                                                                                       |
| `generated/`      | The compiled catalog, committed so that you can review every change                                                      |
| `editor/`         | A local editor for the records                                                                                           |

## Read the catalog

`generated/catalog.json` is the root. It lists every record and names each part in `generated/catalog.parts/` by SHA-256 and size, so a page that shows one model reads one part. Prices are decimal USD strings, and `null` means unknown. [FORMAT.md](FORMAT.md) has the other rules, such as inheritance, dated price periods, and retirement.

## Develop

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

`check` validates every record against the schema, rebuilds `generated/`, and runs the tests. `editor` opens the local editor.

## Releases

Each release has a sequence number and a manifest with the source commit, a source digest, and the root's hash. GitHub Actions and GitLab.com's hosted runners each build a release from its tag and sign a build proof for the manifest and the root. Stogas approves a catalog only when both proofs name the bytes of its own build, and gateways load only the catalogs that its signed evidence approves.

`bun run build:release` builds a release in a disposable Docker container from a read-only copy of the source.

## License

[Apache-2.0](LICENSE).
