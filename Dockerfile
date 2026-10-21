FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PROPENS_DATA_DIR=/data FLASK_APP=propens

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY propens ./propens
COPY serve.py .

# run as an unprivileged user; /data is the persistent volume (database, secret key, backups)
RUN useradd --system --uid 10001 propens && mkdir /data && chown propens /data
USER propens
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').read()==b'ok' else 1)"

# SQLite + a handful of lecturers: 2 workers x 4 threads is plenty
CMD ["gunicorn", "serve:app", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", \
     "--timeout", "60", "--access-logfile", "-"]
