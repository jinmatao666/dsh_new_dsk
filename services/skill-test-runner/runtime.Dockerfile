FROM python:3.12-slim
RUN pip install --no-cache-dir python-docx==1.1.2 pypdf==5.1.0 openpyxl==3.1.5 pandas==2.2.3 Pillow==11.0.0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65532:65532
WORKDIR /workspace
CMD ["sleep", "infinity"]
