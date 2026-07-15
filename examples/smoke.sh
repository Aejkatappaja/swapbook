#!/usr/bin/env bash
# Proves the Swapbook binary is framework/language-agnostic: it drives example
# targets written in Python, Node and Ruby with zero per-language code in the
# binary. Boots each target, points Swapbook at it, and asserts the protocol
# flows end to end (manifest -> frame -> mock).
set -u
cd "$(dirname "$0")/.."

BIN="$(mktemp -d)/swapbook"
echo "building swapbook binary..."
go build -o "$BIN" ./cmd/swapbook || exit 1

# Each target now renders a subset of the shared demo design system, so the
# protocol assertions are language-independent; the per-language `docs` string
# in the manifest is the marker that proves this specific language is serving.
# lang | run command | target port | UI port | language marker
TARGETS=(
  "python|python3 examples/python/target.py|9090|7101|raw Python server"
  "node|node examples/node/target.js|9091|7102|raw Node server"
  "ruby|ruby examples/ruby/target.rb|9092|7103|raw Ruby server"
  "flask|PYTHONPATH=adapters/flask python3 examples/flask/app.py|9093|7104|raw Flask server"
  "express|NODE_PATH=examples/express/node_modules node examples/express/target.js|9094|7105|raw Express server"
)

fail=0
for row in "${TARGETS[@]}"; do
  IFS="|" read -r lang cmd tport uport langmark <<<"$row"
  echo "── $lang ──────────────────────────────"

  $cmd "$tport" >/dev/null 2>&1 &
  tpid=$!
  "$BIN" --target ":$tport" --port "$uport" >/dev/null 2>&1 &
  spid=$!

  ok=1
  # wait for the target to be reachable THROUGH swapbook (manifest proxied)
  for i in $(seq 1 40); do
    curl -s "http://localhost:$uport/__sb/api/manifest" | grep -q '"button"' && break
    sleep 0.3
  done

  manifest=$(curl -s "http://localhost:$uport/__sb/api/manifest")
  frame=$(curl -s "http://localhost:$uport/__sb/frame/todo-list/default")
  mock=$(curl -s "http://localhost:$uport/__sb/mock/todo-list/default/0")

  echo "$manifest" | grep -q '"button"' && echo "  ✓ manifest" || { echo "  ✗ manifest"; ok=0; }
  echo "$manifest" | grep -qF "$langmark" && echo "  ✓ language target ($langmark)" || { echo "  ✗ language target"; ok=0; }
  echo "$frame" | grep -q '+ add row' && echo "  ✓ preview (DS component)" || { echo "  ✗ preview"; ok=0; }
  echo "$frame" | grep -q 'window.__SB={"mode":"mock"' && echo "  ✓ mock config injected" || { echo "  ✗ mock config"; ok=0; }
  echo "$frame" | grep -q '"GET /ds/row":"/__sb/mock/todo-list/default/0"' && echo "  ✓ mock route mapped" || { echo "  ✗ mock route"; ok=0; }
  echo "$mock" | grep -q 'New task' && echo "  ✓ mock render" || { echo "  ✗ mock render"; ok=0; }
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:$uport/__sb/htmx.min.js" | grep -q 200 && echo "  ✓ embedded htmx served" || { echo "  ✗ embedded htmx"; ok=0; }
  # headless CI gate: every story/variant must render (exit 0)
  "$BIN" check --target ":$tport" >/dev/null 2>&1 && echo "  ✓ swapbook check" || { echo "  ✗ swapbook check"; ok=0; }

  kill $spid $tpid 2>/dev/null
  wait $spid $tpid 2>/dev/null
  [ $ok -eq 1 ] && echo "  PASS" || { echo "  FAIL"; fail=1; }
done

echo "────────────────────────────────────────"
[ $fail -eq 0 ] && echo "ALL TARGETS PASS" || echo "SOME TARGETS FAILED"
exit $fail
