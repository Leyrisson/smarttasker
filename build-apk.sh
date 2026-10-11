#!/usr/bin/env bash
# Gera o APK de debug do SmartTasker.
# Requer: JDK 17+ e o Android SDK (ANDROID_HOME/ANDROID_SDK_ROOT) ou Android Studio.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
cd "$AQUI"

if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
  echo "AVISO: Android SDK não encontrado em ANDROID_HOME/ANDROID_SDK_ROOT."
  echo "Instale o Android Studio (que traz o SDK) ou as command-line tools e"
  echo "exporte ANDROID_HOME antes de rodar este script. Alternativa: abra a"
  echo "pasta do projeto no Android Studio e clique em Run ▶."
  exit 1
fi

# Prefere o wrapper; se não existir, usa o gradle do sistema.
if [ -x ./gradlew ]; then
  ./gradlew assembleDebug
elif command -v gradle >/dev/null 2>&1; then
  gradle assembleDebug
else
  echo "Gradle não encontrado. Gere o wrapper com 'gradle wrapper' ou abra no"
  echo "Android Studio (ele baixa o Gradle automaticamente)."
  exit 1
fi

echo
echo "APK gerado em: app/build/outputs/apk/debug/app-debug.apk"
