FROM python:3.15-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Europe/London

# Debian cron is the whole scheduler: a 09:00 entry starts `python main.py` once
# and exits. tzdata lets the entrypoint mirror $TZ into /etc/localtime, which is
# what cron actually reads.
RUN apt-get update \
    && apt-get install -y --no-install-recommends cron tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY report.py main.py entrypoint.sh ./
RUN chmod 0755 /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
