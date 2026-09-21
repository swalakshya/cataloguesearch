# Multi-stage build for React frontend

# Stage 1: Build the React application
FROM node:26-alpine AS build

# Set working directory
WORKDIR /app

# Set placeholder for runtime injection
ENV REACT_APP_RECAPTCHA_SITE_KEY=__REACT_APP_RECAPTCHA_SITE_KEY__
ENV REACT_APP_LLM_API_BASE_URL=__REACT_APP_LLM_API_BASE_URL__
ENV REACT_APP_GOOGLE_CLIENT_ID=__REACT_APP_GOOGLE_CLIENT_ID__

# The local dev tools (Eval, Discover, Deploy) are never part of the production site. With this set to false the
# bundler drops them without even looking for their folders, which docker/frontend/Dockerfile.dockerignore leaves out.
ENV REACT_APP_DEV_TOOLS=false

# Copy package files first for better dependency caching
COPY frontend/package*.json ./

# Install all dependencies (including dev dependencies for build)
# This layer will be cached unless package.json changes
RUN --mount=type=cache,target=/root/.npm npm install

# Copy static assets and config files (rarely change)
COPY frontend/public/ ./public/
COPY frontend/tailwind.config.js* ./
COPY frontend/postcss.config.js* ./

# Copy source code last (most frequently changed)
COPY frontend/src/ ./src/

# Build the application. The cache mount keeps webpack/babel's cache between builds, so when something does
# change the rebuild is much faster than a cold one.
RUN --mount=type=cache,target=/app/node_modules/.cache npm run build

# Guard: fail the build if dev-tools code ever ends up in the production bundle (e.g. someone imports it directly).
RUN if grep -rqE "api/(deploy|discover|jobs)|Verify sub-sections|dev server offline" build/static/js; then \
      echo "ERROR: dev tools leaked into the production bundle" >&2; exit 1; fi

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built app from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Ensure proper permissions for all files and directories
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + && \
    find /usr/share/nginx/html -type f -exec chmod 644 {} +

# Copy nginx configuration
COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf

# Copy and make entrypoint script executable
COPY docker/frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Use entrypoint script
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
