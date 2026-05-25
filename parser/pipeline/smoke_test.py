from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

from pipeline.config import PipelineConfig


def run_module(module: str, config_path: str) -> None:
    cmd = [sys.executable, "-m", module, "--config", config_path]
    print(">>", " ".join(cmd))
    subprocess.run(cmd, check=True)


def assert_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    if path.stat().st_size == 0:
        raise ValueError(f"{label} is empty: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke test: ETL + QA + handoff without scraping")
    parser.add_argument("--config", default="pipeline/config.json")
    parser.add_argument("--skip-handoff", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    config_abs = str((root / args.config).resolve()) if not Path(args.config).is_absolute() else args.config
    cfg = PipelineConfig.from_file(config_abs)

    details_path = cfg.resolve(cfg.details_file)
    processed_path = cfg.resolve(cfg.processed_file)
    schema_path = cfg.resolve(cfg.schema_contract_file)
    report_json_path = cfg.resolve(cfg.qa_report_json)
    handoff_target = cfg.resolve(cfg.dashboard_processed_target)

    assert_file(details_path, "Details CSV")
    print(f"Details rows: {len(pd.read_csv(details_path))}")

    run_module("pipeline.etl", config_abs)
    assert_file(processed_path, "Processed CSV")

    df = pd.read_csv(processed_path)
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    expected_cols = schema.get("output_columns", [])
    if list(df.columns) != expected_cols:
        raise AssertionError(
            f"Column order mismatch. Got {len(df.columns)} cols, expected {len(expected_cols)}."
        )

    id_rate = df["ID"].astype(str).str.strip().replace("nan", "").ne("").mean()
    if id_rate < 0.99:
        raise AssertionError(f"ID fill rate too low: {id_rate:.2%}")

    junk_cols = [c for c in df.columns if len(c) > 80]
    if junk_cols:
        raise AssertionError(f"Junk columns detected: {junk_cols[:2]}")

    dist = df["Расстояние до центра (км)"].dropna()
    if len(dist) and dist.max() > 50:
        raise AssertionError(f"Distance to center looks wrong (max={dist.max():.1f} km). Check city_center.")

    run_module("pipeline.qa_report", config_abs)
    assert_file(report_json_path, "QA JSON report")

    report = json.loads(report_json_path.read_text(encoding="utf-8"))
    if not report.get("passed"):
        raise AssertionError(f"QA report failed: {report.get('schema_errors')}")

    if not args.skip_handoff:
        run_module("pipeline.handoff_dashboard", config_abs)
        assert_file(handoff_target, "Handoff target CSV")
        print(f"Handoff verified: {handoff_target}")

    print("Smoke test PASSED.")


if __name__ == "__main__":
    main()
