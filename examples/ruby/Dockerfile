# Build from the repo root: docker build -f examples/ruby/Dockerfile -t swapbook-ruby .
FROM ruby:3.2-slim
RUN gem install webrick --no-document
WORKDIR /app
COPY examples/ruby/target.rb /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["ruby", "target.rb", "8000"]
