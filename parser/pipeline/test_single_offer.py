#!/usr/bin/env python3
"""Пробный парсинг одного объявления (для отладки Москвы без полного make moscow-details)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.config import PipelineConfig
from yandex_realty_details_parser import YandexRealtyDetailsParser


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse one Yandex Realty offer URL")
    parser.add_argument(
        "--url",
        default="https://realty.yandex.ru/offer/1008324627150474372/",
        help="Offer URL (trailing slash OK)",
    )
    parser.add_argument("--config", default="pipeline/config.moscow.json")
    parser.add_argument("--preset", choices=("default", "fast"), default=None)
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Force headless (overrides config; higher captcha risk)",
    )
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config, preset_override=args.preset)
    headless = args.headless if args.headless else cfg.headless

    p = YandexRealtyDetailsParser(
        headless=headless,
        max_links=1,
        block_images=cfg.block_images,
        delay_between_listings_min=cfg.delay_between_listings_min,
        delay_between_listings_max=cfg.delay_between_listings_max,
        delay_after_page_load_min=cfg.delay_after_page_load_min,
        delay_after_page_load_max=cfg.delay_after_page_load_max,
    )
    p.driver = p.get_driver()
    try:
        row = p.extract_flat_details(args.url)
        print(json.dumps(row, ensure_ascii=False, indent=2))
        if row and row.get("error"):
            sys.exit(2)
        if p.check_for_captcha():
            print("⚠️ На странице капча — решите в окне браузера и перезапустите.", file=sys.stderr)
            sys.exit(3)
    finally:
        if p.driver:
            p.driver.quit()


if __name__ == "__main__":
    main()
