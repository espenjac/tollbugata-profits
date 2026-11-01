FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8501 \
    TP_JOURNAL=/app/storage/journal.json \
    TP_REPORTS_ROOT=/app/storage/reports

WORKDIR /app

COPY . .

RUN mkdir -p /app/storage

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8501') + '/healthz', timeout=4)"

CMD ["sh", "-c", "exec python3 app.py --host 0.0.0.0 --port ${PORT:-8501} --no-browser"]
