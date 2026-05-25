from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from pipeline.config import PipelineConfig
from pipeline.runtime_status import write_runtime_status


def run_step(module_name: str, config_path: str, *, target_listings: int | None = None) -> None:
    cmd = [sys.executable, "-m", module_name, "--config", config_path]
    if target_listings and module_name in {"pipeline.run_links", "pipeline.run_details"}:
        cmd.extend(["--target-listings", str(target_listings)])
    print(">>", " ".join(cmd))
    subprocess.run(cmd, check=True, env=os.environ.copy())


def main() -> None:
    parser = argparse.ArgumentParser(description="End-to-end pipeline runner")
    parser.add_argument("--config", default="pipeline/config.json")
    parser.add_argument("--skip-links", action="store_true")
    parser.add_argument("--skip-details", action="store_true")
    parser.add_argument("--skip-etl", action="store_true")
    parser.add_argument("--skip-qa", action="store_true")
    parser.add_argument("--skip-handoff", action="store_true")
    parser.add_argument("--target-listings", type=int, default=None)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    config_abs = str((root / args.config).resolve()) if not Path(args.config).is_absolute() else args.config
    cfg = PipelineConfig.from_file(config_abs)
    runtime_status_path = cfg.resolve(cfg.runtime_status_file)

    write_runtime_status(
        runtime_status_path,
        {
            "stage": "pipeline",
            "status": "running",
            "step": "Подготовка пайплайна",
            "statusMessage": "Запуск полного pipeline",
            "done": 0,
            "total": 5,
            "target_listings": args.target_listings,
        },
    )

    try:
        if not args.skip_links:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "links",
                    "status": "running",
                    "step": "Сбор ссылок",
                    "statusMessage": "Стадия links: сбор ссылок",
                    "done": 1,
                    "total": 5,
                    "target_listings": args.target_listings,
                },
            )
            run_step("pipeline.run_links", config_abs, target_listings=args.target_listings)
        if not args.skip_details:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "details",
                    "status": "running",
                    "step": "Парсинг карточек",
                    "statusMessage": "Стадия details: парсинг карточек",
                    "done": 2,
                    "total": 5,
                    "target_listings": args.target_listings,
                },
            )
            run_step("pipeline.run_details", config_abs, target_listings=args.target_listings)
        if not args.skip_etl:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "etl",
                    "status": "running",
                    "step": "Подготовка итоговой таблицы",
                    "statusMessage": "Стадия подготовки итоговой таблицы: преобразование данных",
                    "done": 3,
                    "total": 5,
                    "target_listings": args.target_listings,
                },
            )
            run_step("pipeline.etl", config_abs)
        if not args.skip_qa:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "pipeline",
                    "status": "running",
                    "step": "QA проверка",
                    "statusMessage": "Проверка качества данных",
                    "done": 4,
                    "total": 5,
                    "target_listings": args.target_listings,
                },
            )
            run_step("pipeline.qa_report", config_abs)
        if not args.skip_handoff:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "pipeline",
                    "status": "running",
                    "step": "Сохранение результатов",
                    "statusMessage": "Финализация и handoff",
                    "done": 5,
                    "total": 5,
                    "target_listings": args.target_listings,
                },
            )
            run_step("pipeline.handoff_dashboard", config_abs)
    except subprocess.CalledProcessError as exc:
        write_runtime_status(
            runtime_status_path,
            {
                "stage": "pipeline",
                "status": "failed",
                "step": "Ошибка pipeline",
                "statusMessage": f"Pipeline завершился с ошибкой: {exc}",
            },
        )
        raise

    write_runtime_status(
        runtime_status_path,
        {
            "stage": "pipeline",
            "status": "completed",
            "step": "Pipeline завершен",
            "statusMessage": "Полный pipeline успешно завершен",
            "done": 5,
            "total": 5,
            "target_listings": args.target_listings,
        },
    )
    print("Pipeline completed.")


if __name__ == "__main__":
    main()
