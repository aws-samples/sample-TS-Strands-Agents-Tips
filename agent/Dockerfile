# Multi-stage build for AgentCore Runtime deployment.
# AgentCore expects: GET /ping on port 8080, POST /invocations on port 8080.
# Our Express server already implements both when AGENTCORE_PORT is set.

FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

ENV AGENTCORE_PORT=8080

CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/index.js"]
