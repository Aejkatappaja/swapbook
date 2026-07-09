# Laravel/Blade demo target for Swapbook. Build from the repo root:
#   docker build -f examples/laravel/Dockerfile -t swapbook-laravel .
FROM php:8.3-cli
RUN apt-get update && apt-get install -y --no-install-recommends unzip git && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY examples/laravel/composer.json /app/
RUN composer update --no-interaction --no-dev
COPY adapters/php/swapbook.php /app/
COPY examples/laravel/server.php /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["php", "-S", "0.0.0.0:8000", "server.php"]
