FROM e2bdev/base:latest
RUN mkdir -p /skills /workspace && chmod 777 /workspace
COPY ./skills/ /skills/
RUN pip install --no-cache-dir pandas matplotlib numpy
