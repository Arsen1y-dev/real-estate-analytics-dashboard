"""Пресеты скорости парсинга (мержатся с config JSON; явные поля в JSON перекрывают пресет)."""
from __future__ import annotations

from typing import Any

PRESETS: dict[str, dict[str, Any]] = {
    "default": {},
    "fast": {
        "delay_between_listings_min": 1.5,
        "delay_between_listings_max": 3.0,
        "delay_after_page_load_min": 1.0,
        "delay_after_page_load_max": 2.0,
        "block_images": True,
    },
}


def apply_preset(raw: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("preset") or "default").strip().lower()
    if name not in PRESETS:
        known = ", ".join(sorted(PRESETS))
        raise ValueError(f"Неизвестный preset={name!r}. Доступны: {known}")

    merged: dict[str, Any] = dict(PRESETS[name])
    for key, value in raw.items():
        if key == "preset":
            continue
        merged[key] = value
    merged["preset"] = name
    return merged


def preset_summary(name: str) -> str:
    if name == "fast":
        p = PRESETS["fast"]
        return (
            f"preset=fast: паузы {p['delay_between_listings_min']}-{p['delay_between_listings_max']}с "
            f"между карточками, {p['delay_after_page_load_min']}-{p['delay_after_page_load_max']}с "
            f"после загрузки, block_images=true. Выше риск капчи — headless=false."
        )
    return ""
