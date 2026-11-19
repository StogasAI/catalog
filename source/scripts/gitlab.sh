#!/usr/bin/env bash
# GitLab's rebuild of a release tag, which .gitlab-ci.yml runs with only the variables it names:
# compile the catalog from its records, require the committed catalog to equal it, and sign a build
# proof for the manifest and the root. The compiler needs only Node and CUE, so the job installs no
# packages.
set -euo pipefail
test "$(git rev-parse HEAD)" = "$CI_COMMIT_SHA"
test -z "$(git status --porcelain)"

fetch() {
  curl --fail --location --silent --show-error --output "$1" "$2"
  echo "$3  $1" | sha256sum --check --strict -
}
fetch /tmp/cue.tar.gz \
  https://github.com/cue-lang/cue/releases/download/v0.16.1/cue_v0.16.1_linux_amd64.tar.gz \
  5d644c1305a2b86504c8dcd2ec829cf5b4999efc2cf51ee375624e0455f774ae
tar --extract --gzip --file /tmp/cue.tar.gz --directory /usr/local/bin cue
fetch /usr/local/bin/cosign \
  https://github.com/sigstore/cosign/releases/download/v3.1.4/cosign-linux-amd64 \
  424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa
chmod 755 /usr/local/bin/cosign

node source/scripts/build.mjs --check
node source/scripts/create-proposal.mjs "${CI_COMMIT_TAG#catalog-v}" release-proposal
node source/scripts/provenance.mjs release-proposal > /tmp/statement.json
# Cosign signs with a Fulcio certificate for the job's ID token and logs the proof in Rekor.
cosign attest-blob --statement /tmp/statement.json --bundle gitlab-attestation.jsonl --yes
