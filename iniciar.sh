#!/usr/bin/env bash
# Atalho de desenvolvimento: roda os testes e sobe o servidor web local.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
cd "$AQUI"
echo "== testando o núcleo =="
node tools/smoke-test.mjs
echo
echo "== subindo a interface =="
exec ./servir.sh "${1:-8790}"
