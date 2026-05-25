from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from pipeline.config_presets import apply_preset, preset_summary


def _dedupe_urls(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for url in urls:
        normalized = url.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


@dataclass
class PipelineConfig:
    base_url: str
    base_urls: list[str] | None
    search_segments: list[str] | None
    use_proxy: bool
    proxy_url: str | None
    headless: bool
    target_listings: int | None
    max_pages: int
    max_links: int | None
    links_file: str
    details_file: str
    processed_file: str
    details_stats_file: str
    links_stats_file: str
    schema_contract_file: str
    qa_report_json: str
    qa_report_md: str
    dashboard_processed_target: str
    resume_details: bool
    resume_after_captcha: bool
    delay_between_listings_min: float
    delay_between_listings_max: float
    delay_after_page_load_min: float
    delay_after_page_load_max: float
    min_delay_ms: int
    max_delay_ms: int
    captcha_auto_wait_seconds: int
    runtime_status_file: str
    runtime_control_file: str
    max_links_per_session: int | None
    start_segment: int
    city_center_lat: float
    city_center_lng: float
    preset: str
    block_images: bool
    request_delays_ms: dict[str, dict[str, int]]

    @staticmethod
    def from_file(path: str | Path, *, preset_override: str | None = None) -> "PipelineConfig":
        cfg_path = Path(path)
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        if preset_override:
            raw = {**raw, "preset": preset_override}
        raw = apply_preset(raw)
        summary = preset_summary(str(raw.get("preset", "default")))
        if summary:
            print(f"⚡ {summary}")
        base_urls_raw = raw.get("base_urls")
        base_urls = list(base_urls_raw) if base_urls_raw else None

        search_segments: list[str] | None = None
        segments_raw = raw.get("search_segments")
        if segments_raw:
            search_segments = list(segments_raw)
        segments_file = raw.get("search_segments_file")
        if segments_file:
            segments_path = Path(segments_file)
            if not segments_path.is_absolute():
                segments_path = cfg_path.resolve().parent / segments_path
            if segments_path.exists():
                file_segments = json.loads(segments_path.read_text(encoding="utf-8"))
                search_segments = (search_segments or []) + list(file_segments)

        delays_raw = raw.get("request_delays_ms", {})
        return PipelineConfig(
            base_url=raw.get("base_url", "https://realty.yandex.ru/moskva/kupit/kvartira/"),
            base_urls=base_urls,
            search_segments=search_segments,
            use_proxy=bool(raw.get("use_proxy", False)),
            proxy_url=raw.get("proxy_url"),
            headless=bool(raw.get("headless", True)),
            target_listings=raw.get("target_listings"),
            max_pages=int(raw.get("max_pages", 20)),
            max_links=raw.get("max_links"),
            links_file=raw.get("links_file", "yandex_realty_links.txt"),
            details_file=raw.get("details_file", "yandex_realty_details.csv"),
            processed_file=raw.get("processed_file", "processed_apartment_data.csv"),
            details_stats_file=raw.get("details_stats_file", "details_parsing_stats.json"),
            links_stats_file=raw.get("links_stats_file", "parsing_stats.json"),
            schema_contract_file=raw.get("schema_contract_file", "pipeline/schema_contract.json"),
            qa_report_json=raw.get("qa_report_json", "pipeline/reports/data_quality_report.json"),
            qa_report_md=raw.get("qa_report_md", "pipeline/reports/data_quality_report.md"),
            dashboard_processed_target=raw.get(
                "dashboard_processed_target",
                "../real-estate-analytics-dashboard/processed_apartment_data.csv",
            ),
            resume_details=bool(raw.get("resume_details", True)),
            resume_after_captcha=bool(raw.get("resume_after_captcha", True)),
            delay_between_listings_min=float(raw.get("delay_between_listings_min", 5)),
            delay_between_listings_max=float(raw.get("delay_between_listings_max", 12)),
            delay_after_page_load_min=float(raw.get("delay_after_page_load_min", 4)),
            delay_after_page_load_max=float(raw.get("delay_after_page_load_max", 8)),
            min_delay_ms=int(raw.get("min_delay_ms", os.getenv("PARSER_MIN_DELAY_MS", 1200))),
            max_delay_ms=int(raw.get("max_delay_ms", os.getenv("PARSER_MAX_DELAY_MS", 2800))),
            captcha_auto_wait_seconds=int(raw.get("captcha_auto_wait_seconds", 120)),
            runtime_status_file=raw.get("runtime_status_file", "pipeline/.runtime_status.json"),
            runtime_control_file=raw.get("runtime_control_file", "pipeline/.runtime_control.json"),
            max_links_per_session=raw.get("max_links_per_session"),
            start_segment=max(1, int(raw.get("start_segment", 1))),
            city_center_lat=float(raw.get("city_center_lat", 51.533103)),
            city_center_lng=float(raw.get("city_center_lng", 46.034266)),
            preset=str(raw.get("preset", "default")),
            block_images=bool(raw.get("block_images", False)),
            request_delays_ms={
                "links": {
                    "scroll_min": int(delays_raw.get("links", {}).get("scroll_min", 700)),
                    "scroll_max": int(delays_raw.get("links", {}).get("scroll_max", 1800)),
                    "navigation_min": int(delays_raw.get("links", {}).get("navigation_min", 2500)),
                    "navigation_max": int(delays_raw.get("links", {}).get("navigation_max", 5000)),
                    "pagination_click_min": int(delays_raw.get("links", {}).get("pagination_click_min", 900)),
                    "pagination_click_max": int(delays_raw.get("links", {}).get("pagination_click_max", 2200)),
                    "between_pages_min": int(delays_raw.get("links", {}).get("between_pages_min", 4500)),
                    "between_pages_max": int(delays_raw.get("links", {}).get("between_pages_max", 9000)),
                },
                "details": {
                    "before_open_min": int(delays_raw.get("details", {}).get("before_open_min", 600)),
                    "before_open_max": int(delays_raw.get("details", {}).get("before_open_max", 1400)),
                    "after_open_min": int(delays_raw.get("details", {}).get("after_open_min", 2500)),
                    "after_open_max": int(delays_raw.get("details", {}).get("after_open_max", 5200)),
                },
            },
        )

    @property
    def city_center(self) -> tuple[float, float]:
        return self.city_center_lat, self.city_center_lng

    @property
    def search_urls(self) -> list[str]:
        urls: list[str] = []
        if self.base_urls:
            urls.extend(self.base_urls)
        else:
            urls.append(self.base_url)
        if self.search_segments:
            urls.extend(self.search_segments)
        return _dedupe_urls(urls)

    def root(self) -> Path:
        return Path(__file__).resolve().parents[1]

    def resolve(self, relative_or_abs: str) -> Path:
        p = Path(relative_or_abs)
        if p.is_absolute():
            return p
        return self.root() / p
