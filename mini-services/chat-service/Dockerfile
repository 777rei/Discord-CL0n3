FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY index.ts ./

# Expose port
EXPOSE 3003

# Start
CMD ["bun", "index.ts"]
