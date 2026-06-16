# demo 目录说明

这里是项目主应用目录。常用流程只有两步：

```bash
python init_project.py
python server.py
```

然后访问 `http://localhost:8000`。

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `server.py` | FastAPI 主服务，负责 WebSocket、ASR、LLM、TTS、FlashHead 流水线 |
| `public/` | 前端页面、样式和脚本 |
| `asr.py` | SenseVoiceSmall 语音识别，支持浏览器录音 WebM/Ogg 转 WAV |
| `tts.py` | Azure TTS 封装；未配置 Azure Key 时服务仍可启动，播报降级 |
| `flashhead_adapter.py` | SoulX-FlashHead 适配层，支持相对路径和旧绝对路径回退 |
| `init_project.py` | 初始化检查，负责依赖、模型、数据和知识库准备 |
| `build_kb.py` | 构建 PsyQA 知识库 |
| `build_kb_soulchat.py` | 构建 SoulChat 知识库 |
| `train_crisis_classifier.py` | 训练本地危机分类器 |

## .env 配置

`demo/.env` 使用中文注释和相对路径。必须填写自己的密钥：

```ini
API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=southeastasia
```

路径通常保持默认：

```ini
ASR_MODEL_PATH=models/SenseVoiceSmall
VECTOR_DB_PATH=vector_db
FLASHHEAD_REPO_DIR=../SoulX-FlashHead
FLASHHEAD_CKPT_DIR=../SoulX-FlashHead/models/SoulX-FlashHead-1_3B
FLASHHEAD_WAV2VEC_DIR=../SoulX-FlashHead/models/wav2vec2-base-960h
```

不要把本机旧绝对路径写进 `.env`。如果确实要自定义路径，可以写相对 `demo/` 或项目根目录的路径。

## 新机器初始化会检查什么

`init_project.py` 会依次检查：

| 项目 | 默认位置 |
| --- | --- |
| SenseVoiceSmall | `models/SenseVoiceSmall/` |
| bge-small-zh-v1.5 | `models/bge-small-zh-v1.5/` |
| ChromaDB 向量库 | `vector_db/` |
| SoulChat 数据 | `datasets/SoulChat/data/` |
| 危机分类器 | `models/crisis-bert/classifier.pkl` |
| SoulX-FlashHead 仓库 | `../SoulX-FlashHead/` |
| FlashHead 权重 | `../SoulX-FlashHead/models/SoulX-FlashHead-1_3B/` |
| wav2vec2 | `../SoulX-FlashHead/models/wav2vec2-base-960h/` |

缺少可自动下载的模型时，脚本会尝试下载。`psy_data.json` 和 SOS-1K 训练数据如果没有放入对应目录，脚本会明确提示。

## 语音与口型链路

前端说话按钮现在走后端 ASR：

1. 浏览器请求麦克风权限。
2. 使用 `MediaRecorder` 录制 WebM/Ogg 音频。
3. POST 到 `/asr`。
4. 后端转为 16 kHz WAV 后交给 SenseVoiceSmall。
5. 识别文本自动发送到聊天 WebSocket。

回复链路：

1. LLM 生成整句文本。
2. Azure TTS 合成 MP3。
3. FlashHead 生成带声音的 MP4。
4. 前端播放 FlashHead 返回的视频。

可用 `.env` 控制：

```ini
FLASHHEAD_ENABLED=1
```

调试时可先设置 `FLASHHEAD_ENABLED=0` 验证 TTS 是否正常。
