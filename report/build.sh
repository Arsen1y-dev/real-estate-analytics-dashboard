#!/usr/bin/env bash
# Полная пересборка отчёта: pdflatex → bibtex → pdflatex × 2.
# Использование: ./build.sh [--clean]
set -uo pipefail
cd "$(dirname "$0")"

APPENDIX_SOURCES=(
  ../parser/pipeline/run_links.py
  ../parser/pipeline/details_store.py
  ../parser/pipeline/etl.py
  ../parser/pipeline/run_pipeline.py
  ../parser/pipeline/qa_report.py
  ../server/datasetStore.ts
  ../server/parserRunner.ts
  ../shared/filters.ts
  ../src/App.tsx
  ../src/components/FilterPanel.tsx
  ../src/components/ObjectsMap.tsx
)

if [[ "${1:-}" == "--clean" ]]; then
  rm -f main.toc main.aux main.out main.lof main.lot main.bbl main.blg
fi

mkdir -p .appendix-cache
for src in "${APPENDIX_SOURCES[@]}"; do
  python3 filter_appendix.py "$src"
done

echo "Сборка main.tex (pdflatex → bibtex → pdflatex × 2)..."
echo "  pass 1/4: pdflatex"
pdflatex -shell-escape -interaction=nonstopmode main.tex >/dev/null || true

echo "  pass 2/4: bibtex"
bibtex main >/dev/null || true

for i in 3 4; do
  echo "  pass $i/4: pdflatex"
  pdflatex -shell-escape -interaction=nonstopmode main.tex >/dev/null || true
done

if grep -q "Unable to read an entire line---bufsize" main.log 2>/dev/null; then
  echo "Ошибка: .aux раздут (lineno + verbatim). Запустите ./build.sh --clean"
  exit 1
fi

if grep -q "Output written on main.pdf" main.log 2>/dev/null; then
  pages=$(grep "Output written on main.pdf" main.log | tail -1 | sed -E 's/.*\(([0-9]+) pages.*/\1/')
  echo "Готово: main.pdf (${pages} стр.)"
else
  echo "Ошибка сборки — см. main.log"
  exit 1
fi

if grep -q "No file main.toc" main.log && ! grep -q "contentsline.*appendix" main.toc 2>/dev/null; then
  echo "Предупреждение: содержание могло не обновиться — запустите ./build.sh ещё раз"
fi

if grep -q "FancyVerb Error" main.log; then
  echo "Предупреждение: ошибки в приложениях — см. main.log (FancyVerb)"
  exit 1
fi

toc_appendix=$(grep -c "contentsline.*appendix" main.toc 2>/dev/null || echo 0)
echo "Пунктов приложений в main.toc: ${toc_appendix}"
