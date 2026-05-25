from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List

import pandas as pd

from pipeline.categories import CATEGORY_CLASSIFIERS, one_hot_columns
from pipeline.config import PipelineConfig
from pipeline.runtime_status import write_runtime_status

INVALID_ADDRESS_MARKERS = {"nan", "none", "null", "undefined", "n/a", "na", "-"}
NUMERIC_ONLY_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")
COORD_PAIR_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?\s*,\s*[+-]?\d+(?:[.,]\d+)?$")
SERVICE_ADDRESS_RE = re.compile(
    r"(?:^|\b)(?:расположение|адрес)\s*[:\-]?\s*(?:не\s+указан|отсутствует|нет)\b",
    re.IGNORECASE,
)
ADDRESS_HAS_LETTER_RE = re.compile(r"[a-zа-яё]", re.IGNORECASE)


def to_float(raw) -> float | None:
    if pd.isna(raw):
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = s.replace(" ", "").replace(",", ".")
    s = re.sub(r"[^0-9.\-]", "", s)
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if pd.notna(v) else None


def to_int(raw) -> int | None:
    v = to_float(raw)
    if v is None:
        return None
    return int(round(v))


def parse_rooms(raw_title: str, raw_rooms) -> int | None:
    if pd.notna(raw_rooms):
        room = to_int(raw_rooms)
        if room is not None:
            return room
    text = str(raw_title)
    m = re.search(r"(\d+)\s*[-\s]*комнат", text, flags=re.IGNORECASE)
    if m:
        return int(m.group(1))
    if "студ" in text.lower():
        return 0
    return None


def parse_geo(raw) -> tuple[float | None, float | None]:
    if pd.isna(raw):
        return None, None
    s = str(raw).strip().replace(" ", "")
    m = re.match(r"^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$", s)
    if not m:
        return None, None
    lat = float(m.group(1))
    lng = float(m.group(2))
    return lat, lng


def sanitize_address(raw) -> str:
    if pd.isna(raw):
        return ""
    normalized = str(raw).strip().replace("\xa0", " ")
    if not normalized:
        return ""
    normalized = re.sub(r"^(?:расположение|адрес)\s*[:\-]\s*", "", normalized, flags=re.I).strip(" \"'«»")
    compact = normalized.lower().replace(" ", "")
    if compact in INVALID_ADDRESS_MARKERS:
        return ""
    if SERVICE_ADDRESS_RE.search(normalized):
        return ""
    if NUMERIC_ONLY_RE.fullmatch(normalized):
        return ""
    if COORD_PAIR_RE.fullmatch(normalized):
        return ""
    if "http://" in compact or "https://" in compact:
        return ""
    if not ADDRESS_HAS_LETTER_RE.search(normalized):
        return ""
    return normalized


