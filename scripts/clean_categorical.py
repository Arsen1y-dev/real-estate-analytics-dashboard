"""
Очистка категориальных признаков в pandas:

- удаление мусорных и пустых строк;
- слияние дубликатов (в т.ч. без учёта регистра и лишних пробелов);
- группировка похожих значений по порогу схожести (difflib + union-find).

Зависимость: pandas.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Any

import pandas as pd

# Строки, которые считаем мусором (после нормализации пробелов).
_JUNK_EXACT = frozenset(
    {
        "",
        "nan",
        "none",
        "null",
        "undefined",
        "n/a",
        "na",
        "н/д",
        "н\\д",
        "-",
        "—",
        "–",
        "?",
        "??",
        "???",
    }
)

_JUNK_REGEX = re.compile(
    r"^[\s\-–—_.?]*$|^\.{2,}$",
)


def _to_clean_str(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return str(v)


def normalize_whitespace(s: str) -> str:
    """NFKC, trim, схлопывание пробелов."""
    t = unicodedata.normalize("NFKC", s).strip()
    t = re.sub(r"\s+", " ", t)
    return t


def is_junk_string(s: str) -> bool:
    """Пустые и явно служебные значения."""
    if not isinstance(s, str):
        s = str(s)
    t = normalize_whitespace(s)
    if not t:
        return True
    low = t.lower()
    if low in _JUNK_EXACT:
        return True
    if _JUNK_REGEX.match(t):
        return True
    return False


def string_similarity(a: str, b: str) -> float:
    """Отношение схожести [0, 1] (SequenceMatcher)."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.p = list(range(n))

    def find(self, i: int) -> int:
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i

    def union(self, i: int, j: int) -> None:
        pi, pj = self.find(i), self.find(j)
        if pi != pj:
            self.p[pi] = pj


def _pick_canonical(
    indices: list[int],
    unique_values: list[str],
    counts: dict[str, int],
) -> str:
    """В кластере выбрать каноническое написание — с максимальной частотой в исходных данных."""
    best_val = unique_values[indices[0]]
    best_n = counts.get(best_val, 0)
    for idx in indices[1:]:
        v = unique_values[idx]
        n = counts.get(v, 0)
        if n > best_n or (n == best_n and len(v) > len(best_val)):
            best_n = n
            best_val = v
    return best_val


def cluster_similar_strings(
    unique_strings: list[str],
    counts: dict[str, int],
    *,
    similarity_threshold: float = 0.86,
    min_len_for_fuzzy: int = 2,
) -> dict[str, str]:
    """
    Для списка уникальных строк построить отображение value -> каноническое значение кластера.

    Похожесть: ``string_similarity`` >= порога. Короткие строки (< ``min_len_for_fuzzy``)
    объединяются только при полном совпадении после ``normalize_whitespace``.
    """
    n = len(unique_strings)
    if n == 0:
        return {}

    uf = _UnionFind(n)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = unique_strings[i], unique_strings[j]
            if a == b:
                uf.union(i, j)
                continue
            if len(a) < min_len_for_fuzzy or len(b) < min_len_for_fuzzy:
                continue
            if string_similarity(a, b) >= similarity_threshold:
                uf.union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        r = uf.find(i)
        clusters.setdefault(r, []).append(i)

    mapping: dict[str, str] = {}
    for _root, idxs in clusters.items():
        canon = _pick_canonical(idxs, unique_strings, counts)
        for idx in idxs:
            mapping[unique_strings[idx]] = canon
    return mapping


