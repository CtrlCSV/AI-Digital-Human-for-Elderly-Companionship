"""
统一执行 server.py 启动前的初始化检查与构建。

常用命令：
    python init_project.py
    python init_project.py --force
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
PYTHON = sys.executable

REQUIRED_MODEL_MARKERS = {
    "ASR SenseVoiceSmall": ROOT / "models" / "SenseVoiceSmall",
    "BGE embedding": ROOT / "models" / "bge-small-zh-v1.5",
}
CRISIS_CLASSIFIER_PATH = ROOT / "models" / "crisis-bert" / "classifier.pkl"
PSY_DATA = ROOT / "psy_data.json"
VECTOR_DB = ROOT / "vector_db"
SOULCHAT_DATA = ROOT / "datasets" / "SoulChat" / "data"
SOS_DATA = ROOT / "datasets" / "SOS-1K" / "suicideDataProcessing" / "data" / "fine-grained"
ENV_FILE = ROOT / ".env"
FLASHHEAD_REPO_DEFAULT = PROJECT_ROOT / "SoulX-FlashHead"
FLASHHEAD_CKPT_NAME = "SoulX-FlashHead-1_3B"
FLASHHEAD_WAV2VEC_NAME = "wav2vec2-base-960h"
FLASHHEAD_CKPT_REQUIRED = [
    "VAE_LTX/diffusion_pytorch_model.safetensors",
]
FLASHHEAD_WAV2VEC_REQUIRED = [
    "config.json",
    "preprocessor_config.json",
]
FLASHHEAD_WAV2VEC_MODEL_FILES = [
    "model.safetensors",
    "pytorch_model.bin",
]


def log(message: str) -> None:
    print(f"[init] {message}")


def ok(message: str) -> None:
    print(f"[ OK ] {message}")


def warn(message: str) -> None:
    print(f"[WARN] {message}")


def run_script(script: str, *args: str) -> None:
    cmd = [PYTHON, str(ROOT / script), *args]
    log("运行: " + " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def dir_has_files(path: Path, patterns: Iterable[str]) -> bool:
    if not path.exists():
        return False
    return any(any(path.glob(pattern)) for pattern in patterns)


def model_available(path: Path) -> bool:
    if path.is_file():
        return True
    if not path.is_dir():
        return False
    model_suffixes = {".bin", ".safetensors", ".pt", ".pth", ".onnx", ".json", ".yaml", ".yml"}
    for file in path.rglob("*"):
        if not file.is_file():
            continue
        if ".cache" in file.relative_to(path).parts:
            continue
        if file.suffix.lower() in model_suffixes:
            return True
    return False


def missing_required_files(base_dir: Path, relative_paths: Iterable[str]) -> list[str]:
    if not base_dir.is_dir():
        return list(relative_paths)
    missing: list[str] = []
    for rel_path in relative_paths:
        if not (base_dir / rel_path).is_file():
            missing.append(rel_path)
    return missing


def flashhead_checkpoint_ready(path: Path) -> tuple[bool, list[str]]:
    missing = missing_required_files(path, FLASHHEAD_CKPT_REQUIRED)
    return not missing, missing


def wav2vec_ready(path: Path) -> tuple[bool, list[str]]:
    missing = missing_required_files(path, FLASHHEAD_WAV2VEC_REQUIRED)
    if not path.is_dir():
        missing.extend(FLASHHEAD_WAV2VEC_MODEL_FILES)
        return False, missing
    has_weight = any((path / name).is_file() for name in FLASHHEAD_WAV2VEC_MODEL_FILES)
    if not has_weight:
        missing.append("model.safetensors or pytorch_model.bin")
    return not missing, missing


def load_env_file() -> None:
    if not ENV_FILE.exists():
        return
    for raw_line in ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def resolve_config_path(env_name: str, default_path: Path) -> Path:
    raw = (os.environ.get(env_name) or "").strip()
    candidates: list[Path] = []
    if raw:
        raw_path = Path(os.path.expandvars(os.path.expanduser(raw)))
        if raw_path.is_absolute():
            candidates.append(raw_path)
        else:
            if raw_path.parts and raw_path.parts[0] == "..":
                candidates.append(ROOT / raw_path)
            else:
                candidates.extend([ROOT / raw_path, PROJECT_ROOT / raw_path])
    candidates.append(default_path)
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate.exists():
            return candidate
    return default_path.resolve()


def resolve_vector_db_path() -> Path:
    raw = (os.environ.get("VECTOR_DB_PATH") or "").strip()
    if not raw:
        return (ROOT / "vector_db").resolve()
    return Path(os.path.expandvars(os.path.expanduser(raw))).resolve()


def download_hf_snapshot(repo_id: str, target_dir: Path) -> None:
    from huggingface_hub import snapshot_download

    target_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        repo_type="model",
        local_dir=str(target_dir),
        local_dir_use_symlinks=False,
    )


def backup_broken_vector_db(reason: str) -> bool:
    if not VECTOR_DB.exists():
        return False
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = ROOT / f"vector_db_broken_{stamp}"
    try:
        shutil.move(str(VECTOR_DB), str(backup))
        warn(f"vector_db 不可用，已自动备份到 {backup.name}。原因: {reason}")
        return True
    except Exception as exc:
        warn(f"vector_db 自动备份失败: {exc}")
        warn("请关闭正在运行的 server.py、build_kb.py、Python 解释器或占用该目录的编辑器后重试。")
        return False


def warn_vector_db_unavailable(reason: str | None) -> None:
    warn("vector_db 当前无法被 ChromaDB 打开，初始化已停止，避免误删或覆盖已有向量库。")
    if reason:
        warn(f"ChromaDB 错误: {reason}")
    warn("请先关闭正在运行的 server.py、build_kb.py、Python 解释器，以及可能占用 demo/vector_db 的编辑器后重试。")
    warn("如果确认要丢弃当前损坏库并重建，请运行: python init_project.py --rebuild-vector-db")


def ensure_env() -> bool:
    if ENV_FILE.exists():
        ok("找到 .env")
        missing = [
            key for key in ("API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION")
            if not (os.environ.get(key) or "").strip()
        ]
        if missing:
            warn("以下环境变量尚未填写，相关能力会降级或不可用: " + ", ".join(missing))
            warn("server.py 仍可启动；要启用完整文字回复和语音，请编辑 demo/.env 后重启。")
        return True
    warn("未找到 .env。server.py 可以启动，但 LLM/TTS/FlashHead 需要先配置 API_KEY、AZURE_SPEECH_KEY 等变量。")
    return False


def ensure_python_packages() -> bool:
    required = {
        "chromadb": "chromadb",
        "sentence_transformers": "sentence-transformers",
        "funasr": "funasr",
        "modelscope": "modelscope",
        "huggingface_hub": "huggingface_hub",
        "loguru": "loguru",
        "torch": "torch",
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
    }
    missing = [pip_name for module, pip_name in required.items() if not module_available(module)]
    if missing:
        warn("当前 Python 环境缺少依赖: " + ", ".join(missing))
        warn("请先在 demo 目录运行: pip install -r requirements.txt")
        return False
    ok("Python 依赖检查通过")
    return True


def ensure_models(allow_download: bool) -> bool:
    missing = [name for name, marker in REQUIRED_MODEL_MARKERS.items() if not model_available(marker)]
    if not missing:
        ok("必需本地模型已存在")
        return True

    warn("缺少必需本地模型: " + ", ".join(missing))
    warn("正在自动下载必需模型。")
    run_script("download_models.py")
    still_missing = [name for name, marker in REQUIRED_MODEL_MARKERS.items() if not model_available(marker)]
    if still_missing:
        warn("下载后仍缺少模型: " + ", ".join(still_missing))
        return False
    ok("全部必需模型已准备完成")
    return True
def chroma_collection_count(collection_name: str) -> tuple[int | None, str | None]:
    """Check ChromaDB in a short subprocess so Windows file locks are released."""
    if not module_available("chromadb"):
        return None, "chromadb module is missing"

    code = r'''
import json
import sys
from pathlib import Path

collection_name = sys.argv[1]
vector_db = sys.argv[2]
try:
    import chromadb
    client = chromadb.PersistentClient(path=vector_db)
    try:
        collection = client.get_collection(name=collection_name)
        print(json.dumps({"ok": True, "count": int(collection.count())}, ensure_ascii=False))
    except Exception as exc:
        msg = str(exc)
        lower = msg.lower()
        if "does not exist" in lower or "not found" in lower or "does not exists" in lower:
            print(json.dumps({"ok": True, "count": 0}, ensure_ascii=False))
        else:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
'''
    env = os.environ.copy()
    env.setdefault("ANONYMIZED_TELEMETRY", "False")
    env.setdefault("CHROMA_TELEMETRY", "False")
    proc = subprocess.run(
        [PYTHON, "-c", code, collection_name, str(VECTOR_DB)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env=env,
    )
    output = (proc.stdout or "").strip().splitlines()
    if not output:
        err = (proc.stderr or "").strip() or f"subprocess exited with {proc.returncode}"
        warn(f"ChromaDB 检查失败: {err}")
        return None, err

    try:
        payload = json.loads(output[-1])
    except json.JSONDecodeError:
        err = "\n".join(output + ([proc.stderr.strip()] if proc.stderr else []))
        warn(f"ChromaDB 检查失败: {err}")
        return None, err

    if payload.get("ok"):
        return int(payload.get("count", 0)), None
    err = str(payload.get("error") or "unknown ChromaDB error")
    warn(f"ChromaDB 检查失败: {err}")
    return None, err



def ensure_flashhead_runtime() -> bool:
    repo_dir = resolve_config_path("FLASHHEAD_REPO_DIR", FLASHHEAD_REPO_DEFAULT)
    inference_py = repo_dir / "flash_head" / "inference.py"
    if not inference_py.exists():
        warn(f"未找到 SoulX-FlashHead 仓库: {repo_dir}")
        git = shutil.which("git")
        if not git:
            warn("当前环境没有 git，无法自动克隆 SoulX-FlashHead。请安装 git 后重新运行 init_project.py。")
            return False
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        run_cmd = [git, "clone", "--depth", "1", "https://github.com/Soul-AILab/SoulX-FlashHead.git", str(repo_dir)]
        log("运行: " + " ".join(run_cmd))
        subprocess.run(run_cmd, cwd=PROJECT_ROOT, check=True)

    if not inference_py.exists():
        warn("SoulX-FlashHead 克隆后仍缺少 flash_head/inference.py。")
        return False

    ckpt_dir = resolve_config_path("FLASHHEAD_CKPT_DIR", repo_dir / "models" / FLASHHEAD_CKPT_NAME)
    wav2vec_dir = resolve_config_path("FLASHHEAD_WAV2VEC_DIR", repo_dir / "models" / FLASHHEAD_WAV2VEC_NAME)

    ckpt_ready, ckpt_missing = flashhead_checkpoint_ready(ckpt_dir)
    wav2vec_ok, wav2vec_missing = wav2vec_ready(wav2vec_dir)

    if not ckpt_ready:
        warn(f"FlashHead 权重不完整，正在补齐到: {ckpt_dir}")
        download_hf_snapshot("Soul-AILab/SoulX-FlashHead-1_3B", ckpt_dir)
        ckpt_ready, ckpt_missing = flashhead_checkpoint_ready(ckpt_dir)
    if not wav2vec_ok:
        warn(f"wav2vec2 音频编码器不完整，正在补齐到: {wav2vec_dir}")
        download_hf_snapshot("facebook/wav2vec2-base-960h", wav2vec_dir)
        wav2vec_ok, wav2vec_missing = wav2vec_ready(wav2vec_dir)

    if inference_py.exists() and ckpt_ready and wav2vec_ok:
        ok("FlashHead 仓库和权重已准备完成")
        return True

    if ckpt_missing:
        warn("FlashHead 权重仍不完整，缺少文件: " + ", ".join(ckpt_missing))
    if wav2vec_missing:
        warn("wav2vec2 音频编码器仍不完整，缺少文件: " + ", ".join(wav2vec_missing))
    warn("FlashHead 仍未准备完整，server.py 将无法生成数字人视频。")
    return False
def ensure_psyqa_knowledge(force: bool) -> bool:
    if not PSY_DATA.exists():
        warn("未找到 psy_data.json，无法构建 PsyQA 知识库。请先把 PsyQA 数据放到 demo/psy_data.json。")
        return False

    count, chroma_error = chroma_collection_count("psy_cbt_knowledge")
    if count and count > 0 and not force:
        ok(f"PsyQA 知识库已存在，共 {count} 条")
        return True

    if count is None and VECTOR_DB.exists():
        warn_vector_db_unavailable(chroma_error or "unknown error")
        return False

    run_script("build_kb.py")
    count, _ = chroma_collection_count("psy_cbt_knowledge")
    if count and count > 0:
        ok(f"PsyQA 知识库构建完成，共 {count} 条")
        return True
    warn("PsyQA 知识库构建后仍为空，请检查 build_kb.py 输出和 psy_data.json。")
    return False


def ensure_soulchat_knowledge(force: bool, allow_download: bool) -> bool:
    has_data = dir_has_files(SOULCHAT_DATA, ["*.parquet"])
    if not has_data:
        warn("未找到 SoulChat parquet 数据，正在自动下载。")
        run_script("download_soulchat.py")
        has_data = dir_has_files(SOULCHAT_DATA, ["*.parquet"])
        if not has_data:
            warn("SoulChat 下载后仍未找到 parquet 文件，无法启用 SoulChat。")
            return False

    count, chroma_error = chroma_collection_count("soulchat_knowledge")
    if count and count > 0 and not force:
        ok(f"SoulChat 知识库已存在，共 {count} 条")
        return True

    if count is None and VECTOR_DB.exists():
        warn_vector_db_unavailable(chroma_error or "unknown error")
        return False

    run_script("build_kb_soulchat.py")
    count, _ = chroma_collection_count("soulchat_knowledge")
    if count and count > 0:
        ok(f"SoulChat 知识库构建完成，共 {count} 条")
    else:
        warn("SoulChat 知识库为空，初始化未完成。")
        return False
    return True


def ensure_crisis_classifier(force: bool) -> bool:
    model_path = CRISIS_CLASSIFIER_PATH
    if model_path.exists() and not force:
        ok("本地危机分类器已存在")
        return True

    if not (SOS_DATA / "test_data.tsv").exists() and not dir_has_files(SOS_DATA, ["fold*.tsv"]):
        warn("未找到 SOS-1K 训练数据，无法生成必需的危机分类器。")
        warn("请将 SOS-1K 数据放到 demo/datasets/SOS-1K/suicideDataProcessing/data/fine-grained 后重新运行 init_project.py。")
        return False

    run_script("train_crisis_classifier.py")
    if model_path.exists():
        ok("本地危机分类器训练完成")
        return True
    warn("危机分类器训练后仍未生成 classifier.pkl。")
    return False


def print_next_steps(all_required_ok: bool) -> None:
    print("\n初始化检查完成。")
    if all_required_ok:
        print("下一步可以运行：")
        print("    python server.py")
    else:
        print("仍有必需项未完成，暂不建议启动 server.py。请按上方 WARN 处理后重新运行 init_project.py。")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="统一执行 server.py 启动前的初始化检查与构建")
    parser.add_argument("--download", action="store_true", help="兼容旧命令；必需模型和数据会自动准备")
    parser.add_argument("--with-optional", action="store_true", help="兼容旧命令；危机分类器现在是必需项，此参数不再改变初始化行为")
    parser.add_argument("--force", action="store_true", help="即使输出已存在也重新运行构建脚本")
    parser.add_argument("--rebuild-vector-db", action="store_true", help="先备份当前 vector_db，再重新构建知识库")
    return parser.parse_args()


def main() -> int:
    global VECTOR_DB
    args = parse_args()
    os.chdir(ROOT)
    load_env_file()
    os.environ.setdefault("HF_ENDPOINT", "https://huggingface.co")
    VECTOR_DB = resolve_vector_db_path()
    log(f"向量库路径: {VECTOR_DB}")

    if args.rebuild_vector_db and VECTOR_DB.exists():
        if not backup_broken_vector_db("user requested rebuild"):
            return 1

    env_ok = ensure_env()
    deps_ok = ensure_python_packages()
    models_ok = ensure_models(args.download)
    flashhead_ok = ensure_flashhead_runtime()
    psyqa_ok = ensure_psyqa_knowledge(args.force)
    soulchat_ok = ensure_soulchat_knowledge(args.force, args.download)
    crisis_ok = ensure_crisis_classifier(args.force)

    all_required_ok = env_ok and deps_ok and models_ok and flashhead_ok and psyqa_ok and soulchat_ok and crisis_ok
    print_next_steps(all_required_ok)
    return 0 if all_required_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())










