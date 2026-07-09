# Build from the repo root: docker build -f examples/python/Dockerfile -t swapbook-python .
FROM python:3.12-slim
WORKDIR /app
COPY examples/python/target.py /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["python", "target.py", "8000"]
