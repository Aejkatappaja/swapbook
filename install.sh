#!/bin/sh
# Install the latest Swapbook binary from GitHub Releases.
#   curl -fsSL https://raw.githubusercontent.com/Aejkatappaja/swapbook/main/install.sh | sh
# Override the install dir with DEST=~/.local/bin, or a version with VERSION=v0.1.0.
set -eu

REPO="Aejkatappaja/swapbook"
BIN="swapbook"
DEST="${DEST:-/usr/local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "swapbook: unsupported architecture: $arch" >&2; exit 1 ;;
esac
case "$os" in
  linux | darwin) ;;
  *) echo "swapbook: unsupported OS: $os (use the Windows zip from Releases)" >&2; exit 1 ;;
esac

tag="${VERSION:-}"
if [ -z "$tag" ]; then
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4)
fi
[ -n "$tag" ] || { echo "swapbook: could not find a release" >&2; exit 1; }
ver="${tag#v}"

url="https://github.com/$REPO/releases/download/$tag/${BIN}_${ver}_${os}_${arch}.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "swapbook: downloading $tag ($os/$arch)"
curl -fsSL "$url" | tar -xz -C "$tmp"

if [ -w "$DEST" ]; then
  mv "$tmp/$BIN" "$DEST/$BIN"
else
  echo "swapbook: $DEST is not writable, using sudo"
  sudo mv "$tmp/$BIN" "$DEST/$BIN"
fi

echo "swapbook: installed to $DEST/$BIN"
"$DEST/$BIN" --version
