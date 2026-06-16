#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
FLASHHEAD_DIR="$ROOT_DIR/SoulX-FlashHead"

cd "$DEMO_DIR"

echo "[ms-gpu] Project: $ROOT_DIR"
echo "[ms-gpu] Python: $(python --version)"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi
else
  echo "[ms-gpu] nvidia-smi not found. Make sure the Notebook is using a GPU instance."
fi

python - <<'PY'
import sys
try:
    import torch
except Exception as exc:
    raise SystemExit(f"[ms-gpu] PyTorch is not importable: {exc}")

print(f"[ms-gpu] torch={torch.__version__}")
print(f"[ms-gpu] cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"[ms-gpu] gpu={torch.cuda.get_device_name(0)}")
else:
    raise SystemExit("[ms-gpu] CUDA is not available. Switch the Notebook to a GPU image before continuing.")
PY

if [ ! -f "$DEMO_DIR/.env" ]; then
  cp "$DEMO_DIR/.env.modelscope.example" "$DEMO_DIR/.env"
  echo "[ms-gpu] Created demo/.env from demo/.env.modelscope.example."
  echo "[ms-gpu] Fill API_KEY and AZURE_SPEECH_KEY in demo/.env, then run this script again."
  exit 2
fi

export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export FLASHHEAD_DISABLE_TORCH_COMPILE="${FLASHHEAD_DISABLE_TORCH_COMPILE:-1}"

echo "[ms-gpu] Installing project dependencies without replacing CUDA PyTorch..."
python -m pip install -U pip wheel setuptools
python -m pip install -r "$DEMO_DIR/requirements-modelscope-gpu.txt"

if [ ! -d "$FLASHHEAD_DIR/flash_head" ]; then
  echo "[ms-gpu] Cloning SoulX-FlashHead..."
  git clone --depth 1 https://github.com/Soul-AILab/SoulX-FlashHead.git "$FLASHHEAD_DIR"
fi

if [ -f "$FLASHHEAD_DIR/requirements.txt" ]; then
  echo "[ms-gpu] Installing SoulX-FlashHead dependencies without replacing CUDA PyTorch..."
  FILTERED_REQ="/tmp/flashhead-requirements-no-torch.txt"
  grep -vE '^(torch|torchaudio|torchvision|xformers|flash-attn|mediapipe)([<=> ].*)?$' "$FLASHHEAD_DIR/requirements.txt" > "$FILTERED_REQ"
  python -m pip install -r "$FILTERED_REQ"
  python -m pip install "mediapipe>=0.10.13"
fi

echo "[ms-gpu] Running project initializer. This may download FlashHead and ASR models."
python init_project.py --download

echo "[ms-gpu] Starting FastAPI server on 0.0.0.0:${SERVER_PORT:-8000}"
python server.py
