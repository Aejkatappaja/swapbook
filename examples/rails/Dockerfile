# Rails demo target for Swapbook. Build from the repo root:
#   docker build -f examples/rails/Dockerfile -t swapbook-rails .
#   docker run --rm -p 8001:8000 swapbook-rails
# then: swapbook --target :8001
FROM ruby:3.2-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && gem install railties actionpack actionview rackup puma --no-document \
 && apt-get purge -y build-essential && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY adapters/rails/swapbook.rb examples/rails/config.ru /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["rackup", "-o", "0.0.0.0", "-p", "8000"]
