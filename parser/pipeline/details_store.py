"""Безопасное хранение details CSV: merge, бэкапы, JSONL-журнал, защита от «обнуления»."""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

from yandex_realty_details_parser import DETAILS_FIELD_ORDER

# Длинные поля (описание, адрес) — иначе DictReader может обрезать CSV до первых строк
try:
    csv.field_size_limit(min(sys.maxsize, 10_000_000))
except OverflowError:
    csv.field_size_limit(10_000_000)

_LINK_URL_RE = re.compile(r"https://realty\.yandex\.ru/offer/\d+/?")


def latest_csv_path(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.stem}.latest{output_path.suffix}")


def jsonl_path(output_path: Path) -> Path:
    return output_path.with_suffix(".jsonl")


def details_fieldnames(rows: List[Dict[str, str]]) -> List[str]:
    all_keys: set[str] = set()
    for row in rows:
        all_keys.update(row.keys())
    fieldnames = list(DETAILS_FIELD_ORDER)
    for key in sorted(all_keys):
        if key not in fieldnames:
            fieldnames.append(key)
    return fieldnames


def read_links(path: Path) -> List[str]:
    if not path.exists():
        return []
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def count_links_in_file(path: Path) -> int:
    """Число уникальных offer-URL в файле (CSV + проверка по тексту при подозрительно малом CSV)."""
    if not path.exists() or path.stat().st_size == 0:
        return 0
    rows = read_existing_rows(path)
    row_n = unique_link_count(rows)
    text = path.read_text(encoding="utf-8", errors="replace")
    url_n = len(set(_LINK_URL_RE.findall(text)))
    if path.stat().st_size > 6000 and row_n < 10 and url_n > row_n:
        print(
            f"⚠️  {path.name}: CSV-reader видит {row_n} строк, по URL в файле {url_n} "
            f"— берём {url_n} (возможен битый CSV)"
        )
        return url_n
    return max(row_n, url_n) if url_n else row_n


