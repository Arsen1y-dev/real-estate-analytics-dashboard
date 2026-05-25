from __future__ import annotations

import re


def _clean_text(raw: object) -> str:
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s or s.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", s.lower())


def classify_sanuzel(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "не указано"
    has_razd = "раздельн" in t
    has_sovm = "совмещ" in t or "совместн" in t
    if has_razd and has_sovm:
        return "совмещенный, раздельный"
    if has_razd:
        return "раздельный"
    if has_sovm:
        return "совмещенный"
    if len(t) <= 40:
        return "другое"
    return "не указано"


def classify_okna(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "не указано"
    has_dvor = "во двор" in t or "на двор" in t
    has_ul = "на улицу" in t or "улиц" in t
    if has_dvor and has_ul:
        return "другое"
    if has_dvor:
        return "во двор"
    if has_ul:
        return "на улицу"
    if len(t) <= 40:
        return "другое"
    return "не указано"


def classify_repair(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "другое"
    if "дизайн" in t:
        return "дизайнерский"
    if "евро" in t:
        return "евро"
    if "космет" in t:
        return "косметический"
    if "требует" in t:
        return "требует ремонта"
    if len(t) <= 40:
        return "другое"
    return "другое"


def classify_house_type(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "другое"
    mapping = [
        ("монолитно-кирпич", "монолитно-кирпичный"),
        ("монолит", "монолитный"),
        ("кирпич", "кирпичный"),
        ("панел", "панельный"),
        ("блоч", "блочный"),
    ]
    for needle, label in mapping:
        if needle in t:
            return label
    if len(t) <= 40:
        return "другое"
    return "другое"


def classify_parking(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "другое"
    if "нет" in t and "парк" in t:
        return "нет_парковки"
    if "подзем" in t:
        return "подземная"
    if "шлагбаум" in t:
        return "за шлагбаумом во дворе"
    if "открыт" in t:
        return "открытая во дворе"
    if len(t) <= 50:
        return "другое"
    return "другое"


def classify_deal_type(raw: object) -> str:
    """Категории только из колонок schema_contract (вид_сделки_*)."""
    t = _clean_text(raw)
    if not t:
        return "другое"
    if "ипотек" in t:
        return "возможна ипотека"
    if "прям" in t:
        return "прямая продажа"
    if "апартамент" in t and "москв" in t:
        return "продажа апартаментов в москве"
    if "первичн" in t or "от застройщика" in t or "цена от застройщика" in t:
        return "прямая продажа"
    if len(t) <= 80:
        return "другое"
    return "другое"


def classify_sale_method(raw: object) -> str:
    t = _clean_text(raw)
    if not t:
        return "не указано"
    if "свобод" in t:
        return "свободная"
    if len(t) <= 40:
        return "другое"
    return "не указано"


CATEGORY_CLASSIFIERS: dict[str, tuple[str, object]] = {
    "санузел": ("Санузел", classify_sanuzel),
    "окна": ("Окна", classify_okna),
    "ремонт": ("Ремонт", classify_repair),
    "тип_дома": ("Тип дома", classify_house_type),
    "парковка": ("Парковка", classify_parking),
    "вид_сделки": ("Вид сделки", classify_deal_type),
    "способ_продажи": ("Способ продажи", classify_sale_method),
}


def one_hot_columns(prefix: str, output_columns: list[str]) -> list[str]:
    return [col for col in output_columns if col.startswith(f"{prefix}_")]
