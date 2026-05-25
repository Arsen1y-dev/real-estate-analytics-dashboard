from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yandex_realty_advanced_parser as links_parser

from pipeline.config import PipelineConfig
from pipeline.runtime_status import (
    clear_runtime_control,
    consume_runtime_resume,
    write_runtime_status,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run links collection with config")
    parser.add_argument("--config", default="pipeline/config.json", help="Path to config json")
    parser.add_argument(
        "--start-segment",
        type=int,
        default=None,
        metavar="N",
        help="1-based segment index to start from (overrides config start_segment)",
    )
    parser.add_argument(
        "--target-listings",
        type=int,
        default=None,
        metavar="N",
        help="Остановить сбор после достижения N ссылок (с учетом уже собранных)",
    )
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config)
    target_listings = args.target_listings if args.target_listings and args.target_listings > 0 else cfg.target_listings
    start_segment = cfg.start_segment
    if args.start_segment is not None:
        start_segment = max(1, args.start_segment)
    links_path = cfg.resolve(cfg.links_file)
    stats_path = cfg.resolve(cfg.links_stats_file)
    runtime_status_path = cfg.resolve(cfg.runtime_status_file)
    runtime_control_path = cfg.resolve(cfg.runtime_control_file)
    clear_runtime_control(runtime_control_path)

    p = links_parser.YandexRealtyParser(
        use_proxy=cfg.use_proxy,
        proxy_url=cfg.proxy_url,
        headless=cfg.headless,
        max_pages=cfg.max_pages,
        target_listings=target_listings,
        min_delay_ms=cfg.min_delay_ms,
        max_delay_ms=cfg.max_delay_ms,
        captcha_auto_wait_seconds=cfg.captcha_auto_wait_seconds,
        request_delays_ms=cfg.request_delays_ms.get("links"),
    )
    p.links_file = str(links_path)
    p.stats_file = str(stats_path)
    p.should_resume = lambda: consume_runtime_resume(runtime_control_path)

    def on_status(payload: dict[str, Any]) -> None:
        write_runtime_status(
            runtime_status_path,
            {
                "stage": "links",
                "target_listings": target_listings,
                "statusMessage": payload.get("statusMessage") or payload.get("step") or "Сбор ссылок в процессе",
                **payload,
            },
        )

    p.on_status_update = on_status

    links_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_status_path.parent.mkdir(parents=True, exist_ok=True)

    urls = cfg.search_urls
    existing = 0
    if links_path.exists():
        existing = sum(1 for line in links_path.read_text(encoding="utf-8").splitlines() if line.strip())
    start_note = f", старт с сегмента {start_segment}" if start_segment > 1 else ""
    print(
        f"Сбор ссылок: {len(urls)} сегмент(ов), до {cfg.max_pages} стр. каждый{start_note}; "
        f"в файле уже {existing} ссылок (resume, дедупликация)"
    )
    if target_listings:
        print(f"🎯 Целевой лимит ссылок: {target_listings}")
        if existing >= target_listings:
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "links",
                    "status": "completed",
                    "step": "Лимит уже достигнут до старта",
                    "statusMessage": "Лимит ссылок уже достигнут, запуск пропущен",
                    "done": existing,
                    "total": target_listings,
                    "target_listings": target_listings,
                },
            )
            print("✅ Лимит уже достигнут, запуск не требуется.")
            return

    for idx, url in enumerate(urls, start=1):
        if target_listings and links_path.exists():
            current = sum(1 for line in links_path.read_text(encoding="utf-8").splitlines() if line.strip())
            if current >= target_listings:
                print(f"✅ Достигнут лимит ссылок {target_listings}, завершаем links.")
                break
        if idx < start_segment:
            print(f"\n=== Сегмент {idx}/{len(urls)}: пропуск (до start_segment={start_segment}) ===")
            continue
        print(f"\n=== Сегмент {idx}/{len(urls)}: {url} ===")
        links_parser.BASE_URL = url
        write_runtime_status(
            runtime_status_path,
            {
                "stage": "links",
                "status": "running",
                "step": f"Сегмент {idx}/{len(urls)}",
                "statusMessage": f"Сбор ссылок: сегмент {idx}/{len(urls)}",
                "done": idx - 1,
                "total": len(urls),
                "target_listings": target_listings,
            },
        )
        p.run()

    final_count = sum(1 for line in links_path.read_text(encoding="utf-8").splitlines() if line.strip()) if links_path.exists() else 0
    write_runtime_status(
        runtime_status_path,
        {
            "stage": "links",
            "status": "completed",
            "step": "Стадия links завершена",
            "statusMessage": f"Сбор ссылок завершен, найдено {final_count}",
            "done": final_count,
            "total": target_listings,
            "target_listings": target_listings,
        },
    )


if __name__ == "__main__":
    main()
