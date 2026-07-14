# Stage 1: Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build the React frontend
COPY . .
RUN npm run build

# Stage 2: Runtime stage
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist
# Copy backend source
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose the port the app runs on
EXPOSE 3000

# Start the application using tsx
CMD ["npx", "tsx", "server.ts"]
