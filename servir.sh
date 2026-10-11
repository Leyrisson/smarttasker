#!/usr/bin/env bash
# Serve a interface do SmartTasker em um navegador (modo desenvolvimento).
# Útil para testar o app sem Android Studio/emulador.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
PORTA="${1:-8790}"
cd "$AQUI/app/src/main/assets"
echo "SmartTasker em http://127.0.0.1:$PORTA  (Ctrl+C para sair)"
exec python3 -m http.server "$PORTA" --bind 127.0.0.1
