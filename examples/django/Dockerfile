# Django demo target for Swapbook. Build from the repo root:
#   docker build -f examples/django/Dockerfile -t swapbook-django .
#   docker run --rm -p 8000:8000 swapbook-django
# then: swapbook --target :8000
FROM python:3.12-slim
RUN pip install --no-cache-dir "django>=4.2,<6"
WORKDIR /app
COPY adapters/django/swapbook_adapter.py /app/
COPY examples/django/app.py /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["python", "app.py"]
