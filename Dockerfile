# --- Build stage: compile the static site with Vite ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Each new build gets a unique ID, so browsers drop their old autosave once
# after a release. Optionally pass a name: --build-arg BUILD_ID=v1.2.0
ARG BUILD_ID
RUN npm run build

# --- Runtime stage: serve dist/ with nginx (no Node at runtime) ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
