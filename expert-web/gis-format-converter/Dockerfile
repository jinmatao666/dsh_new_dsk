ARG PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm
FROM ${PYTHON_IMAGE}
ARG DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g; s|http://security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
        gdal-bin libgdal-dev g++ libspatialindex-dev libgeos-dev proj-bin proj-data libproj-dev libsqlite3-dev zlib1g-dev \
        xvfb xauth libxcb-util1 libxcb-cursor0 libopengl0 libgl1 libglx0 libegl1 \
            libglib2.0-0 libxkbcommon0 libdbus-1-3 libnspr4 libnss3 \
            libx11-xcb1 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
            libxcb-render-util0 libxcb-shape0 libxcb-xfixes0 libxcb-xinerama0 \
            libxcb-xkb1 libxkbcommon-x11-0 libfontconfig1 libfreetype6 \
    && ln -sf /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 expert
WORKDIR /app
# Place ODAFileConverter_QT6_lnxX64_11dll_27.9.deb next to this Dockerfile before build.
COPY ODAFileConverter_QT6_lnxX64_11dll_27.9.deb /tmp/oda.deb
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y /tmp/oda.deb \
    && rm -f /tmp/oda.deb \
    && printf '%s\n' '#!/bin/bash' 'exec xvfb-run -a /usr/bin/ODAFileConverter "$@"' > /usr/local/bin/ODAFileConverter \
    && chmod +x /usr/local/bin/ODAFileConverter \
    && rm -rf /var/lib/apt/lists/*
ENV ODA_FILE_CONVERTER=/usr/local/bin/ODAFileConverter
COPY requirements.txt ./
ARG PIP_INDEX_URL=https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple
RUN python -m pip install --no-cache-dir --disable-pip-version-check --index-url "${PIP_INDEX_URL}" --timeout 60 --retries 3 --prefer-binary -r requirements.txt
COPY processors.py store.py worker.py server.py deployment.py ./
COPY web ./web
RUN mkdir -p /data && chown expert:expert /data
USER expert
ENV HOST=127.0.0.1 PORT=3308 EXPERT_DATA_DIR=/data PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
EXPOSE 3308
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/healthz', timeout=3).close()"
