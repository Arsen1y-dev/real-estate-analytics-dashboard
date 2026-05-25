from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from pipeline.config import PipelineConfig


def pct(v: float) -> str:
    return f"{v * 100:.2f}%"


def validate_schema(df: pd.DataFrame, schema: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    output_columns = schema.get("output_columns", [])
    required_core = schema.get("required_core", [])

    extra = [c for c in df.columns if c not in output_columns]
    missing = [c for c in output_columns if c not in df.columns]

    if extra:
        errors.append(f"Лишние колонки вне контракта: {len(extra)} ({extra[:3]}...)")
    if missing:
        errors.append(f"Отсутствуют колонки контракта: {len(missing)} ({missing[:5]}...)")

    junk = [c for c in df.columns if len(c) > 80]
    if junk:
        errors.append(f"Подозрительно длинные имена колонок: {len(junk)}")

    for col in required_core:
        if col not in df.columns:
            errors.append(f"Обязательная колонка отсутствует: {col}")
        elif df[col].isna().mean() > 0.15:
            warnings.append(f"Доля пропусков в `{col}` > 15%.")

    if "ID" in df.columns:
        id_filled = df["ID"].astype(str).str.strip().replace("nan", "").ne("").mean()
        if id_filled < 0.95:
            warnings.append(f"ID заполнен только в {pct(id_filled)} строк.")

    return errors, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate QA report for processed dataset")
    parser.add_argument("--config", default="pipeline/config.json", help="Path to config json")
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config)
    processed_path = cfg.resolve(cfg.processed_file)
    details_path = cfg.resolve(cfg.details_file)
    schema_path = cfg.resolve(cfg.schema_contract_file)
    report_json_path = cfg.resolve(cfg.qa_report_json)
    report_md_path = cfg.resolve(cfg.qa_report_md)

    if not processed_path.exists():
        raise FileNotFoundError(f"Processed dataset not found: {processed_path}")

    schema = json.loads(schema_path.read_text(encoding="utf-8")) if schema_path.exists() else {}
    df = pd.read_csv(processed_path)
    details = pd.read_csv(details_path) if details_path.exists() else pd.DataFrame()

    missing = df.isna().mean().sort_values(ascending=False).to_dict()
    total_rows = len(df)
    unique_links = int(df["Ссылка"].nunique()) if "Ссылка" in df.columns else None
    duplicate_links = int(total_rows - unique_links) if unique_links is not None else None

    price_col = "Цена"
    coord_ok = 0
    if "Широта" in df.columns and "Долгота" in df.columns:
        coord_ok = int(df["Широта"].notna().mul(df["Долгота"].notna()).sum())

    schema_errors, schema_warnings = validate_schema(df, schema)
    warnings: list[str] = list(schema_warnings)
    errors: list[str] = list(schema_errors)

    if total_rows < 1000:
        warnings.append("Низкий объём датасета (< 1000 строк).")
    if "Цена" in df.columns and df[price_col].isna().mean() > 0.1:
        warnings.append("Доля пропусков по цене > 10%.")
    if "Широта" in df.columns and "Долгота" in df.columns and total_rows > 0:
        if coord_ok / total_rows < 0.75:
            warnings.append("Координаты заполнены менее чем в 75% строк.")
    if duplicate_links is not None and duplicate_links > 0:
        warnings.append(f"Найдены дубликаты ссылок: {duplicate_links}.")
    if "Расстояние до центра (км)" in df.columns and total_rows > 0:
        dist = df["Расстояние до центра (км)"].dropna()
        if len(dist) and dist.max() > 200:
            warnings.append("Максимальное расстояние до центра > 200 км — проверьте city_center в config.")

    report = {
        "rows_total": total_rows,
        "columns_total": len(df.columns),
        "schema_columns_expected": len(schema.get("output_columns", [])),
        "missing_rate_by_column": missing,
        "unique_links": unique_links,
        "duplicate_links": duplicate_links,
        "coords_filled_rows": coord_ok,
        "source_details_rows": len(details),
        "schema_errors": errors,
        "warnings": warnings,
        "passed": len(errors) == 0,
    }

    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    top_missing = [(c, r) for c, r in missing.items() if r > 0][:15]
    md_lines = [
        "# Data Quality Report",
        "",
        f"- Rows: {total_rows}",
        f"- Columns: {len(df.columns)} (expected {len(schema.get('output_columns', []))})",
        f"- Source details rows: {len(details)}",
        f"- Schema validation: {'PASSED' if report['passed'] else 'FAILED'}",
    ]
    if unique_links is not None:
        md_lines.append(f"- Unique links: {unique_links}")
        md_lines.append(f"- Duplicate links: {duplicate_links}")
    if total_rows > 0:
        md_lines.append(f"- Filled coords rows: {coord_ok} ({pct(coord_ok / total_rows)})")
    md_lines.extend(["", "## Top missing columns", ""])
    if top_missing:
        for col, rate in top_missing:
            md_lines.append(f"- `{col}`: {pct(rate)}")
    else:
        md_lines.append("- No missing values in core columns.")

    md_lines.extend(["", "## Schema errors", ""])
    if errors:
        md_lines.extend([f"- {e}" for e in errors])
    else:
        md_lines.append("- None.")

    md_lines.extend(["", "## Warnings", ""])
    if warnings:
        md_lines.extend([f"- {w}" for w in warnings])
    else:
        md_lines.append("- No blocking warnings.")

    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    print(f"QA reports saved: {report_json_path} and {report_md_path}")
    if errors:
        raise SystemExit(f"QA schema validation failed with {len(errors)} error(s).")


if __name__ == "__main__":
    main()