def read_existing_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def load_jsonl(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    rows: List[Dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def append_jsonl(path: Path, row: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_rows(path: Path, rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        raise RuntimeError(f"Отказ записи пустого CSV: {path}")

    expected = unique_link_count(rows)
    fieldnames = details_fieldnames(rows)
    part = path.with_suffix(path.suffix + ".part")

    try:
        with part.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
            f.flush()
            os.fsync(f.fileno())

        written = count_links_in_file(part)
        if written != expected:
            part.unlink(missing_ok=True)
            raise RuntimeError(
                f"Проверка записи не прошла для {path.name}: ожидалось {expected} ссылок, "
                f"в частичном файле {written}"
            )

        os.replace(part, path)
    except Exception:
        part.unlink(missing_ok=True)
        raise

    on_disk = count_links_in_file(path)
    if on_disk != expected:
        raise RuntimeError(
            f"Проверка записи не прошла для {path.name}: ожидалось {expected} ссылок, на диске {on_disk}"
        )


def snapshot_good_copy(output_path: Path) -> Path:
    """После успешного flush: latest + timestamped auto-backup с полным файлом."""
    latest = latest_csv_path(output_path)
    shutil.copy2(output_path, latest)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = output_path.with_name(f"{output_path.stem}.auto-backup-{stamp}{output_path.suffix}")
    shutil.copy2(output_path, backup)
    return backup


def cleanup_auto_backups_except_latest(output_path: Path) -> int:
    """
    Удалить промежуточные auto-backup, оставив только самый последний по имени-таймстампу.
    Работает только в директории output_path и только для файлов с текущим stem.
    """
    pattern = f"{output_path.stem}.auto-backup-*{output_path.suffix}"
    backups = sorted(path for path in output_path.parent.glob(pattern) if path.is_file())
    if len(backups) <= 1:
        return 0

    removed = 0
    for backup in backups[:-1]:
        backup.unlink(missing_ok=True)
        removed += 1

    return removed


def clear_session_tmp(tmp_output_path: Path) -> None:
    tmp_output_path.parent.mkdir(parents=True, exist_ok=True)
    with tmp_output_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(DETAILS_FIELD_ORDER), extrasaction="ignore")
        w.writeheader()


def unique_link_count(rows: List[Dict[str, str]]) -> int:
    return len({row.get("Ссылка", "").strip() for row in rows if row.get("Ссылка", "").strip()})


def pick_best_dataset_file(output_path: Path) -> Tuple[Path | None, int]:
    """Самый полный снимок среди main, latest и auto-backup (по числу ссылок)."""
    candidates: list[Tuple[int, Path]] = []
    for path in [output_path, latest_csv_path(output_path)]:
        if path.exists() and path.stat().st_size > 0:
            candidates.append((count_links_in_file(path), path))
    pattern = f"{output_path.stem}.auto-backup-*{output_path.suffix}"
    for path in output_path.parent.glob(pattern):
        if path.is_file():
            candidates.append((count_links_in_file(path), path))
    if not candidates:
        return None, 0
    best_n, best_path = max(candidates, key=lambda item: item[0])
    return best_path, best_n


class DetailsStore:
    """Накопитель в памяти + JSONL-журнал (не теряется при битом CSV)."""

    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        self._jsonl = jsonl_path(output_path)
        self._by_link: Dict[str, Dict[str, str]] = {}

    def count(self) -> int:
        return len(self._by_link)

    def links(self) -> set[str]:
        return set(self._by_link.keys())

    def reload_from_disk(self) -> None:
        self._by_link.clear()
        for row in load_jsonl(self._jsonl):
            self.ingest_row(row, persist=False)
        for row in read_existing_rows(self.output_path):
            self.ingest_row(row, persist=False)

    def ingest_row(self, row: Dict[str, str], *, persist: bool = True) -> bool:
        if row.get("error"):
            return False
        link = row.get("Ссылка", "").strip()
        if not link:
            return False
        is_new = link not in self._by_link
        self._by_link[link] = row
        if persist:
            append_jsonl(self._jsonl, row)
        return is_new

    def ingest_csv(self, csv_path: Path) -> int:
        added = 0
        if not csv_path.exists() or csv_path.stat().st_size == 0:
            return 0
        for row in read_existing_rows(csv_path):
            if self.ingest_row(row):
                added += 1
        return added

    def flush(self, *, clear_tmp_path: Path | None = None) -> int:
        expected = self.count()
        if expected == 0:
            return 0

        on_disk_before = count_links_in_file(self.output_path) if self.output_path.exists() else 0
        if on_disk_before > 0 and expected < on_disk_before:
            raise RuntimeError(
                f"Отказ перезаписи {self.output_path.name}: на диске {on_disk_before} ссылок, "
                f"в памяти {expected}. Данные не тронуты (см. {self._jsonl.name})."
            )

        write_rows(self.output_path, list(self._by_link.values()))
        on_disk = count_links_in_file(self.output_path)
        if on_disk != expected:
            raise RuntimeError(
                f"Flush не сохранился: в памяти {expected} ссылок, на диске {on_disk}. "
                f"Журнал: {self._jsonl}"
            )

        backup = snapshot_good_copy(self.output_path)
        print(f"📦 Снимок после flush: {backup.name} ({on_disk} ссылок)")

        if clear_tmp_path is not None and clear_tmp_path.exists():
            clear_session_tmp(clear_tmp_path)

        return on_disk


def merge_rows_by_link(*row_lists: List[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    merged_by_link: Dict[str, Dict[str, str]] = {}
    for rows in row_lists:
        for row in rows:
            link = row.get("Ссылка", "").strip()
            if link:
                merged_by_link[link] = row
    return list(merged_by_link.values())


def largest_auto_backup(output_path: Path) -> Tuple[Path | None, int]:
    return pick_best_dataset_file(output_path)


def best_known_dataset(output_path: Path) -> Tuple[List[Dict[str, str]], int, Path | None]:
    best_path, best_n = pick_best_dataset_file(output_path)
    if not best_path:
        return [], 0, None
    return read_existing_rows(best_path), best_n, best_path


def backup_main_before_flush(output_path: Path) -> Path | None:
    if count_links_in_file(output_path) < 10:
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = output_path.with_name(f"{output_path.stem}.auto-backup-{stamp}{output_path.suffix}")
    shutil.copy2(output_path, backup_path)
    return backup_path


def archive_details_before_fresh(
    output_path: Path,
    tmp_output_path: Path,
    tmp_links_path: Path,
) -> Path | None:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_root = output_path.parent / f"archive_before_fresh_{stamp}"
    moved = False

    def _move_if_exists(src: Path) -> None:
        nonlocal moved
        if src.exists() and src.stat().st_size > 0:
            archive_root.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(archive_root / src.name))
            moved = True

    _move_if_exists(output_path)
    _move_if_exists(latest_csv_path(output_path))
    _move_if_exists(jsonl_path(output_path))
    for bak in sorted(output_path.parent.glob(f"{output_path.stem}.auto-backup-*{output_path.suffix}")):
        _move_if_exists(bak)
    _move_if_exists(tmp_output_path)
    _move_if_exists(tmp_links_path)

    if moved:
        main_arch = archive_root / output_path.name
        n = count_links_in_file(main_arch) if main_arch.exists() else 0
        print(f"📁 Старый датасет архивирован: {archive_root} ({n} ссылок в main)")
        return archive_root

    clear_session_tmp(tmp_output_path)
    if tmp_links_path.exists():
        tmp_links_path.unlink()
    print("🆕 Чистый старт: предыдущего details CSV не было.")
    return None


def bootstrap_main_dataset(output_path: Path) -> int:
    """
    Поднять main из лучшего снимка (latest / backup / jsonl), не затирая более полный датасет.
    """
    main_n = count_links_in_file(output_path) if output_path.exists() else 0
    best_path, best_n = pick_best_dataset_file(output_path)
    jl = jsonl_path(output_path)
    jl_n = unique_link_count(load_jsonl(jl)) if jl.exists() else 0
    target_n = max(main_n, best_n, jl_n)

    if target_n == 0:
        return 0

    store = DetailsStore(output_path)
    store.reload_from_disk()

    if store.count() < target_n and best_path and best_path != output_path:
        for row in read_existing_rows(best_path):
            store.ingest_row(row, persist=False)
        print(
            f"♻️  Подтянуты строки из {best_path.name} в store "
            f"(было в main {main_n}, лучший файл {best_n})"
        )

    if store.count() > 0 and (main_n < store.count() or count_links_in_file(output_path) < store.count()):
        n = store.flush()
        print(f"♻️  main пересобран: {n} ссылок (jsonl + CSV + снимки)")
        return n

    return store.count()


def restore_main_if_smaller_than_backup(output_path: Path) -> int:
    return bootstrap_main_dataset(output_path)


def ensure_details_integrity(output_path: Path, min_snapshot_links: int = 1) -> int:
    return bootstrap_main_dataset(output_path)


def flush_details(output_path: Path, tmp_output_path: Path, *, clear_tmp_after: bool = False) -> int:
    bootstrap_main_dataset(output_path)
    store = DetailsStore(output_path)
    store.reload_from_disk()
    before = store.count()
    store.ingest_csv(tmp_output_path)
    if store.count() == 0:
        return before
    if store.count() < before:
        raise RuntimeError(
            f"Flush отменён: было {before} ссылок, после merge {store.count()}. Tmp: {tmp_output_path}"
        )
    return store.flush(clear_tmp_path=tmp_output_path if clear_tmp_after else None)
