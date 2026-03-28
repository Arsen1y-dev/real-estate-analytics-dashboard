"""
Автоопределение типов столбцов датафрейма pandas: числовые, категориальные, бинарные.

Бинарный столбец — ровно **два** различимых ненулевых значения (после dropna),
либо булев dtype. Столбец попадает ровно в одну из трёх групп.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


def infer_column_types(
    df: pd.DataFrame,
    *,
    datetime_as_categorical: bool = True,
) -> dict[str, list[str]]:
    """
    Разнести имена столбцов по типам.

    Правила (в указанном порядке):
    1. Пустой столбец (все NA) → categorical.
    2. ``datetime64`` / ``timedelta64`` → categorical (если ``datetime_as_categorical``), иначе можно расширить отдельно.
    3. Булев ``bool`` / nullable Boolean → binary.
    4. Ровно 2 уникальных ненулевых значения → binary.
    5. Числовые dtypes (``int``, ``float``, ``Int64``, …) → numeric.
    6. Остальное (``object``, ``string``, ``category``, …) → categorical.

    Parameters
    ----------
    df
        Исходный датафрейм.
    datetime_as_categorical
        Если True, временные столбцы относятся к categorical; если False — не классифицируются
        отдельно и попадут в ветку categorical через общий fallback.

    Returns
    -------
    dict
        ``{"numeric": [...], "categorical": [...], "binary": [...]}`` — списки имён столбцов.
    """
    numeric: list[str] = []
    categorical: list[str] = []
    binary: list[str] = []

    for col in df.columns:
        s = df[col]
        non_null = s.dropna()
        if non_null.empty:
            categorical.append(col)
            continue

        if datetime_as_categorical and (
            pd.api.types.is_datetime64_any_dtype(s) or pd.api.types.is_timedelta64_dtype(s)
        ):
            categorical.append(col)
            continue

        if pd.api.types.is_bool_dtype(s):
            binary.append(col)
            continue

        nunique = int(non_null.nunique(dropna=False))
        if nunique == 2:
            binary.append(col)
            continue

        if pd.api.types.is_numeric_dtype(s):
            numeric.append(col)
            continue

        categorical.append(col)

    return {
        "numeric": numeric,
        "categorical": categorical,
        "binary": binary,
    }


def infer_column_types_dict_records(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Удобная обёртка для списка словарей (например, после ``csv.DictReader``)."""
    return infer_column_types(pd.DataFrame(rows))


if __name__ == "__main__":
    df = pd.DataFrame(
        {
            "price": [1.2, 3.4, 5.0],
            "flag": [0, 1, 0],
            "yes_no": ["yes", "no", "yes"],
            "city": ["A", "B", "A"],
            "empty": [pd.NA, pd.NA, pd.NA],
        }
    )
    result = infer_column_types(df)
    for k, v in result.items():
        print(f"{k}: {v}")
