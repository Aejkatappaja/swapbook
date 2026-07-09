# Build from the repo root: docker build -f examples/go/Dockerfile -t swapbook-go .
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /demo ./examples/go
FROM alpine:3
COPY --from=build /demo /demo
COPY examples/shared/ds.css /ds.css
EXPOSE 8000
CMD ["/demo", "--css", "/ds.css"]
