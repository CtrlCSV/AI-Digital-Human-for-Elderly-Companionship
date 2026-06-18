# AI Digital Human Companion System

面向情感陪伴场景的数字人聊天系统。后端使用 FastAPI + WebSocket，前端为原生 HTML/CSS/JS；对话由 OpenAI 兼容 LLM 生成，语音由 Azure TTS 合成，口型视频由 SoulX-FlashHead 生成，语音输入由本地 SenseVoiceSmall 识别。

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 文字对话 | OpenAI 兼容接口，默认配置 SiliconFlow |
| 语音输入 | 浏览器录音后提交到后端 SenseVoiceSmall 识别 |
| 语音回复 | Azure AI Speech TTS |
| 数字人口型 | SoulX-FlashHead 音频驱动 MP4 视频 |
| 情绪感知 | 摄像头帧经 DeepFace 分析后影响回复与头像变体 |
| 知识库 | ChromaDB + bge-small-zh-v1.5，支持 PsyQA / SoulChat |
| 提醒与联系人 | 本地 JSON 存储，按用户隔离 |

## 快速启动

推荐在 Windows PowerShell、Linux 或 macOS 终端中执行：

```bash
cd demo
python init_project.py
python server.py
```

启动后访问：

```text
http://localhost:8000
```

`init_project.py` 会检查依赖、本地模型、知识库、SoulChat 数据、危机分类器、SoulX-FlashHead 仓库和权重。缺少可自动下载的内容时会尝试补齐；缺少需要人工提供的数据时会在终端给出提示。

## 环境准备

建议使用 Python 3.10 和 Conda：

```bash
cd demo
conda env create -f environment.yml --name digital-human
conda activate digital-human
pip install -r requirements.txt
```

如需 GPU 运行 FlashHead，请确认 PyTorch CUDA 版本与显卡驱动匹配。本项目的 `requirements.txt` 默认使用 CUDA 12.1 的 PyTorch wheel 源。

## 配置 .env

仓库中的 [demo/.env](demo/.env) 是可提交模板，不包含真实密钥。首次运行前至少填写：

```ini
API_KEY=你的 LLM API Key
AZURE_SPEECH_KEY=你的 Azure Speech Key
AZURE_SPEECH_REGION=southeastasia
```

路径配置默认都是相对路径，通常不需要修改：

```ini
ASR_MODEL_PATH=models/SenseVoiceSmall
VECTOR_DB_PATH=vector_db
FLASHHEAD_REPO_DIR=../SoulX-FlashHead
FLASHHEAD_CKPT_DIR=../SoulX-FlashHead/models/SoulX-FlashHead-1_3B
FLASHHEAD_WAV2VEC_DIR=../SoulX-FlashHead/models/wav2vec2-base-960h
```

如果 Azure Key 未填写，`server.py` 仍可启动，但回复会降级为文字。FlashHead 默认会一直等待视频生成完成；调试 TTS 链路时可临时关闭 FlashHead。

## 模型与数据

这些大文件不应提交到仓库，初始化脚本会尽量自动准备：

| 路径 | 用途 |
| --- | --- |
| `demo/models/SenseVoiceSmall/` | 后端 ASR |
| `demo/models/bge-small-zh-v1.5/` | RAG 向量模型 |
| `demo/vector_db/` | ChromaDB 知识库 |
| `demo/datasets/SoulChat/` | SoulChat 数据 |
| `../SoulX-FlashHead/` | FlashHead 仓库和权重 |

PsyQA 数据需要手动放到：

```text
demo/psy_data.json
```

危机分类器训练数据如需启用完整训练流程，放到：

```text
demo/datasets/SOS-1K/suicideDataProcessing/data/fine-grained/
```

## 常见问题

### 点击“说话”没反应或识别不到

请确认浏览器已允许麦克风权限，并通过 `http://localhost:8000` 访问页面。现在说话按钮会使用浏览器录音，然后发给后端 `/asr`，不再依赖浏览器内置语音识别。

### FlashHead 跑完但没有声音或口型

检查终端是否出现 `[SYNTH] video saved`。如果没有，通常是 FlashHead 仍在生成、前端连接已断开，或视频文件没有成功写入。调试时可临时设置：

```ini
FLASHHEAD_ENABLED=0
```

先验证 TTS 音频链路；再恢复 FlashHead。

### 不想把本地数据提交到仓库

`.gitignore` 已排除模型、数据集、向量库、日志、缓存、用户数据和上传头像。提交前建议运行：

```bash
git status --short
```

确认没有真实密钥、模型权重或个人数据进入暂存区。

## 目录说明

```text
demo/
  server.py              FastAPI 主服务
  public/                前端页面与静态资源
  asr.py                 SenseVoiceSmall 语音识别
  tts.py                 Azure TTS
  flashhead_adapter.py   SoulX-FlashHead 适配层
  init_project.py        一键初始化检查
  build_kb*.py           知识库构建脚本
avatars/portraits/       预设数字人头像
SoulX-FlashHead/          FlashHead 源码与模型目录（不提交）
```
