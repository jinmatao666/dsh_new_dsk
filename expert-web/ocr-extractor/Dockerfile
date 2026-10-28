ARG PYTHON_IMAGE=python:3.13-slim-bookworm
FROM ${PYTHON_IMAGE}
RUN useradd --create-home --uid 10001 expert
WORKDIR /app
COPY requirements.txt ./
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN python -m pip install --no-cache-dir --index-url "$PIP_INDEX_URL" --timeout 120 --retries 3 -r requirements.txt
COPY server.py store.py worker.py ocr.py documents.py deployment.py service_http.py ./
COPY web ./web
RUN mkdir -p /data && chown expert:expert /data
USER expert
ENV HOST=127.0.0.1 PORT=3315 EXPERT_DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 3315
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/healthz',timeout=3).close()"
CMD ["python", "server.py"]
