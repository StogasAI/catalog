FROM golang:1.26.5@sha256:53eeac89074db483fdf0ab3be1df32bf6e47562263d2d0d6baa7f26acb4957dd AS cue
RUN CGO_ENABLED=0 GOBIN=/out go install cuelang.org/go/cmd/cue@v0.16.1

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /workspace && chown node:node /workspace
COPY --from=cue /out/cue /usr/local/bin/cue
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
USER node
WORKDIR /workspace
