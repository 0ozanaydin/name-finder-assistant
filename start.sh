#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env oluşturuldu. İçine GEMINI_API_KEY yaz ve tekrar çalıştır."
  exit 0
fi
node server.js
