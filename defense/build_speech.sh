#!/usr/bin/env bash
# Сборка текста выступления: speech.md → speech.pdf + speech.docx
set -uo pipefail
cd "$(dirname "$0")"

SRC="speech.md"
PDF="speech.pdf"
DOCX="speech.docx"

if [[ ! -f "$SRC" ]]; then
  echo "Не найден $SRC"
  exit 1
fi

echo "Сборка $DOCX..."
pandoc "$SRC" -o "$DOCX" \
  --from markdown \
  --standalone \
  --metadata title="Текст выступления на защите курсовой работы" \
  --metadata author="Перфилов Арсений Сергеевич"

echo "Сборка $PDF..."
pandoc "$SRC" -o "$PDF" \
  --from markdown \
  --pdf-engine=pdflatex \
  --include-in-header=speech-header.tex \
  --standalone \
  --metadata title="Текст выступления на защите курсовой работы" \
  --metadata author="Перфилов Арсений Сергеевич" \
  --variable fontsize=12pt \
  --variable documentclass=article

if [[ -f "$PDF" && -f "$DOCX" ]]; then
  echo "Готово:"
  echo "  $PDF"
  echo "  $DOCX"
else
  echo "Ошибка сборки"
  exit 1
fi
