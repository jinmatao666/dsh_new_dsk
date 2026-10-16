FROM docker:27-cli
RUN apk add --no-cache python3
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
COPY server.py sandbox_io.py smoke.py ./
CMD ["python3", "server.py"]
