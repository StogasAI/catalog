FROM golang:1.26.5@sha256:53eeac89074db483fdf0ab3be1df32bf6e47562263d2d0d6baa7f26acb4957dd AS cue
RUN CGO_ENABLED=0 GOBIN=/out go install cuelang.org/go/cmd/cue@v0.16.1

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bun

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /workspace && chown node:node /workspace
COPY --from=cue /out/cue /usr/local/bin/cue
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
USER node
WORKDIR /workspace
