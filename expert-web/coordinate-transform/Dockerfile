ARG PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm
FROM ${PYTHON_IMAGE}
ARG DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g; s|http://security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
        libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 expert
WORKDIR /app
COPY requirements.txt ./
ARG PIP_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
RUN python -m pip install --no-cache-dir --disable-pip-version-check --index-url "${PIP_INDEX_URL}" --timeout 60 --retries 3 --prefer-binary -r requirements.txt
COPY processors.py store.py worker.py server.py deployment.py ./
COPY web ./web
RUN mkdir -p /data && chown expert:expert /data
USER expert
ENV HOST=127.0.0.1 PORT=3307 EXPERT_DATA_DIR=/data PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
EXPOSE 3307
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/healthz', timeout=3).close()"
