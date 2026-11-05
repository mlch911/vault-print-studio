FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js LICENSE THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY public ./public
RUN npm run build && cp LICENSE THIRD_PARTY_NOTICES.md dist/

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
EXPOSE 80
