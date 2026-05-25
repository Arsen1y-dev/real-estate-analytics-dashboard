from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from pipeline.config import PipelineConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy processed dataset to dashboard repository")
    parser.add_argument("--config", default="pipeline/config.json", help="Path to config json")
    args = parser.parse_args()

    cfg = PipelineConfig.from_file(args.config)
    src = cfg.resolve(cfg.processed_file)
    dst = cfg.resolve(cfg.dashboard_processed_target)

    if not src.exists():
        raise FileNotFoundError(f"Processed file not found: {src}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"Copied {src} -> {dst}")


if __name__ == "__main__":
    main()
