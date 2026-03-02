ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache python3; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "unsupported base image: missing apk/apt-get" && exit 1; \
    fi

WORKDIR /app
RUN mkdir -p /skills /workspace
COPY package.json /app/package.json
RUN npm install --production
COPY src/*.mjs /app/

EXPOSE 3000
ENTRYPOINT ["node", "/app/execd.mjs"]
