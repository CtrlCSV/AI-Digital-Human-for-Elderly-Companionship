"""
Download the local models required before running server.py.

Models:
  1. FunAudioLLM/SenseVoiceSmall -> ./models/SenseVoiceSmall/   (ASR, dialect-friendly)
  2. BAAI/bge-small-zh-v1.5     -> ./models/bge-small-zh-v1.5/ (RAG embeddings)

Usage:
    python download_models.py
"""

import os
import ssl
import sys

# Keep a user-provided HF_ENDPOINT if set. Default to the official endpoint
# because some huggingface_hub versions fail metadata downloads via hf-mirror.com.
os.environ.setdefault("HF_ENDPOINT", "https://huggingface.co")
os.environ.setdefault("CURL_CA_BUNDLE", "")
os.environ.setdefault("REQUESTS_CA_BUNDLE", "")

try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)


def banner(title):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def download_snapshot(repo_id: str, save_dir: str):
    from huggingface_hub import snapshot_download

    os.makedirs(save_dir, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        repo_type="model",
        local_dir=save_dir,
        local_dir_use_symlinks=False,
    )


def download_sensevoice_small():
    banner("[1/2] 下载 FunAudioLLM/SenseVoiceSmall（ASR 方言识别模型）")
    save_dir = os.path.join(MODELS_DIR, "SenseVoiceSmall")
    print(f"保存路径: {save_dir}")
    download_snapshot("FunAudioLLM/SenseVoiceSmall", save_dir)
    print(f"[OK] SenseVoiceSmall 下载完成 -> {save_dir}")


def download_bge_model():
    banner("[2/2] 下载 BAAI/bge-small-zh-v1.5（知识库向量模型）")
    from sentence_transformers import SentenceTransformer

    save_dir = os.path.join(MODELS_DIR, "bge-small-zh-v1.5")
    os.makedirs(save_dir, exist_ok=True)
    print(f"保存路径: {save_dir}")
    model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    model.save(save_dir)
    print(f"[OK] BGE 模型下载完成 -> {save_dir}")


def print_summary():
    banner("下载完成汇总")
    for name in ["SenseVoiceSmall", "bge-small-zh-v1.5"]:
        path = os.path.join(MODELS_DIR, name)
        if os.path.isdir(path):
            total_mb = 0.0
            file_count = 0
            for root, _, files in os.walk(path):
                for file in files:
                    file_count += 1
                    total_mb += os.path.getsize(os.path.join(root, file)) / 1024 / 1024
            print(f"  [OK] {name}/ - {file_count} 个文件，共 {total_mb:.1f} MB")
        else:
            print(f"  [MISS] {name}/ - 未找到")

    print("\n后续步骤：")
    print("  1. 运行 python init_project.py 构建知识库和危机分类器")
    print("  2. 运行 python server.py 启动项目")


def main():
    steps = {
        "1": download_sensevoice_small,
        "2": download_bge_model,
    }
    failed = []
    for key, fn in steps.items():
        try:
            fn()
        except Exception as e:
            print(f"\n[ERROR] 步骤 {key} 失败: {e}")
            import traceback
            traceback.print_exc()
            failed.append(key)

    print_summary()
    if failed:
        print(f"\n[WARN] 以下步骤失败，请手动重试: {failed}")
        sys.exit(1)
    print("\n[OK] 全部必需模型下载完成。")


if __name__ == "__main__":
    main()
