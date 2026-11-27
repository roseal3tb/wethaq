# Wethaq API image. Build from the repository root, because the API shares the chaincode rules
# (chaincode/shipment/src/rules.ts) and the seed data (src/data) with the rest of the project:
#   docker build -f wethaq-api/Dockerfile -t wethaq-api .
# No secrets are baked in: JWT_SECRET, DATABASE_URL and the rest come from the environment at run time.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY wethaq-api/package.json wethaq-api/package-lock.json wethaq-api/
RUN cd wethaq-api && npm ci --omit=dev --no-audit --no-fund
COPY wethaq-api/tsconfig.json wethaq-api/
COPY wethaq-api/src wethaq-api/src
COPY wethaq-api/migrations wethaq-api/migrations
COPY wethaq-api/openapi.json wethaq-api/openapi.json
COPY chaincode/shipment/src chaincode/shipment/src
COPY src/data src/data
COPY src/types.ts src/types.ts
COPY src/utils src/utils
COPY analysis/results analysis/results
# The analysis scripts are copied only so the API can tell whether the results are older than the scripts (MANIFEST.json).
COPY analysis/scripts analysis/scripts
WORKDIR /app/wethaq-api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Applies pending migrations, then starts the API.
CMD ["sh", "-c", "node_modules/.bin/tsx src/cli/migrate.ts && exec node_modules/.bin/tsx src/server.ts"]
