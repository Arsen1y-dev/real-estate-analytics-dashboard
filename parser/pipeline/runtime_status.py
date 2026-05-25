from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_runtime_status(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"updated_at": now_iso(), **payload}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def clear_runtime_control(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"resume_requested_at": None}, ensure_ascii=False, indent=2), encoding="utf-8")


def request_runtime_resume(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    current = _read_json(path)
    current["resume_requested_at"] = now_iso()
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")


def consume_runtime_resume(path: Path) -> bool:
    current = _read_json(path)
    stamp = current.get("resume_requested_at")
    if not stamp:
        return False
    current["resume_requested_at"] = None
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return True