def clean_categorical_series(
    series: pd.Series,
    *,
    similarity_threshold: float = 0.86,
    min_len_for_fuzzy: int = 2,
    casefold_merge: bool = True,
) -> tuple[pd.Series, dict[str, str]]:
    """
    Очистить категориальный ряд.

    Шаги:
    1. Мусор и пустые значения -> ``NaN`` (nullable string).
    2. Нормализация пробелов (NFKC).
    3. Слияние дубликатов без учёта регистра (если ``casefold_merge``).
    4. Кластеризация похожих строк; в каждом кластере одно каноническое написание
       (максимальная частота в исходном ряду).

    Parameters
    ----------
    similarity_threshold
        Порог для ``difflib.SequenceMatcher`` (0–1). Выше — меньше слияний.
    min_len_for_fuzzy
        Не сравнивать по «похожести» строки короче (кроме точных совпадений после casefold).
    casefold_merge
        Сначала слить строки, совпадающие после ``str.casefold()`` и нормализации пробелов.

    Returns
    -------
    cleaned : pd.Series
        Ряд с тем же индексом, строковый dtype с NA.
    mapping : dict[str, str]
        Отображение «сырое уникальное значение после шага 3 -> канон после шага 4»
        (для отладки; ключи — промежуточные нормализованные значения).
    """
    name = series.name
    raw = series.copy()

    # 1) строки + мусор -> NA
    normalized_step1: list[str | None] = []
    for v in raw.tolist():
        cs = _to_clean_str(v)
        if cs is None:
            normalized_step1.append(None)
            continue
        t = normalize_whitespace(cs)
        if is_junk_string(t):
            normalized_step1.append(None)
        else:
            normalized_step1.append(t)

    s1 = pd.Series(normalized_step1, index=raw.index, dtype=pd.StringDtype())

    # 2) дубликаты по регистру (канон — самое частое написание среди вариантов)
    if casefold_merge:
        vc = s1.dropna().astype(str).value_counts()
        folded_to_rep: dict[str, str] = {}
        for val in vc.sort_values(ascending=False).index:
            key = val.casefold()
            if key not in folded_to_rep:
                folded_to_rep[key] = val

        def fold_map(x: Any) -> Any:
            if x is None or pd.isna(x):
                return pd.NA
            return folded_to_rep[str(x).casefold()]

        s2 = s1.map(fold_map)
    else:
        s2 = s1

    # 3) частоты уникальных для fuzzy-кластеризации
    uniques = [u for u in s2.dropna().unique().tolist() if isinstance(u, str)]
    counts = s2.dropna().astype(str).value_counts().to_dict()

    sim_map = cluster_similar_strings(
        uniques,
        counts,
        similarity_threshold=similarity_threshold,
        min_len_for_fuzzy=min_len_for_fuzzy,
    )

    def apply_sim(x: Any) -> Any:
        if x is None or pd.isna(x):
            return pd.NA
        xs = str(x)
        return sim_map.get(xs, xs)

    out = s2.map(apply_sim)
    out = out.astype(pd.StringDtype())
    out.name = name
    return out, sim_map


def clean_categorical_dataframe(
    df: pd.DataFrame,
    columns: list[str] | None = None,
    **kwargs: Any,
) -> tuple[pd.DataFrame, dict[str, dict[str, str]]]:
    """
    Применить :func:`clean_categorical_series` к выбранным столбцам.

    ``columns == None`` — ко всем столбцам типа ``object``, ``string``, ``category``.
    """
    if columns is None:
        columns = [
            c
            for c in df.columns
            if pd.api.types.is_object_dtype(df[c])
            or pd.api.types.is_string_dtype(df[c])
            or pd.api.types.is_categorical_dtype(df[c])
        ]

    out = df.copy()
    all_maps: dict[str, dict[str, str]] = {}
    for c in columns:
        if c not in df.columns:
            continue
        ser = out[c]
        if pd.api.types.is_categorical_dtype(ser):
            ser = pd.Series(ser.astype(str).replace("nan", pd.NA), index=ser.index)
        cleaned, m = clean_categorical_series(ser, **kwargs)
        out[c] = cleaned
        all_maps[c] = m
    return out, all_maps


if __name__ == "__main__":
    s = pd.Series(
        [
            " Москва ",
            "москва",
            "Москва",
            "Москваа",
            "",
            "—",
            "кирпич",
            "кирпичь",
            "кирпич",
        ]
    )
    cleaned, m = clean_categorical_series(s, similarity_threshold=0.88)
    print(cleaned.tolist())
    print(m)
