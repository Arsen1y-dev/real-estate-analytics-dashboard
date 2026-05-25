"""Тесты merge/flush details CSV (без Selenium)."""
import csv
import tempfile
import unittest
from pathlib import Path

from pipeline.details_store import (
    DetailsStore,
    backup_main_before_flush,
    cleanup_auto_backups_except_latest,
    clear_session_tmp,
    details_fieldnames,
    ensure_details_integrity,
    flush_details,
    read_existing_rows,
    unique_link_count,
    write_rows,
)


class TestWriteRows(unittest.TestCase):
    def test_mismatched_keys_merge(self):
        rows_a = [{"Ссылка": "https://example/a", "Название": "A", "Цена": "1"}]
        rows_b = [
            {
                "Ссылка": "https://example/b",
                "Название": "B",
                "Отопление": "центральное",
                "Серия дома": "П-44Т",
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "details.csv"
            partial = root / "tmp.csv"
            write_rows(main, rows_a)
            write_rows(partial, rows_b)
            count = flush_details(main, partial)
            self.assertEqual(count, 2)
            merged = read_existing_rows(main)
            self.assertEqual(len(merged), 2)

    def test_flush_keeps_best_snapshot_when_main_corrupt(self):
        base_rows = [
            {"Ссылка": f"https://example/base/{i}", "Название": str(i)} for i in range(60)
        ]
        tmp_rows = [
            {"Ссылка": "https://example/tmp/a", "Название": "a"},
            {"Ссылка": "https://example/tmp/b", "Название": "b"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "details.csv"
            partial = root / "tmp.csv"
            write_rows(main, base_rows)
            backup_main_before_flush(main)
            write_rows(main, base_rows[:3])
            ensure_details_integrity(main)
            write_rows(partial, tmp_rows)
            count = flush_details(main, partial)
            self.assertEqual(count, 62)
            links = {r["Ссылка"] for r in read_existing_rows(main)}
            self.assertIn("https://example/base/0", links)
            self.assertIn("https://example/tmp/a", links)
            self.assertTrue(partial.exists())

    def test_ensure_restore_corrupt_main_from_auto_backup(self):
        good = [{"Ссылка": f"https://example/{i}", "Название": str(i)} for i in range(100)]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "details.csv"
            write_rows(main, good)
            backup_main_before_flush(main)
            write_rows(main, good[:2])
            n = ensure_details_integrity(main)
            self.assertEqual(n, 100)
            self.assertEqual(unique_link_count(read_existing_rows(main)), 100)

    def test_clear_session_tmp_keeps_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            partial = Path(tmp) / ".tmp_details_output.csv"
            write_rows(
                partial,
                [{"Ссылка": "https://example/x", "Название": "x"}],
            )
            clear_session_tmp(partial)
            self.assertTrue(partial.exists())
            self.assertEqual(unique_link_count(read_existing_rows(partial)), 0)

    def test_flush_clear_tmp_after(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "details.csv"
            partial = root / "tmp.csv"
            write_rows(main, [{"Ссылка": "https://example/a", "Название": "A"}])
            write_rows(partial, [{"Ссылка": "https://example/b", "Название": "B"}])
            n = flush_details(main, partial, clear_tmp_after=True)
            self.assertEqual(n, 2)
            self.assertEqual(unique_link_count(read_existing_rows(partial)), 0)
            self.assertEqual(unique_link_count(read_existing_rows(main)), 2)

    def test_ingest_row_every_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / "details.csv"
            store = DetailsStore(main)
            for i in range(31):
                store.ingest_row({"Ссылка": f"https://example/o{i}/", "Название": str(i)})
            store.flush()
            self.assertEqual(store.count(), 31)
            self.assertEqual(unique_link_count(read_existing_rows(main)), 31)

    def test_details_store_accumulates_checkpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "details.csv"
            partial = root / "tmp.csv"
            store = DetailsStore(main)
            write_rows(
                partial,
                [{"Ссылка": f"https://example/b1/{i}", "Название": str(i)} for i in range(10)],
            )
            store.ingest_csv(partial)
            store.flush(clear_tmp_path=partial)
            write_rows(
                partial,
                [{"Ссылка": f"https://example/b2/{i}", "Название": str(i)} for i in range(10)],
            )
            store.ingest_csv(partial)
            store.flush(clear_tmp_path=partial)
            self.assertEqual(store.count(), 20)
            self.assertEqual(unique_link_count(read_existing_rows(main)), 20)

    def test_cleanup_auto_backups_keeps_only_latest(self):
        rows = [{"Ссылка": f"https://example/{i}", "Название": str(i)} for i in range(15)]
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / "details.csv"
            write_rows(main, rows)
            for stamp in ("20260101-100000", "20260101-100010", "20260101-100020"):
                backup = main.with_name(f"{main.stem}.auto-backup-{stamp}{main.suffix}")
                backup.write_text(f"backup-{stamp}", encoding="utf-8")
            removed = cleanup_auto_backups_except_latest(main)
            backups = sorted(main.parent.glob(f"{main.stem}.auto-backup-*{main.suffix}"))
            self.assertEqual(removed, 2)
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].name, f"{main.stem}.auto-backup-20260101-100020{main.suffix}")
            self.assertTrue(main.exists())

    def test_cleanup_auto_backups_noop_for_single_file(self):
        rows = [{"Ссылка": f"https://example/{i}", "Название": str(i)} for i in range(15)]
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / "details.csv"
            write_rows(main, rows)
            backup = main.with_name(f"{main.stem}.auto-backup-20260101-100000{main.suffix}")
            backup.write_text("one-backup", encoding="utf-8")
            removed = cleanup_auto_backups_except_latest(main)
            backups = sorted(main.parent.glob(f"{main.stem}.auto-backup-*{main.suffix}"))
            self.assertEqual(removed, 0)
            self.assertEqual(len(backups), 1)

    def test_details_fieldnames_order(self):
        rows = [
            {"Ссылка": "x", "Отопление": "газ", "ZZ_extra": "1"},
            {"Ссылка": "y", "Название": "n"},
        ]
        names = details_fieldnames(rows)
        self.assertLess(names.index("Название"), names.index("Отопление"))
        self.assertEqual(names[-1], "ZZ_extra")


if __name__ == "__main__":
    unittest.main()
