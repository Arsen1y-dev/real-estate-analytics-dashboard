# Материалы для защиты курсовой

**Формат:** 5 минут доклад по презентации → вопросы комиссии.

Текст работы — в [`../report/`](../report/). Скриншоты — в [`../report/images/`](../report/images/).

## Структура

| Файл | Назначение |
|------|------------|
| `slides/presentation.pdf` | Презентация для проектора (белый фон, чёрный текст) |
| `slides/main.tex` | Исходник презентации (Beamer) |
| `speech.md` | Исходник текста выступления (5 мин, 15 слайдов) |
| `speech.pdf` | Текст для печати / чтения с листа |
| `speech.docx` | Тот же текст в Word |
| `build_speech.sh` | Сборка `speech.pdf` и `speech.docx` из `speech.md` |
| `demo.md` | Запасной сценарий live-демо (по запросу после доклада) |

## Сборка PDF

```bash
cd defense/slides
./build.sh
```

Результат: `defense/slides/presentation.pdf`.

## Сборка текста выступления (PDF + Word)

```bash
cd defense
./build_speech.sh
```

Из одного файла `speech.md` получаются:

- `speech.pdf` — для печати
- `speech.docx` — для Word

## Чек-лист

- [ ] `presentation.pdf` открывается на ноутбуке, текст читается с проектора
- [ ] `speech.pdf` или `speech.docx` прогнан с таймером (~5 мин)
- [ ] Подготовлены ответы на вопросы: парсер, капча, Selenium, роли, SQLite vs PostgreSQL
