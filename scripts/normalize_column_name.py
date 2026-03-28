"""
Нормализация названий колонок из CSV: snake_case → человекочитаемый текст,
очистка кавычек и дубликатов, единый стиль (предложение с заглавной буквы).

Пример:
    >>> normalize_column_name('санузел_совмещенный')
    'Совмещённый санузел'
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable

# Частые случаи «е» → «ё» в прилагательных/причастиях (без внешних словарей).
_YO_FIXES: dict[str, str] = {
    "совмещенный": "совмещённый",
    "раздельный": "раздельный",
    "отдельный": "отдельный",
    "встроенный": "встроенный",
    "присоединенный": "присоединённый",
    "объединенный": "объединённый",
    "застекленный": "застеклённый",
    "утепленный": "утеплённый",
}

_QUOTE_CHARS = frozenset('\'"«»„"‟`´＂＇')
_ADJ_END_RE = re.compile(
    r"(ный|ная|ное|ные|ного|ному|ным|ными|ной|ною|ском|ская|ское|ские|ский|скую|чий|чая|чее|чие)$",
    re.IGNORECASE | re.UNICODE,
)


def _strip_outer_quotes(s: str) -> str:
    t = s.strip()
    while len(t) >= 2 and t[0] in _QUOTE_CHARS and t[-1] in _QUOTE_CHARS:
        t = t[1:-1].strip()
    # одиночные кавычки по краям
    while t and t[0] in _QUOTE_CHARS:
        t = t[1:].strip()
    while t and t[-1] in _QUOTE_CHARS:
        t = t[:-1].strip()
    return t


def _collapse_junk_underscores(s: str) -> str:
    s = re.sub(r"_+", "_", s)
    return s.strip("_").strip()


def _dedupe_consecutive_parts(parts: list[str]) -> list[str]:
    if not parts:
        return []
    out = [parts[0]]
    for p in parts[1:]:
        if p.lower() == out[-1].lower():
            continue
        out.append(p)
    return out


def _looks_like_adjective_ru(word: str) -> bool:
    w = word.lower()
    return bool(_ADJ_END_RE.search(w))


def _maybe_swap_noun_adjective(parts: list[str]) -> list[str]:
    """
    Для пары «существительное_прилагательное» в snake_case часто удобнее
    читать «прилагательное существительное» (как в примере с санузлом).
    """
    if len(parts) != 2:
        return parts
    a, b = parts[0], parts[1]
    if _looks_like_adjective_ru(b) and not _looks_like_adjective_ru(a):
        return [b, a]
    return parts


def _fix_yo(word: str) -> str:
    low = word.lower()
    fixed = _YO_FIXES.get(low)
    if fixed is not None:
        # сохраняем регистр «как есть» — ниже всё равно приведём к нижнему для склейки
        return fixed
    # эвристика: -енный/-енная/-енное → -ённ- (осторожно, только явные хвосты)
    m = re.match(r"^(.+)ен(ный|ная|ное|ные|ного|ному|ным|ными)$", low, re.UNICODE)
    if m:
        stem, tail = m.group(1), m.group(2)
        # не трогаем уже «ён» и странные основы
        if len(stem) >= 2 and stem[-1] not in "ёеъь":
            return stem + "ён" + tail
    return word


def _sentence_case_ru(phrase: str) -> str:
    """Первая буква строки — заглавная, остальные слова — строчные (как в примере)."""
    if not phrase:
        return ""
    phrase = phrase.strip()
    if not phrase:
        return ""
    parts = phrase.split()
    lowered = [p.lower() for p in parts]
    first = lowered[0]
    if first:
        first = first[0].upper() + first[1:] if len(first) > 1 else first.upper()
    lowered[0] = first
    return " ".join(lowered)


def normalize_column_name(raw: str) -> str:
    """
    Привести имя колонки к единому человекочитаемому виду.

    - Нормализация Unicode (NFKC), trim.
    - Снятие лишних кавычек по краям и «мусорных» повторов кавычек.
    - Разбор snake_case, слияние подряд идущих дубликатов сегментов.
    - Лёгкая перестановка «сущ + прил» → «прил + сущ» для двух сегментов.
    - Правка «ё» по словарю и простой эвристике.
    - Итог: одна заглавная буква в начале фразы, остальное — в нижнем регистре.
    """
    if not isinstance(raw, str):
        return ""

    s = unicodedata.normalize("NFKC", raw)
    s = _strip_outer_quotes(s)
    # убрать повторяющиеся кавычки внутри имени
    s = re.sub(r'["\'«»]{2,}', " ", s)
    s = _collapse_junk_underscores(s)
    if not s:
        return ""

    parts = [p for p in re.split(r"_+", s) if p.strip()]
    parts = [re.sub(r"\s+", " ", p.strip()) for p in parts]
    parts = _dedupe_consecutive_parts(parts)
    parts = _maybe_swap_noun_adjective(parts)

    words = [_fix_yo(p.lower()) for p in parts]
    phrase = " ".join(words)
    phrase = re.sub(r"\s+", " ", phrase).strip()
    return _sentence_case_ru(phrase)


def normalize_column_names(columns: Iterable[str]) -> list[str]:
    """
    Нормализовать список колонок; при совпадении имён после нормализации
    добавляет суффиксы « (2)», « (3)», … для уникальности.
    """
    seen: dict[str, int] = {}
    out: list[str] = []
    for col in columns:
        base = normalize_column_name(col)
        if not base:
            base = "Колонка"
        n = seen.get(base, 0)
        seen[base] = n + 1
        if n == 0:
            out.append(base)
        else:
            out.append(f"{base} ({n + 1})")
    return out


if __name__ == "__main__":
    samples = [
        'санузел_совмещенный',
        '"price_rub"',
        "тип__дома__кирпич",
        "тип_дома_дома",
        "  kitchen_area_sqm  ",
        "Год_постройки",
    ]
    for s in samples:
        print(f"{s!r} -> {normalize_column_name(s)!r}")
