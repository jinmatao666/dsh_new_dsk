ARG PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm
FROM ${PYTHON_IMAGE}
ARG DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn
# Keep Debian suites and signature verification; change only download origins.
RUN set -eux; \
    for sources in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        if [ -f "$sources" ]; then \
            sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g; s|https://deb.debian.org|${DEBIAN_MIRROR}|g; s|http://security.debian.org|${DEBIAN_MIRROR}|g; s|https://security.debian.org|${DEBIAN_MIRROR}|g" "$sources"; \
        fi; \
    done; \
    apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update; \
    apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends ffmpeg; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --create-home --uid 10001 expert
WORKDIR /app
COPY requirements.txt ./
ARG PIP_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
    --index-url "${PIP_INDEX_URL}" --timeout 60 --retries 3 --prefer-binary -r requirements.txt
COPY extract.py model.py audio.py minutes.py store.py worker.py server.py deployment.py ./
COPY web ./web
RUN mkdir -p /data && chown expert:expert /data
USER expert
ENV HOST=0.0.0.0 PORT=4303 EXPERT_DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 4303
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/healthz', timeout=3).close()"
