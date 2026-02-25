FROM e2bdev/base:latest
RUN mkdir -p /skills /tools /workspace
COPY ./skills/ /skills/
COPY ./tools/ /tools/
RUN if [ -f /tools/setup.sh ]; then chmod +x /tools/setup.sh && /tools/setup.sh; fi
