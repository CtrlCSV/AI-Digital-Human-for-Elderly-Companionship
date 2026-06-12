### demo/ 目录说明

#### 推荐启动流程

新用户下载仓库后进入 `demo/` 目录，先运行初始化，再启动服务：

```powershell
python init_project.py
python server.py
```

`init_project.py` 会统一检查/准备：Python 依赖、本地 ASR/RAG 模型、PsyQA 知识库、SoulChat 数据与知识库、SOS-1K 危机分类器、SoulX-FlashHead 仓库和 FlashHead 权重。

#### 业务代码

| 文件 | 说明 |
|------|------|
| `server.py` | FastAPI 主服务，WebSocket 会话管理，TTS + FlashHead 视频流水线 |
| `llm.py` | LLM 对话逻辑，LangChain + ChromaDB RAG |
| `tts.py` | Azure TTS 封装，输出 MP3 音频字节 |
| `flashhead_adapter.py` | SoulX-FlashHead 封装，MP3 音频 -> MP4 说话人视频，支持按情绪选择头像条件图 |
| `asr.py` | SenseVoice 方言语音识别封装 |
| `emotion.py` | DeepFace 摄像头表情检测 |
| `build_kb.py` | 构建 PsyQA ChromaDB 知识库，通常由 `init_project.py` 自动调用 |
| `build_kb_soulchat.py` | 构建 SoulChat ChromaDB 知识库，通常由 `init_project.py` 自动调用 |
| `train_crisis_classifier.py` | 训练 SOS-1K 本地危机分类器，通常由 `init_project.py` 自动调用 |

#### 标准目录

| 目录/文件 | 说明 | 来源 |
|-----------|------|------|
| `models/SenseVoiceSmall/` | SenseVoice 方言语音识别模型 | [FunAudioLLM/SenseVoiceSmall](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) |
| `models/bge-small-zh-v1.5/` | RAG embedding 模型 | [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) |
| `models/crisis-bert/classifier.pkl` | SOS-1K 本地危机分类器 | `train_crisis_classifier.py` |
| `vector_db/` | ChromaDB 知识库 | `build_kb.py` / `build_kb_soulchat.py` |
| `datasets/SoulChat/data/*.parquet` | SoulChat 对话数据 | [Spiderman01/soulchat_split_raw](https://huggingface.co/datasets/Spiderman01/soulchat_split_raw) |
| `../SoulX-FlashHead/` | FlashHead 仓库 + 模型权重 | [Soul-AILab/SoulX-FlashHead](https://github.com/Soul-AILab/SoulX-FlashHead) |

SoulX-FlashHead 标准权重目录（相对于 `demo/`）：

```text
../SoulX-FlashHead/models/SoulX-FlashHead-1_3B/
../SoulX-FlashHead/models/wav2vec2-base-960h/
```

#### 数字人表情

FlashHead 当前接口没有独立的“表情强度”参数，表情主要由条件头像图决定。项目现在支持按情绪自动选择头像变体；把图片放到 `avatars/portraits/` 下即可：

```text
girl.png
girl_happy.png
girl_sad.png
girl_angry.png
girl_fear.png
girl_surprise.png
girl_disgust.png
old.png
old_happy.png
boy.png
boy_happy.png
```

如果没有对应情绪图，会自动回退到基础头像，例如 `girl.png`。摄像头识别到用户情绪后，后端会把情绪传给 FlashHead，让数字人使用对应的情绪头像生成说话视频。

#### 环境变量（.env）

路径可以写绝对路径，也可以写相对 `demo/` 或项目根目录的相对路径。旧机器上的绝对路径不存在时，代码会自动回退到上面的标准目录。

```ini
API_KEY=                        # LLM API Key（SiliconFlow 或 OpenAI 兼容）
AZURE_SPEECH_KEY=               # Azure 语音服务密钥
AZURE_SPEECH_REGION=            # 区域，如 southeastasia

ASR_MODEL_ID=FunAudioLLM/SenseVoiceSmall
ASR_MODEL_PATH=models/SenseVoiceSmall
ASR_LANGUAGE=auto
ASR_DEVICE=auto

FLASHHEAD_REPO_DIR=../SoulX-FlashHead
FLASHHEAD_CKPT_DIR=../SoulX-FlashHead/models/SoulX-FlashHead-1_3B
FLASHHEAD_WAV2VEC_DIR=../SoulX-FlashHead/models/wav2vec2-base-960h
FLASHHEAD_MODEL_TYPE=lite       # lite（单卡）或 pro（需双卡 RTX 5090）
```
