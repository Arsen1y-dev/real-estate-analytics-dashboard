#!/usr/bin/env bash
# Сборка презентации: pdflatex × 2
set -uo pipefail
cd "$(dirname "$0")"

echo "Сборка presentation.pdf..."
pdflatex -interaction=nonstopmode main.tex >/dev/null || true
pdflatex -interaction=nonstopmode main.tex >/dev/null || true

if grep -q "Output written on main.pdf" main.log 2>/dev/null; then
  mv -f main.pdf presentation.pdf
  echo "Готово: presentation.pdf"
else
  echo "Ошибка сборки — см. main.log"
  exit 1
fi
