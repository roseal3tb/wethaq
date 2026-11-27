# Chaincode-as-a-service image: the chaincode runs in its own container and the peers connect to it,
# so the peers never have to build chaincode images themselves (used by fabric/up.sh).
# NODE_IMAGE can point at a mirror of the official image, for example
# public.ecr.aws/docker/library/node:20-bookworm-slim, when Docker Hub rate-limits anonymous pulls.
ARG NODE_IMAGE=node:20-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ARG CC_SERVER_PORT=9999
ENV CHAINCODE_SERVER_ADDRESS=0.0.0.0:${CC_SERVER_PORT}
EXPOSE ${CC_SERVER_PORT}
USER node
# CHAINCODE_ID is set by the deploy script when the container starts.
CMD ["sh", "-c", "exec node_modules/.bin/fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID"]
