# Run This Project on a ModelScope Notebook GPU

This is the recommended path for development because the project has heavy GPU
runtime dependencies and large model weights. The local machine can stay as your
editing environment, while the Notebook runs the FastAPI backend on a cloud GPU.

## 1. Start the GPU Notebook

Open ModelScope "我的 Notebook", choose a GPU instance, and enter its terminal.

Use the prebuilt CUDA/PyTorch image. Do not install a CPU-only PyTorch over it.

## 2. Clone the space repository

```bash
git clone https://www.modelscope.cn/studios/S3v3n777/AI-Digital-Human-for-Elderly-Companionship.git
cd AI-Digital-Human-for-Elderly-Companionship
```

## 3. Bootstrap once

```bash
bash scripts/modelscope_notebook_gpu_setup.sh
```

The first run creates `demo/.env` and stops. Fill these values:

```ini
API_KEY=...
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=southeastasia
```

Then run the script again:

```bash
bash scripts/modelscope_notebook_gpu_setup.sh
```

It will install dependencies, clone SoulX-FlashHead, download required models,
build local assets, and start:

```text
http://0.0.0.0:8000
```

## 4. Use the running backend

Inside the Notebook, open the exposed web preview or terminal forwarding URL for
port `8000`. Your browser should load the project UI from the Notebook backend.

For local development, edit locally, push to ModelScope, then pull in Notebook:

```bash
git pull
bash scripts/modelscope_notebook_gpu_setup.sh
```

## Notes

- Keep secrets only in `demo/.env`; it is ignored by Git.
- Keep `FLASHHEAD_*` paths relative in the Notebook.
- The Notebook GPU is separate from the ModelScope space deployment GPU.
- Use the space deployment later, after the Notebook run is stable.
