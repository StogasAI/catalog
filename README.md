# Stogas Catalog

The signed fact catalog used by the Stogas gateway and public model directory.

The graph has five node types: author, model, provider, route, and deployment. Models and
deployments list their accepted aliases directly; authors and providers use only canonical IDs.
The compiler resolves provider/route/model inheritance and emits flattened runtime and public
bundles. Provider request conversion, credentials, executable endpoint allowlists, and routing
behavior remain in the gateway.

Every model requires `tokenizerFamily`, which selects the gateway's local input-token estimator.
Supported values are `openai`, `anthropic`, `deepseek`, `qwen3`, `qwen35`, `gemma`, `minimax`,
`tekken`, `kimi`, and `glm`. Providers and deployments cannot override it. The gateway owns
the counting algorithms, pinned vocabularies, and safety margins; this field does not claim
an exact provider tokenizer. Adding a model requires a reviewed family choice and calibration.

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

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

Generated runtime and public JSON are committed so catalog changes remain reviewable.

A release is one monotonically increasing sequence and a manifest containing the runtime and public
SHA-256 values. GitHub attests that manifest and both artifacts. Stogas independently builds the same bytes and signs
the same manifest with Ed25519. The release command publishes immutable content-addressed artifacts
and conditionally advances `latest.json`. The operator supplies the environment's currently authorized
Ed25519 public key through `CATALOG_AUTHORIZED_SIGNING_KEYS_JSON`; rotating an online key does not
require changing the publisher. Private release and object-storage credentials remain outside
GitHub Actions. Staging and production have separate signing authorization.
A local staging release can replace GitHub's build proof with a manifest-bound placeholder,
but it still requires a real Stogas signature.

Release evidence contains `schema: "stogas.release-evidence.v1"`, `manifest`, `signature`, and `attested_builds`. The Stogas signature proves approval of the shared manifest. It does not prove that the independent
rebuild happened; the current evidence does not attest the Stogas builder.
