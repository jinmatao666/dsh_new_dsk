FROM python:3.13-slim-bookworm
RUN useradd --create-home --uid 10001 expert
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY geometry.py analysis.py interpretation.py store.py worker.py server.py deployment.py ./
COPY web ./web
RUN mkdir -p /data && chown expert:expert /data
USER expert
ENV HOST=0.0.0.0 PORT=4304 EXPERT_DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 4304
CMD ["python", "server.py"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/healthz', timeout=3).close()"
