FROM node:18-bookworm AS base

## Prepare Rust
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

## Prepare Node (Yarn)
WORKDIR /affine/build
RUN corepack enable
RUN git clone https://github.com/toeverything/AFFiNE.git .
ENV BUILD_TYPE=canary

RUN yarn install

WORKDIR /affine/build/packages/backend/server/
RUN yarn build

WORKDIR /affine/build/packages/backend/storage/
RUN yarn build

FROM node:18-bookworm-slim AS affine-front
WORKDIR /app

## ARG USER=affine
## RUN useradd -d /app --shell /bin/bash $USER \
##     && mkdir -p /app/data && chown $USER:$USER /app/data
## USER $USER
## COPY --from=base --chown=$USER:$USER /affine/build/packages/backend/server/ /app/

COPY --from=base /affine/build/packages/backend/server/ /app/

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

CMD ["node", "--es-module-specifier-resolution=node", "./dist/index.js"]

FROM node:18-bookworm-slim AS affine-self
ARG TARGETARCH
WORKDIR /app

## ARG USER=affine
## RUN useradd -d /app --shell /bin/bash $USER \
##     && mkdir -p /app/data && chown $USER:$USER /app/data
## USER $USER
## COPY --from=base --chown=$USER:$USER /affine/build/packages/backend/server/ /app/
## COPY --from=base --chown=$USER:$USER /affine/build/packages/backend/server/node_modules/ /app/node_modules/

COPY --from=base /affine/build/packages/backend/server/ /app/
COPY --from=base /affine/build/packages/backend/server/node_modules/ /app/node_modules/
COPY --from=base /affine/build/packages/backend/storage/storage.node /app/storage.node

RUN if [ "$TARGETARCH" = "arm64" ]; then \
    mv /app/storage.node /storage.arm64.node; \
    fi

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV DATABASE_URL=postgresql://affine:affine@postgres:5432/affine

CMD ["sh", "-c", "npm run predeploy && node --es-module-specifier-resolution=node ./dist/index.js"]
