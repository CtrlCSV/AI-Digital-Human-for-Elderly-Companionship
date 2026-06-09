### demo/ 目录说明

#### 业务代码

| 文件 | 说明 |
|------|------|
| `server.py` | FastAPI 主服务，WebSocket 会话管理，TTS + FlashHead 视频流水线 |
| `llm.py` | LLM 对话逻辑，LangChain + ChromaDB RAG |
| `tts.py` | Azure TTS 封装，输出 MP3 音频字节 |
| `flashhead_adapter.py` | SoulX-FlashHead 封装，MP3 音频 → MP4 说话人视频 |
| `asr.py` | Whisper 语音识别封装 |
| `emotion.py` | DeepFace 摄像头表情检测 |
| `build_kb.py` | 构建 ChromaDB 知识库（首次运行前执行） |

#### 需要下载的模型文件

| 目录/文件 | 说明 | 来源 |
|-----------|------|------|
| `models/whisper-small-zh/` | Whisper 中文识别模型 | [Jingmiao/whisper-small-chinese_base](https://huggingface.co/Jingmiao/whisper-small-chinese_base) |
| `vector_db/` | ChromaDB 知识库（可自动生成） | `build_kb.py` |
| `psy_data.json` | PsyQA 心理问答数据集 | [thu-coai/PsyQA](https://github.com/thu-coai/PsyQA) |
| `../SoulX-FlashHead/` | FlashHead 仓库 + 模型权重 | [Soul-AILab/SoulX-FlashHead](https://github.com/Soul-AILab/SoulX-FlashHead) |

SoulX-FlashHead 模型权重放置路径（相对于 `demo/`）：

```
../SoulX-FlashHead/models/SoulX-FlashHead-1_3B/
../SoulX-FlashHead/models/wav2vec2-base-960h/
```

#### 环境变量（.env）

```ini
API_KEY=                        # LLM API Key（SiliconFlow 或 OpenAI 兼容）
AZURE_SPEECH_KEY=               # Azure 语音服务密钥
AZURE_SPEECH_REGION=            # 区域，如 southeastasia

FLASHHEAD_REPO_DIR=../SoulX-FlashHead
FLASHHEAD_CKPT_DIR=../SoulX-FlashHead/models/SoulX-FlashHead-1_3B
FLASHHEAD_WAV2VEC_DIR=../SoulX-FlashHead/models/wav2vec2-base-960h
FLASHHEAD_MODEL_TYPE=lite       # lite（单卡）或 pro（需双卡 RTX 5090）
```
