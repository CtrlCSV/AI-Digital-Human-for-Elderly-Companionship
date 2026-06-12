"""
Download SoulChat parquet data used by build_kb_soulchat.py.

Usage:
    python download_soulchat.py
    python download_soulchat.py --force
    python download_soulchat.py --endpoint https://hf-mirror.com
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

REPO_ID = "Spiderman01/soulchat_split_raw"
BASE_DIR = Path(__file__).resolve().parent
TARGET_DIR = BASE_DIR / "datasets" / "SoulChat"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download SoulChat parquet data")
    parser.add_argument("--force", action="store_true", help="Force redownload existing files")
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("HF_ENDPOINT", "https://hf-mirror.com"),
        help="Hugging Face endpoint, defaults to hf-mirror.com",
    )
    return parser.parse_args()


def clear_dead_proxy_env() -> None:
    # Some shells keep a dead proxy such as 127.0.0.1:9, which breaks downloads.
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        value = os.environ.get(key, "")
        if "127.0.0.1:9" in value or "localhost:9" in value:
            os.environ.pop(key, None)


def main() -> None:
    args = parse_args()
    clear_dead_proxy_env()
    os.environ["HF_ENDPOINT"] = args.endpoint

    from huggingface_hub import snapshot_download

    print(f"Download source: {REPO_ID}")
    print(f"Endpoint: {os.environ['HF_ENDPOINT']}")
    print(f"Target: {TARGET_DIR}")

    snapshot_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        allow_patterns=["data/*.parquet"],
        local_dir=str(TARGET_DIR),
        local_dir_use_symlinks=False,
        force_download=args.force,
    )

    parquet_files = sorted((TARGET_DIR / "data").glob("*.parquet"))
    if not parquet_files:
        raise RuntimeError(f"Download completed but no parquet files found under {TARGET_DIR / 'data'}")

    total_mb = sum(path.stat().st_size for path in parquet_files) / 1024 / 1024
    print(f"[OK] SoulChat downloaded: {len(parquet_files)} parquet files, about {total_mb:.1f} MB")
    for path in parquet_files:
        print(f"  - {path.name}")


if __name__ == "__main__":
    main()