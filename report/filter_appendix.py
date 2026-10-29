#!/usr/bin/env python3
"""Prepare source file for \\VerbatimInput in appendices (strip emoji etc.)."""
from __future__ import annotations

import pathlib
import re
import sys

EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE0F"
    "]+",
    flags=re.UNICODE,
)
REPLACEMENTS = {
    "\u20bd": "руб.",  # ₽
    "\u2212": "-",     # −
}


def sanitize(text: str) -> str:
    text = EMOJI_RE.sub("", text)
    for src, dst in REPLACEMENTS.items():
        text = text.replace(src, dst)
    return text


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: filter_appendix.py <source-path>")

    src = pathlib.Path(sys.argv[1]).resolve()
    out_dir = pathlib.Path(__file__).resolve().parent / ".appendix-cache"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / src.name

    out.write_text(sanitize(src.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    main()
