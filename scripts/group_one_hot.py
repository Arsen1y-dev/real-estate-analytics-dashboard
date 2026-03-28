"""
Группировка one-hot столбцов вида ``префикс_значение`` (последний ``_`` отделяет уровень категории).

Пример::
    тип_дома_панельный, тип_дома_кирпичный
    → группа ``тип_дома``: [панельный, кирпичный]
"""

from __future__ import annotations

from collections import defaultdict
from typing import Callable


def group_one_hot_columns(
    columns: list[str],
    *,
    min_levels: int = 2,
    sort_values: bool = True,
) -> dict[str, list[str]]:
    """
    Собрать словарь ``префикс -> [уровни]``.

    Каждое имя вида ``foo_bar_baz`` делится справа: ``prefix='foo_bar'``, ``level='baz'``.
    Столбцы без ``_`` и строки с пустым префиксом/уровнем в группы не попадают.

    Parameters
    ----------
    columns
        Имена столбцов.
    min_levels
        Минимум уровней в группе, чтобы вернуть её (типичный one-hot — ≥ 2 столбца).
    sort_values
        Сортировать уровни в каждой группе по строке.
    """
    buckets: dict[str, list[str]] = defaultdict(list)

    for name in columns:
        if "_" not in name:
            continue
        prefix, level = name.rsplit("_", 1)
        prefix = prefix.strip()
        level = level.strip()
        if not prefix or not level:
            continue
        buckets[prefix].append(level)

    out: dict[str, list[str]] = {}
    for prefix, levels in buckets.items():
        uniq = list(dict.fromkeys(levels))
        if len(uniq) < min_levels:
            continue
        out[prefix] = sorted(uniq) if sort_values else uniq
    return out


def prefix_to_label(prefix: str) -> str:
    """``тип_дома`` → «Тип дома» (пробелы + capitalize по строке)."""
    return prefix.replace("_", " ").strip().capitalize()


def format_one_hot_group(
    prefix: str,
    levels: list[str],
    *,
    label_fn: Callable[[str], str] | None = None,
) -> str:
    """
    Одна строка в стиле: ``Тип дома: [панельный, кирпичный]``.
    """
    label = (label_fn or prefix_to_label)(prefix)
    inner = ", ".join(levels)
    return f"{label}: [{inner}]"


def format_all_one_hot_groups(
    columns: list[str],
    *,
    min_levels: int = 2,
    sort_values: bool = True,
) -> list[str]:
    """Список строк ``Тип дома: […]`` по всем группам с не менее чем ``min_levels`` столбцами."""
    grouped = group_one_hot_columns(columns, min_levels=min_levels, sort_values=sort_values)
    return [format_one_hot_group(prefix, levels) for prefix, levels in sorted(grouped.items())]


if __name__ == "__main__":
    cols = [
        "тип_дома_панельный",
        "тип_дома_кирпичный",
        "цена",
        "тип_дома_монолит",
        "район_центр",
    ]
    g = group_one_hot_columns(cols, min_levels=2)
    print(g)
    for p, lv in g.items():
        print(format_one_hot_group(p, lv))