def haversine_km(lat: float, lng: float, center_lat: float, center_lng: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    d_lat = radians(lat - center_lat)
    d_lng = radians(lng - center_lng)
    a = sin(d_lat / 2) ** 2 + cos(radians(center_lat)) * cos(radians(lat)) * sin(d_lng / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


def parse_floor(raw_floor, raw_total) -> tuple[float | None, int, int]:
    floor = to_int(raw_floor)
    total = to_int(raw_total)
    if floor is None or total is None or total <= 0:
        return None, 0, 0
    rel = round(floor / total, 6)
    first = 1 if floor <= 1 else 0
    last = 1 if floor >= total else 0
    return rel, first, last


def extract_listing_id(row: pd.Series) -> str:
    raw = row.get("ID объявления")
    if pd.notna(raw):
        s = str(raw).strip()
        if s and s.lower() != "nan":
            return s
    link = str(row.get("Ссылка") or "")
    m = re.search(r"/offer/(\d+)/?", link)
    return m.group(1) if m else ""


def normalize_listing_link(raw_link, fallback_id: str = "") -> str:
    if pd.isna(raw_link):
        raw = ""
    else:
        raw = str(raw_link).strip()
    if not raw or raw.lower() in {"nan", "null", "none", "undefined"}:
        raw = ""

    if raw.startswith("http://") or raw.startswith("https://"):
        return raw

    m = re.search(r"/offer/(\d+)/?", raw)
    if m:
        return f"https://realty.yandex.ru/offer/{m.group(1)}/"

    fallback = str(fallback_id or "").strip()
    if fallback.isdigit():
        return f"https://realty.yandex.ru/offer/{fallback}/"
    return ""


def bool_like(text: str) -> int:
    t = text.lower()
    if not t:
        return 0
    return 1 if t in {"да", "есть", "true", "1"} else 0


def amenities_bool(row: pd.Series, column: str, markers: tuple[str, ...]) -> int:
    if bool_like(str(row.get(column, ""))):
        return 1
    blob = str(row.get("Удобства", "") or "").lower()
    return 1 if blob and any(m in blob for m in markers) else 0


def parse_completion_for_processed(raw, current_year: int) -> int:
    """Срок сдачи в processed: год сдачи или 1 если есть срок, иначе 0 (не to_int всего текста)."""
    if pd.isna(raw):
        return 0
    text = str(raw).strip()
    if not text or text.lower() == "nan":
        return 0
    if re.search(r"сдан|сдано|дом\s+сдан", text, re.I):
        return 1
    m = re.search(r"(\d)\s*кв\.?\s*(\d{4})", text, re.I)
    if m:
        year = int(m.group(2))
        return year if year >= current_year - 1 else 1
    m_year = re.search(r"(?:год|г\.)\s*(\d{4})|(\d{4})\s*г", text, re.I)
    if m_year:
        year = int(next(g for g in m_year.groups() if g))
        return year if year >= current_year - 1 else 1
    digits = to_int(raw)
    if digits is not None and 1900 < digits < 2100:
        return digits
    return 1 if len(text) <= 60 else 0


def apply_one_hot(out: Dict[str, object], row: pd.Series, output_columns: List[str]) -> None:
    for prefix, (src_col, classify) in CATEGORY_CLASSIFIERS.items():
        category = classify(row.get(src_col))
        cols = one_hot_columns(prefix, output_columns)
        for col in cols:
            out[col] = False
        target = f"{prefix}_{category}"
        if target in cols:
            out[target] = True
        elif cols:
            fallback = f"{prefix}_другое" if f"{prefix}_другое" in cols else f"{prefix}_не указано"
            if fallback in cols:
                out[fallback] = True


def build_row(
    row: pd.Series,
    current_year: int,
    center_lat: float,
    center_lng: float,
    output_columns: List[str],
) -> Dict[str, object]:
    listing_id = extract_listing_id(row)
    listing_link = normalize_listing_link(row.get("Ссылка"), listing_id)
    price = to_float(row.get("Цена"))
    area = to_float(row.get("Общая площадь"))
    living = to_float(row.get("Жилая площадь"))
    year_built = to_int(row.get("Год постройки"))
    completion = parse_completion_for_processed(row.get("Срок сдачи"), current_year)
    rooms = parse_rooms(str(row.get("Название", "")), row.get("Количество комнат"))
    lat, lng = parse_geo(row.get("Геолокация"))

    distance = (
        haversine_km(lat, lng, center_lat, center_lng) if lat is not None and lng is not None else None
    )
    price_per_m2 = (price / area) if price is not None and area not in (None, 0) else None
    age = (current_year - year_built) if year_built is not None else 0
    floor_rel, first_floor, last_floor = parse_floor(row.get("Этаж"), row.get("Этажей в доме"))

    location = sanitize_address(row.get("Расположение")) or sanitize_address(row.get("Адрес"))

    out: Dict[str, object] = {
        "ID": listing_id,
        "Расположение": location,
        "Адрес": location,
        "Ссылка": listing_link,
        "Цена": price,
        "Количество комнат": rooms,
        "Общая площадь": area,
        "Жилая площадь": living,
        "Год постройки": year_built,
        "Срок сдачи": completion or 0,
        "Широта": lat,
        "Долгота": lng,
        "Расстояние до центра (км)": distance,
        "Цена за м²": price_per_m2,
        "Возраст дома": age if age >= 0 else 0,
        "Этаж_относительный": floor_rel,
        "Первый_этаж": first_floor,
        "Последний_этаж": last_floor,
        "Мебель_есть": amenities_bool(row, "Мебель", ("мебель",)),
        "Техника_есть": amenities_bool(
            row,
            "Техника",
            ("холодильник", "стиральн", "посудомо", "кондиционер", "техник", "плит", "духов"),
        ),
        "Пассажирский лифт_есть": bool_like(str(row.get("Пассажирский лифт", ""))),
        "Грузовой лифт_есть": bool_like(str(row.get("Грузовой лифт", ""))),
    }

    apply_one_hot(out, row, output_columns)

    yard_text = str(row.get("Двор") or "").lower()
    out["Двор_закрытый"] = 1 if "закрыт" in yard_text else 0
    out["Двор_дет_площадка"] = 1 if "дет" in yard_text else 0
    out["Двор_спорт_площадка"] = 1 if "спорт" in yard_text else 0

    return out


def load_schema(contract_path: Path, fallback_processed_path: Path) -> Dict[str, object]:
    if contract_path.exists():
        return json.loads(contract_path.read_text(encoding="utf-8"))
    cols = list(pd.read_csv(fallback_processed_path, nrows=0).columns)
    schema = {
        "required_core": ["Цена", "Количество комнат", "Общая площадь", "Широта", "Долгота"],
        "output_columns": ["ID", "Адрес", "Ссылка", *cols],
    }
    contract_path.parent.mkdir(parents=True, exist_ok=True)
    contract_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    return schema


def main() -> None:
    parser = argparse.ArgumentParser(description="ETL: yandex_realty_details.csv -> processed_apartment_data.csv")
    parser.add_argument("--config", default="pipeline/config.json", help="Path to config json")
    parser.add_argument("--year", type=int, default=2026, help="Reference year for house age")
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config)
    details_path = cfg.resolve(cfg.details_file)
    processed_path = cfg.resolve(cfg.processed_file)
    schema_path = cfg.resolve(cfg.schema_contract_file)
    runtime_status_path = cfg.resolve(cfg.runtime_status_file)

    write_runtime_status(
        runtime_status_path,
        {
            "stage": "etl",
            "status": "running",
            "step": "Подготовка итоговой таблицы",
            "statusMessage": "Подготовка итоговой таблицы: чтение исходного файла",
            "done": 5,
            "total": 100,
        },
    )

    if not details_path.exists():
        raise FileNotFoundError(f"Details file not found: {details_path}")

    fallback_processed = cfg.resolve("processed_apartment_data.csv")
    schema = load_schema(schema_path, fallback_processed)
    output_columns = list(dict.fromkeys(schema.get("output_columns", [])))
    if "Расположение" not in output_columns:
        insert_at = output_columns.index("Адрес") if "Адрес" in output_columns else 1
        output_columns.insert(insert_at, "Расположение")

    df = pd.read_csv(details_path)
    write_runtime_status(
        runtime_status_path,
        {
            "stage": "etl",
            "status": "running",
            "step": "Преобразование строк",
            "statusMessage": "Подготовка итоговой таблицы: расчет полей",
            "done": 35,
            "total": 100,
        },
    )
    center_lat, center_lng = cfg.city_center
    rows = [
        build_row(row, current_year=args.year, center_lat=center_lat, center_lng=center_lng, output_columns=output_columns)
        for _, row in df.iterrows()
    ]
    out_df = pd.DataFrame(rows)
    dedupe_key = out_df["Ссылка"].fillna("").astype(str).str.strip()
    fallback_key = out_df["ID"].fillna("").astype(str).str.strip()
    dedupe_key = dedupe_key.where(dedupe_key != "", "id:" + fallback_key)
    dedupe_key = dedupe_key.where(dedupe_key != "id:", "row:" + out_df.index.astype(str))
    out_df = out_df.assign(__dedupe_key=dedupe_key).drop_duplicates(subset=["__dedupe_key"], keep="last")
    out_df = out_df.drop(columns=["__dedupe_key"])

    for col in output_columns:
        if col not in out_df.columns:
            if col.endswith("_есть") or col.startswith("Двор_") or any(
                col.startswith(prefix)
                for prefix in ("санузел_", "окна_", "ремонт_", "тип_дома_", "парковка_", "вид_сделки_", "способ_продажи_")
            ):
                out_df[col] = False
            else:
                out_df[col] = 0

    out_df = out_df[output_columns]

    processed_path.parent.mkdir(parents=True, exist_ok=True)
    write_runtime_status(
        runtime_status_path,
        {
            "stage": "etl",
            "status": "running",
            "step": "Запись processed CSV",
            "statusMessage": "Сохранение итоговой таблицы processed_apartment_data.csv",
            "done": 85,
            "total": 100,
        },
    )
    out_df.to_csv(processed_path, index=False)
    write_runtime_status(
        runtime_status_path,
        {
            "stage": "etl",
            "status": "completed",
            "step": "Подготовка итоговой таблицы завершена",
            "statusMessage": f"Подготовка итоговой таблицы завершена, строк: {len(out_df)}",
            "done": 100,
            "total": 100,
            "collected_total": len(out_df),
        },
    )
    print(f"ETL complete: {len(out_df)} rows -> {processed_path}")


if __name__ == "__main__":
    main()
