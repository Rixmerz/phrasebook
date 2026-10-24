#!/usr/bin/env bash
# Fetches the pinned github-mcp-server binary the benchmark drives (Linux x86_64).
# The tarball checksum is pinned so a rerun uses the exact server we measured.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=v2.0.3
SHA256=f797c20fe02a755865d0e2d46184ab47e31bf1619b0855b8d89c531e45a651c2
mkdir -p vendor/github-mcp
cd vendor/github-mcp
if [ ! -x github-mcp-server ]; then
  curl -fsSLo github-mcp-server_Linux_x86_64.tar.gz \
    "https://github.com/github/github-mcp-server/releases/download/${VERSION}/github-mcp-server_Linux_x86_64.tar.gz"
  echo "${SHA256}  github-mcp-server_Linux_x86_64.tar.gz" | sha256sum -c -
  tar xzf github-mcp-server_Linux_x86_64.tar.gz github-mcp-server
fi
./github-mcp-server --version
