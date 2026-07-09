# Build from the repo root: docker build -f examples/node/Dockerfile -t swapbook-node .
FROM node:22-slim
WORKDIR /app
COPY examples/node/target.js /app/
COPY examples/shared/ds.css /app/ds.css
EXPOSE 8000
CMD ["node", "target.js", "8000"]
