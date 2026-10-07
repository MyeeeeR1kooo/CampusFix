FROM python:3.12.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=UTC
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock \
    && groupadd --gid 10001 campusfix \
    && useradd --uid 10001 --gid campusfix --no-create-home campusfix \
    && mkdir -p /data/attachments \
    && chown campusfix:campusfix /data/attachments
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY migrations ./migrations
USER campusfix
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS test
USER root
COPY requirements-dev.lock ./
RUN pip install --no-cache-dir -r requirements-dev.lock
COPY tests ./tests
ENV PYTEST_ADDOPTS="-o cache_dir=/tmp/campusfix-pytest-cache"
USER campusfix
CMD ["pytest", "-q"]
