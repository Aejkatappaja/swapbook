#!/usr/bin/env bash
# Proves Swapbook drives real frameworks. Builds the Django and Rails demo
# containers, points the Swapbook binary at each, and asserts the protocol
# flows (manifest -> preview -> mock). Requires Docker.
set -u
cd "$(dirname "$0")/.."

BIN="$(mktemp -d)/swapbook"
echo "building swapbook binary..."
go build -o "$BIN" ./cmd/swapbook || exit 1

# lang | image | dockerfile | container port | UI port
TARGETS=(
  "django|swapbook-django|examples/django/Dockerfile|8000|7201"
  "rails|swapbook-rails|examples/rails/Dockerfile|8000|7202"
  "laravel|swapbook-laravel|examples/laravel/Dockerfile|8000|7203"
)

fail=0
for row in "${TARGETS[@]}"; do
  IFS="|" read -r lang image dockerfile cport uport <<<"$row"
  echo "── $lang ──────────────────────────────"
  docker build -q -f "$dockerfile" -t "$image" . >/dev/null || { echo "  ✗ build"; fail=1; continue; }
  docker rm -f "sb-$lang" >/dev/null 2>&1
  docker run -d --name "sb-$lang" -p "$cport" "$image" >/dev/null
  hostport=$(docker port "sb-$lang" "$cport/tcp" | head -1 | sed 's/.*://')
  "$BIN" --target ":$hostport" --port "$uport" >/dev/null 2>&1 &
  spid=$!

  ok=1
  for i in $(seq 1 60); do curl -s "http://localhost:$uport/__sb/api/manifest" | grep -q '"pr-card"' && break; sleep 0.5; done
  curl -s "http://localhost:$uport/__sb/api/manifest" | grep -q '"pr-card"' && echo "  ✓ manifest" || { echo "  ✗ manifest"; ok=0; }
  curl -s "http://localhost:$uport/__sb/frame/pr-card/open" | grep -q "Add dark mode" && echo "  ✓ preview (component rendered)" || { echo "  ✗ preview"; ok=0; }
  curl -s "http://localhost:$uport/__sb/frame/pr-card/controls?arg.status=merged&arg.reviews=4" | grep -q "4 reviews" && echo "  ✓ controls (props applied)" || { echo "  ✗ controls"; ok=0; }
  curl -s "http://localhost:$uport/__sb/mock/todo-list/default/0" | grep -q "New task" && echo "  ✓ mock render" || { echo "  ✗ mock"; ok=0; }

  kill $spid 2>/dev/null; wait $spid 2>/dev/null
  docker rm -f "sb-$lang" >/dev/null 2>&1
  [ $ok -eq 1 ] && echo "  PASS" || { echo "  FAIL"; fail=1; }
done

echo "────────────────────────────────────────"
[ $fail -eq 0 ] && echo "ALL FRAMEWORK DEMOS PASS" || echo "SOME DEMOS FAILED"
exit $fail
