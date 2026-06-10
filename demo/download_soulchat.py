"""
下载 SoulChat parquet 语料到 build_kb_soulchat.py 默认读取的目录。

用法：
    python download_soulchat.py
    python download_soulchat.py --force

可通过 HF_ENDPOINT 环境变量切换 HuggingFace 下载端点。未设置时默认使用
https://hf-mirror.com。
"""

import argparse
import os
from pathlib import Path


REPO_ID = "Spiderman01/soulchat_split_raw"
BASE_DIR = Path(__file__).resolve().parent
TARGET_DIR = BASE_DIR / "datasets" / "SoulChat"


def parse_args():
    parser = argparse.ArgumentParser(description="下载 SoulChat 多轮对话语料")
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重新下载已存在的文件",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

    from huggingface_hub import snapshot_download

    print(f"下载源: {REPO_ID}")
    print(f"下载端点: {os.environ['HF_ENDPOINT']}")
    print(f"保存目录: {TARGET_DIR}")

    snapshot_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        allow_patterns=["data/*.parquet"],
        local_dir=str(TARGET_DIR),
        force_download=args.force,
    )

    parquet_files = sorted((TARGET_DIR / "data").glob("*.parquet"))
    if not parquet_files:
        raise RuntimeError(
            f"下载完成但未找到 {TARGET_DIR / 'data' / '*.parquet'}，请检查下载日志。"
        )

    total_mb = sum(path.stat().st_size for path in parquet_files) / 1024 / 1024
    print(f"[OK] SoulChat 下载完成：{len(parquet_files)} 个 parquet，约 {total_mb:.1f} MB")
    print("下一步运行：python build_kb_soulchat.py")


if __name__ == "__main__":
    main()
