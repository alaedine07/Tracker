FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY server/package.json server/
COPY shared/package.json shared/

# Install dependencies
RUN npm install --workspace=server --workspace=shared

# Copy source code
COPY shared/ shared/
COPY server/ server/

# Build
RUN npm run build --workspace=server

# --- Production stage ---
FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY server/package.json server/
COPY shared/package.json shared/

RUN npm install --workspace=server --workspace=shared --omit=dev

COPY --from=builder /app/server/dist server/dist
COPY shared/ shared/

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
