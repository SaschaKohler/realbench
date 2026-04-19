# RealBench Web Frontend
# Multi-stage Build for optimal image size

FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Root tsconfig (extended by workspace packages)
COPY tsconfig.json ./

# Source Code
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build shared package first
RUN pnpm --filter @realbench/shared build

# Build web app (VITE_* vars get embedded at build time)
ARG VITE_API_URL=https://realbench-api.fly.dev
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN pnpm --filter @realbench/web build

# Production stage
FROM nginx:alpine AS production

# Copy built assets from builder stage
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY --from=builder /app/apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Security: Use non-root nginx user (uid 101)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

USER nginx

# Expose port 8080 (non-root can't bind <1024)
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
