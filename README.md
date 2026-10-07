# Stogas Catalog

The signed fact catalog used by the Stogas gateway and public model directory.

The graph has six node types: author, group, model, provider, route, and deployment. Models and
deployments list their accepted selectors directly; authors and providers may also publish aliases.
The compiler resolves provider/route/model inheritance and emits flattened runtime and public
bundles. Provider request conversion, credentials, executable endpoint allowlists, and routing
behavior remain in the gateway.

Groups belong to an author and may have several parents, with no cycles. Models name their direct
groups in `groupIds`. Groups carry names and membership only; they never supply capabilities, prices,
or data-handling facts and do not change historical execution hashes.

Models and deployments marked `retired: true` remain in a separate archive. Retiring a model retires
its deployments; shared authors, groups, providers, and routes remain in the active catalog while
needed. Retirement is explicit, so the same source always builds the same artifacts regardless of
the build date. Retired deployments are excluded from runtime routing. **Include retired** loads
the archive in the directory and editor; retained model and deployment URLs remain accessible.

The gateway owns a universal text estimator and separate message/tool framing allowances.
Catalog models do not select tokenizers or estimation coefficients. Input estimates are clipped
to each deployment's input ceiling; actual provider usage remains authoritative for settlement.

Deployments keep provider selection literal under a closed `upstream` block. The compiler permits
only provider selectors already implemented by the gateway; it never accepts arbitrary request
patches or invents equivalence between provider labels. OpenAI Fast deployments retain the
provider's documented `priority` wire value while their public IDs use `-fast`; the gateway accepts
both official request spellings. Reasoning lists are admission facts, while Bifrost owns the
remaining provider wire conversion.

Prices are canonical decimal USD strings, with up to 36 fractional digits and a maximum rate of $1 trillion. The rate key supplies the quantity denominator. For example, `"0.001"` under `per_mill_tokens` means $0.001 per million tokens. Exponents and excess precision are rejected.

## Data handling

`retentionDays` is the maximum disclosed time the provider may retain stored prompts and
responses. `null` means unknown, not zero. `zeroDataRetention` describes an offering with no
persistent retention of prompts and responses. Temporary in-memory prompt caching is compatible
with ZDR and is excluded from `retentionDays`; persistent caches are not. `trainingUse` separately
records whether the provider may use the content for training. These facts describe the selected
offering, not every service or optional feature the provider offers.

Native document support is published as `fileInputs.mediaTypes` and `fileInputs.extensions`.
Each route declares its formats directly; a deployment override replaces both lists across
its routes and may add or remove formats. The runtime resolves these facts separately for each route.
Image and audio content blocks use modality facts instead. File support includes provider-side
preprocessing and does not require the model to consume the original format.
These declarations describe upstream document support; gateway text extraction can replace
an inline text file with prompt text before native document restrictions apply.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

Generated runtime, public, and archive JSON are committed so catalog changes remain reviewable.

A release has a monotonically increasing sequence and a manifest containing the runtime and public
artifact hashes and byte lengths. GitHub attests that manifest and both artifacts. Stogas independently builds the same bytes and signs
the same manifest with ML-DSA-65. The release command publishes immutable content-addressed artifacts
and conditionally advances `latest.json`. The operator supplies the environment's currently authorized
ML-DSA-65 public key through `CATALOG_AUTHORIZED_SIGNING_KEYS_JSON`; rotating an online key does not
require changing the publisher. Private release and object-storage credentials remain outside
GitHub Actions. Staging and production have separate signing authorization.
The public artifact commits to the archive's SHA-256 digest and exact length. The archive uses the
same content-addressed storage and release approval; it has no separate latest pointer. Readers
verify it against that public-artifact reference before merging records.
A local staging release can replace GitHub's build proof with a manifest-bound placeholder,
but it still requires a real Stogas signature.

Release evidence contains `document`, `signature`, and `provenance`. The document owns its schema
and uses snake_case fields, a shared source identity, and filename-keyed artifacts with `sha256`
and `size_bytes`. RFC 8785 canonical JSON defines signed bytes; files add one final newline.
The Stogas signature proves approval of the shared manifest. It does not prove that the independent
rebuild happened; the evidence does not attest the Stogas builder.
