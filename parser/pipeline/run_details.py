from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from yandex_realty_details_parser import YandexRealtyDetailsParser

from pipeline.config import PipelineConfig
from pipeline.details_store import (
    DetailsStore,
    archive_details_before_fresh,
    cleanup_auto_backups_except_latest,
    clear_session_tmp,
    flush_details,
    read_links,
    bootstrap_main_dataset,
)
from pipeline.runtime_status import (
    clear_runtime_control,
    consume_runtime_resume,
    write_runtime_status,
)


def _update_target_stats(
    stats_path: Path,
    *,
    target_listings: int | None,
    collected_total: int,
    total_links: int,
) -> None:
    if target_listings is None:
        return
    payload: dict[str, object] = {}
    if stats_path.exists():
        try:
            payload = json.loads(stats_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
    payload["target_listings"] = target_listings
    payload["collected_total"] = collected_total
    payload["target_remaining"] = max(0, target_listings - collected_total)
    payload["total_links"] = total_links
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run details parser with resume support")
    parser.add_argument("--config", default="pipeline/config.json", help="Path to config json")
    parser.add_argument(
        "--preset",
        choices=("default", "fast"),
        default=None,
        help="Пресет скорости (перекрывает поле preset в JSON): fast — короче паузы, без картинок",
    )
    parser.add_argument(
        "--flush-only",
        action="store_true",
        help="Merge details.csv + .tmp_details_output.csv and exit",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Архивировать текущий details CSV и спарсить все ссылки заново",
    )
    parser.add_argument(
        "--target-listings",
        type=int,
        default=None,
        help="Лимит уникальных карточек в итоговом details CSV",
    )
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config, preset_override=args.preset)
    links_path = cfg.resolve(cfg.links_file)
    output_path = cfg.resolve(cfg.details_file)
    stats_path = cfg.resolve(cfg.details_stats_file)
    tmp_links_path = cfg.resolve("pipeline/.tmp_pending_links.txt")
    tmp_output_path = cfg.resolve("pipeline/.tmp_details_output.csv")
    runtime_status_path = cfg.resolve(cfg.runtime_status_file)
    runtime_control_path = cfg.resolve(cfg.runtime_control_file)
    clear_runtime_control(runtime_control_path)

    if args.flush_only:
        bootstrap_main_dataset(output_path)
        n = flush_details(output_path, tmp_output_path, clear_tmp_after=False)
        removed = cleanup_auto_backups_except_latest(output_path)
        print(f"🧹 Очистка backup: удалено {removed} промежуточных файлов")
        print(f"Flush complete: {n} уникальных строк в {output_path}")
        return

    all_links = read_links(links_path)
    store = DetailsStore(output_path)

    if args.fresh:
        archive_details_before_fresh(output_path, tmp_output_path, tmp_links_path)
        store = DetailsStore(output_path)
        print(f"🔁 Полный перепарс: {len(all_links)} ссылок из {links_path.name}")
    elif cfg.resume_details:
        bootstrap_main_dataset(output_path)
        store = DetailsStore(output_path)
        store.reload_from_disk()
        before = store.count()
        tmp_added = store.ingest_csv(tmp_output_path)
        if tmp_added > 0:
            try:
                flushed = store.flush(clear_tmp_path=tmp_output_path)
                print(
                    f"💾 Слияние tmp перед стартом: {flushed} в {output_path.name} "
                    f"(+{tmp_added} новых из tmp)"
                )
            except RuntimeError as exc:
                print(f"❌ {exc}")
                store.reload_from_disk()
        elif tmp_output_path.exists() and tmp_output_path.stat().st_size > 200:
            clear_session_tmp(tmp_output_path)
            print("🧹 Устаревший tmp очищен (новых ссылок не было, main не перезаписывали)")

    existing_unique = store.count()
    cfg_target = getattr(cfg, "target_listings", None)
    effective_target = args.target_listings if args.target_listings and args.target_listings > 0 else cfg_target
    if effective_target is not None and effective_target <= 0:
        effective_target = None
    use_resume = cfg.resume_details and not args.fresh
    pending_links = [link for link in all_links if link not in store.links()] if use_resume else all_links
    if effective_target is not None:
        remaining = max(0, effective_target - existing_unique)
        if remaining == 0:
            _update_target_stats(
                stats_path,
                target_listings=effective_target,
                collected_total=existing_unique,
                total_links=0,
            )
            print(f"✅ Лимит уже достигнут: {existing_unique}/{effective_target}.")
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "details",
                    "status": "completed",
                    "step": "Лимит уже достигнут до старта",
                    "statusMessage": "Лимит карточек уже достигнут, запуск не требуется",
                    "done": existing_unique,
                    "total": effective_target,
                    "target_listings": effective_target,
                },
            )
            return
        pending_links = pending_links[:remaining]

    target_note = f", лимит: {effective_target}" if effective_target is not None else ""
    print(f"📂 В датасете уже {existing_unique} ссылок, осталось обработать: {len(pending_links)}{target_note}")

    if not pending_links:
        print("Все ссылки уже обработаны, новых объявлений нет.")
        return

    tmp_links_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_links_path.write_text("\n".join(pending_links) + "\n", encoding="utf-8")

    if not cfg.resume_details:
        raise SystemExit(
            "resume_details=false: парсер пишет напрямую в main без tmp. "
            "Для безопасного resume оставьте resume_details: true в конфиге выбранного города."
        )

    p = YandexRealtyDetailsParser(
        use_proxy=cfg.use_proxy,
        proxy_url=cfg.proxy_url,
        headless=cfg.headless,
        max_links=cfg.max_links,
        delay_between_listings_min=cfg.delay_between_listings_min,
        delay_between_listings_max=cfg.delay_between_listings_max,
        delay_after_page_load_min=cfg.delay_after_page_load_min,
        delay_after_page_load_max=cfg.delay_after_page_load_max,
        resume_after_captcha=cfg.resume_after_captcha,
        max_links_per_session=cfg.max_links_per_session,
        block_images=cfg.block_images,
        request_delays_ms=cfg.request_delays_ms.get("details"),
        target_listings=effective_target,
        initial_successful_count=existing_unique,
        min_delay_ms=cfg.min_delay_ms,
        max_delay_ms=cfg.max_delay_ms,
        captcha_auto_wait_seconds=cfg.captcha_auto_wait_seconds,
    )
    p.links_file = str(tmp_links_path.resolve())
    p.output_file = str(tmp_output_path.resolve())
    p.stats_file = str(stats_path.resolve())
    p.should_resume = lambda: consume_runtime_resume(runtime_control_path)
    def on_status(payload: dict[str, Any]) -> None:
        write_runtime_status(
            runtime_status_path,
            {
                "stage": "details",
                "target_listings": effective_target,
                "statusMessage": payload.get("statusMessage") or payload.get("step") or "Парсинг карточек в процессе",
                **payload,
            },
        )
    p.on_status_update = on_status
    _update_target_stats(
        stats_path,
        target_listings=effective_target,
        collected_total=store.count(),
        total_links=len(pending_links),
    )

    session_saved = 0
    target_reached = False

    def on_row_saved(row: dict) -> None:
        nonlocal session_saved, target_reached
        if store.ingest_row(row):
            session_saved += 1
            _update_target_stats(
                stats_path,
                target_listings=effective_target,
                collected_total=store.count(),
                total_links=len(pending_links),
            )
            if effective_target is not None and store.count() >= effective_target:
                target_reached = True
                p.stop_requested = True
                print(f"🎯 Достигнут лимит: {store.count()}/{effective_target}.")

    def on_checkpoint() -> None:
        try:
            store.ingest_csv(tmp_output_path)
            n = store.flush(clear_tmp_path=tmp_output_path)
            if n != store.count():
                raise RuntimeError(f"Счётчик store {store.count()} != flush {n}")
            print(
                f"💾 Flush в {output_path.name}: {n} ссылок на диске "
                f"(успешно за сессию: {session_saved})"
            )
        except RuntimeError as exc:
            print(f"❌ {exc}")
        _update_target_stats(
            stats_path,
            target_listings=effective_target,
            collected_total=store.count(),
            total_links=len(pending_links),
        )

    p.on_row_saved = on_row_saved
    p.on_checkpoint = on_checkpoint
    write_runtime_status(
        runtime_status_path,
        {
            "stage": "details",
            "status": "running",
            "step": "Подготовка к парсингу карточек",
            "statusMessage": "Подготовка к парсингу карточек",
            "done": existing_unique,
            "total": effective_target,
            "target_listings": effective_target,
        },
    )

    links_before_run = store.count()
    run_finished_successfully = False

    try:
        p.run()
        run_finished_successfully = True
    except KeyboardInterrupt:
        print("\n✅ Остановка по Ctrl+C — сливаем tmp в main (файлы не удаляем).")
    finally:
        store.ingest_csv(tmp_output_path)
        merged_count = links_before_run
        try:
            merged_count = store.flush(
                clear_tmp_path=tmp_output_path if tmp_output_path.exists() else None,
            )
        except RuntimeError as exc:
            print(f"❌ {exc}")
            store.reload_from_disk()
            merged_count = store.count()

        added = merged_count - links_before_run
        _update_target_stats(
            stats_path,
            target_listings=effective_target,
            collected_total=merged_count,
            total_links=len(pending_links),
        )
        if session_saved > 0 and added != session_saved:
            print(
                f"⚠️  За сессию успешно спарсено {session_saved}, в main прибавилось {added}. "
                f"Проверьте файл."
            )
        print(
            f"Итог: в main {merged_count} ссылок (+{added} за сессию, спарсено успешно: {session_saved}). "
            f"Перезапуск: python -m pipeline.run_details --config <path-to-city-config>"
        )
        if target_reached and effective_target is not None:
            print(f"✅ Лимит квартир достигнут ({merged_count}/{effective_target}).")
        if run_finished_successfully:
            removed = cleanup_auto_backups_except_latest(output_path)
            print(f"🧹 Очистка backup: удалено {removed} промежуточных файлов")
            write_runtime_status(
                runtime_status_path,
                {
                    "stage": "details",
                    "status": "completed",
                    "step": "Стадия details завершена",
                    "statusMessage": f"Парсинг карточек завершен, сохранено {merged_count}",
                    "done": merged_count,
                    "total": effective_target,
                    "target_listings": effective_target,
                },
            )


if __name__ == "__main__":
    main()
