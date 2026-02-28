ARG BASE_IMAGE=agent-bundle/execd:latest
FROM ${BASE_IMAGE}

RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache py3-pip; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "unsupported base image: missing apk/apt-get" && exit 1; \
    fi

RUN python3 -m pip install --no-cache-dir --break-system-packages autopep8 \
    || python3 -m pip install --no-cache-dir autopep8
