# Digital-Human-Companion-System


---

## 项目介绍

面向老年人群体的 AI 情感陪伴系统。系统通过大语言模型（LLM）进行多轮对话，结合 Azure TTS 语音合成与 **SoulX-FlashHead** 说话人视频生成技术，实时渲染与用户口型/表情同步的数字人视频，实现自然流畅的人机情感陪伴体验。

**核心技术栈：**

| 模块 | 技术 |
|------|------|
| 对话 | LLM（OpenAI 兼容接口）+ LangChain + ChromaDB 知识库 |
| 语音识别 | Whisper（本地 LoRA 微调模型） |
| 语音合成 | Azure TTS |
| 方言合成 | Azure 内置方言声音（普通话 / 粤语 / 台湾腔，无需参考音频） |
| 数字人渲染 | SoulX-FlashHead（音频驱动说话人视频，Lite 模型 96FPS） |
| 空闲动画 | FlashHead 静音预生成循环待机视频 |
| 情绪感知 | DeepFace 实时摄像头表情分析 |
| 后端 | FastAPI + WebSocket |
| 前端 | 原生 HTML/CSS/JS，双缓冲 VideoPlayer + 空闲视频循环 |

**新增功能（参考 LiveTalking 架构集成）：**

| 功能 | 说明 |
|------|------|
| 方言切换 | 界面一键切换普通话 / 粤语 / 台湾腔，无需参考音频 |
| 说话被打断 | 用户开口即刻中断数字人，零延迟响应 |
| 空闲动画 | 不说话时播放循环待机视频（自动预生成，无需配置） |
| 自定义形象 | 上传自己的照片作为数字人头像 |
| 多并发 | 每个 WebSocket 连接独立会话，互不干扰 |

---

## 快速部署

### 1. 克隆本仓库

```bash
cd 目标文件夹目录
git clone https://github.com/CtrlCSV/Digital-Human-Companion-System
cd Digital-Human-Companion-System
```

### 2. 克隆 SoulX-FlashHead

与本项目**平级**克隆（路径已内置，无需额外配置）：

```bash
cd ..
git clone https://github.com/Soul-AILab/SoulX-FlashHead SoulX-FlashHead
cd Digital-Human-Companion-System
```

### 3. 下载所有需要的模型权重（仓库内**不包含**这些大文件，需自行下载）

> **重要**：本仓库 `.gitignore` 排除了所有模型权重、数据集、向量库等大文件，必须按下面步骤自行获取。

#### 3.1 SoulX-FlashHead 视频生成模型（约 10GB）

国内使用 HuggingFace 镜像加速：

```bash
# Linux / macOS
export HF_ENDPOINT=https://hf-mirror.com
# Windows PowerShell
$env:HF_ENDPOINT = "https://hf-mirror.com"

pip install "huggingface_hub[cli]"

cd ../SoulX-FlashHead

# 主模型（约 10GB，含 Model_Lite/Model_Pro/VAE_LTX/VAE_Wan 子目录）
huggingface-cli download Soul-AILab/SoulX-FlashHead-1_3B \
    --local-dir ./models/SoulX-FlashHead-1_3B \
    --repo-type model

# 音频编码器（约 400MB）
huggingface-cli download facebook/wav2vec2-base-960h \
    --local-dir ./models/wav2vec2-base-960h
```

下载完成后验证目录结构应包含 `Model_Lite/`、`VAE_LTX/` 等子目录，不能只有顶层文件。

> **降级模式**：若 SoulX-FlashHead 未就绪，系统自动降级为纯音频模式（仅 TTS，无视频）。

#### 3.2 Whisper 中文语音识别模型（约 500MB）

```bash
# Windows PowerShell
$env:HF_ENDPOINT = "https://hf-mirror.com"
# Linux / macOS
# export HF_ENDPOINT=https://hf-mirror.com

cd demo
huggingface-cli download Jingmiao/whisper-small-chinese_base \
    --local-dir ./models/whisper-small-model
```

#### 3.3 心理问答数据集（构建知识库用）

从 [thu-coai/PsyQA](https://github.com/thu-coai/PsyQA "中文心理健康支持问答数据集") 下载，重命名为 `psy_data.json` 放到 `demo/` 目录下。

### 4. 填写环境变量

编辑 `demo/.env`，填入真实凭据（路径相关配置已由代码自动推导，无需填写）：

```ini
# SiliconFlow / OpenAI 兼容的 LLM API Key
API_KEY=你的API密钥

# Azure 语音服务（TTS）
AZURE_SPEECH_KEY=你的Azure语音密钥
AZURE_SPEECH_REGION=southeastasia

# FlashHead 模型规格：lite（单卡实时）或 pro（需双卡 RTX5090）
FLASHHEAD_MODEL_TYPE=lite
```

### 5. 安装依赖环境

需要先安装 [Miniconda](https://docs.conda.io/en/latest/miniconda.html)。

**第一步：用 environment.yml 创建 conda 环境**

```bash
cd demo
conda env create -f environment.yml --name digital-human
conda activate digital-human
```

**第二步：安装 PyTorch（CUDA 12.1）**

```bash
pip install torch==2.5.1+cu121 torchaudio==2.5.1+cu121 \
    --index-url https://download.pytorch.org/whl/cu121
```

**第三步：安装 SoulX-FlashHead 依赖**

```bash
pip install -r ../SoulX-FlashHead/requirements.txt
```

**第四步：安装 FlashAttention**

```bash
pip install ninja
pip install flash_attn==2.8.0.post2 --no-build-isolation
```

> 编译太慢可从 [此处](https://github.com/Dao-AILab/flash-attention/releases/tag/v2.8.0.post2) 下载对应 Python3.10 + cu121 的预编译 `.whl` 直接安装。

**第五步：安装 ffmpeg**

```bash
conda install -c conda-forge ffmpeg=7 -y
```

### 6. 构建知识库

首次运行前执行（会自动下载 BGE-small-zh-v1.5 嵌入模型）：

```bash
cd demo
python build_kb.py
```

### 7. 启动服务

```bash
cd demo
python server.py
```

浏览器访问 `http://localhost:8000`

---

## 可选功能配置

### 方言切换

系统内置三种方言，**使用 Azure TTS 时无需任何额外配置或参考音频**：

| 方言 | 女声 | 男声 |
|------|------|------|
| 普通话（默认） | zh-CN-XiaoxiaoNeural | zh-CN-YunxiNeural / zh-CN-YunzeNeural |
| 粤语 | zh-HK-HiuGaaiNeural | zh-HK-WanLungNeural |
| 台湾腔 | zh-TW-HsiaoChenNeural | zh-TW-YunJheNeural |

在聊天页面左侧「🗣️ 方言设置」区域点击对应按钮即可实时切换，下一条回复立即生效。

### 空闲动画

无需额外配置。服务器首次启动时会在后台自动用 FlashHead 为每个角色生成 2.5 秒循环待机视频，缓存于 `demo/public/idle/`。下次启动直接读取缓存。

---

## Docker 部署

### 前提条件

- 宿主机已安装 NVIDIA 驱动（>= 530）
- 已安装 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
- SoulX-FlashHead 仓库与模型已按第 2、3 步下载完成

### 启动 Docker Desktop（以 Windows 为例）

双击运行 Docker Desktop

### 构建并启动

```bash
cd demo
docker compose up          # 前台启动（可看日志）
docker compose up -d       # 后台启动
docker compose down        # 停止
```

SoulX-FlashHead 模型目录通过 volume 挂载到容器，无需打包进镜像，按需修改 `demo/docker-compose.yml` 中的宿主机路径即可。
