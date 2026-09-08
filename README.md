# Stogas Catalog

The signed fact catalog used by the Stogas gateway and public model directory.

The graph has five node types: author, model, provider, route, and deployment. Models and
deployments list their accepted aliases directly; authors and providers use only canonical IDs.
The compiler resolves provider/route/model inheritance and emits flattened runtime and public
bundles. Provider request conversion, credentials, executable endpoint allowlists, and routing
behavior remain in the gateway.

Deployments keep provider selection literal under a closed `upstream` block. The compiler permits
only provider selectors already implemented by the gateway; it never accepts arbitrary request
patches or invents equivalence between provider labels. OpenAI Fast deployments retain the
provider's documented `priority` wire value while their public IDs use `-fast`; the gateway accepts
both official request spellings. Reasoning lists are admission facts, while Bifrost owns the
remaining provider wire conversion.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run editor
```

Generated runtime and public JSON are committed so catalog changes remain reviewable.

A release is one monotonically increasing sequence and a manifest containing the runtime and public
SHA-256 values. GitHub attests that manifest. Stogas independently builds the same bytes and signs
the same manifest with Ed25519. The release command publishes immutable content-addressed artifacts
and conditionally advances `latest.json`. Public verification keys are committed under `keys/`;
private release and object-storage credentials remain outside GitHub Actions. Staging uses a
separate signing key; production verification rejects that key. Staging can also verify production
releases. A local staging release can replace GitHub's build proof with a manifest-bound placeholder,
but it still requires a real Stogas signature.
