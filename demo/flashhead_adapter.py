"""
SoulX-FlashHead 视频生成适配器。

接收 TTS 生成的 MP3 音频字节 + 角色 ID，返回带音频轨道的 MP4 视频字节。

在 .env 中配置：
  FLASHHEAD_REPO_DIR=../SoulX-FlashHead
  FLASHHEAD_CKPT_DIR=../SoulX-FlashHead/models/SoulX-FlashHead-1_3B
  FLASHHEAD_WAV2VEC_DIR=../SoulX-FlashHead/models/wav2vec2-base-960h
  FLASHHEAD_MODEL_TYPE=lite
"""

import io
import os
import sys
import tempfile
import threading
import wave
import numpy as np
from collections import deque
from dotenv import load_dotenv

load_dotenv()

# chdir 全局影响进程，FlashHead 调用必须串行
_flash_lock = threading.Lock()

_HERE = os.path.dirname(os.path.abspath(__file__))

FLASHHEAD_REPO_DIR = os.environ.get(
    "FLASHHEAD_REPO_DIR",
    os.path.join(_HERE, "..", "..", "SoulX-FlashHead"),
)
if os.path.isdir(FLASHHEAD_REPO_DIR) and FLASHHEAD_REPO_DIR not in sys.path:
    sys.path.insert(0, os.path.abspath(FLASHHEAD_REPO_DIR))

FLASHHEAD_CKPT_DIR = os.environ.get(
    "FLASHHEAD_CKPT_DIR",
    os.path.join(FLASHHEAD_REPO_DIR, "models", "SoulX-FlashHead-1_3B"),
)
FLASHHEAD_WAV2VEC_DIR = os.environ.get(
    "FLASHHEAD_WAV2VEC_DIR",
    os.path.join(FLASHHEAD_REPO_DIR, "models", "wav2vec2-base-960h"),
)
FLASHHEAD_MODEL_TYPE = os.environ.get("FLASHHEAD_MODEL_TYPE", "lite")

# avatar_id 1=girl, 2=elderly, 3=boy
AVATAR_PORTRAITS = {
    1: os.path.join(_HERE, "..", "avatars", "portraits", "girl.png"),
    2: os.path.join(_HERE, "..", "avatars", "portraits", "old.png"),
    3: os.path.join(_HERE, "..", "avatars", "portraits", "boy.png"),
}

_pipeline = None
_infer_params = None
_current_avatar_id = None
_available = None  # None=未检测, True/False=检测结果


def _check_available() -> bool:
    """检查 SoulX-FlashHead 是否可用（仓库存在 + 权重存在）。"""
    global _available
    if _available is not None:
        return _available
    if not os.path.isdir(FLASHHEAD_REPO_DIR):
        print(f"[FlashHead] 仓库目录不存在: {FLASHHEAD_REPO_DIR}，视频生成不可用，降级为纯音频。")
        _available = False
        return False
    try:
        import importlib
        spec = importlib.util.find_spec("flash_head")
        if spec is None:
            print("[FlashHead] 无法找到 flash_head 模块，视频生成不可用，降级为纯音频。")
            _available = False
            return False
    except Exception:
        _available = False
        return False
    _available = True
    return True


def _load_pipeline():
    """懒加载 FlashHead pipeline（耗时操作，只执行一次）。

    注意：flash_head 模块在 import 时使用相对路径加载 yaml 配置，
    所以必须先 chdir 到 SoulX-FlashHead 根目录再 import。
    """
    global _pipeline, _infer_params, _available
    if _pipeline is not None:
        return True
    if not _check_available():
        return False

    original_cwd = os.getcwd()
    repo_dir = os.path.abspath(FLASHHEAD_REPO_DIR)

    try:
        os.chdir(repo_dir)

        import sys as _sys
        for mod_name in list(_sys.modules.keys()):
            if mod_name == "flash_head" or mod_name.startswith("flash_head."):
                del _sys.modules[mod_name]

        from flash_head.inference import get_pipeline, get_infer_params
        print(f"[FlashHead] 正在加载 pipeline: ckpt={FLASHHEAD_CKPT_DIR}, wav2vec={FLASHHEAD_WAV2VEC_DIR}, type={FLASHHEAD_MODEL_TYPE}")
        _pipeline = get_pipeline(
            world_size=1,
            ckpt_dir=FLASHHEAD_CKPT_DIR,
            model_type=FLASHHEAD_MODEL_TYPE,
            wav2vec_dir=FLASHHEAD_WAV2VEC_DIR,
        )
        _infer_params = get_infer_params()
        print("[FlashHead] Pipeline 加载成功。")
        return True
    except Exception as e:
        print(f"[FlashHead] Pipeline 加载失败: {e}，降级为纯音频。")
        _pipeline = None
        _infer_params = None
        _available = False
        return False
    finally:
        os.chdir(original_cwd)


def _setup_avatar(avatar_id: int):
    """为指定角色设置 condition image（每次切换角色才需重新调用）。"""
    global _current_avatar_id
    if _current_avatar_id == avatar_id:
        return
    portrait_path = AVATAR_PORTRAITS.get(avatar_id, AVATAR_PORTRAITS[1])
    portrait_path = os.path.abspath(portrait_path)
    if not os.path.isfile(portrait_path):
        print(f"[FlashHead] 肖像图不存在: {portrait_path}，使用角色 1 的默认图像。")
        portrait_path = os.path.abspath(AVATAR_PORTRAITS[1])
    try:
        from flash_head.inference import get_base_data
        get_base_data(
            _pipeline,
            cond_image_path_or_dir=portrait_path,
            base_seed=9999,
            use_face_crop=False,
        )
        _current_avatar_id = avatar_id
        print(f"[FlashHead] 角色 {avatar_id} 肖像已设置: {portrait_path}")
    except Exception as e:
        print(f"[FlashHead] 设置角色肖像失败: {e}")


def _mp3_bytes_to_wav_file(audio_bytes: bytes, tmp_wav_path: str):
    """将 Azure TTS 返回的 MP3 字节转存为临时 WAV 文件（供 librosa 读取）。"""
    import soundfile as sf
    import librosa

    audio_io = io.BytesIO(audio_bytes)
    # 尝试直接用 soundfile 读（WAV/FLAC/OGG 等）
    try:
        data, sr = sf.read(audio_io)
    except Exception:
        # MP3 回退：用 librosa（依赖 audioread/ffmpeg）
        audio_io.seek(0)
        data, sr = librosa.load(audio_io, sr=None, mono=True)

    # 统一转为 float32 mono
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)

    # 写 16kHz WAV（SoulX-FlashHead 所需采样率）
    target_sr = _infer_params.get("sample_rate", 16000) if _infer_params else 16000
    if sr != target_sr:
        data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)

    # 保存为 16-bit PCM WAV
    pcm = (np.clip(data, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(tmp_wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(target_sr)
        wf.writeframes(pcm.tobytes())


def _run_inference(audio_array: np.ndarray) -> list:
    """对一段 float32 音频数组运行 FlashHead 推理，返回视频帧张量列表。"""
    import torch
    from flash_head.inference import get_audio_embedding, run_pipeline

    params = _infer_params
    sample_rate = params["sample_rate"]
    tgt_fps = params["tgt_fps"]
    frame_num = params["frame_num"]
    motion_frames_num = params["motion_frames_num"]
    slice_len = frame_num - motion_frames_num

    human_speech_array_slice_len = slice_len * sample_rate // tgt_fps

    if len(audio_array) < human_speech_array_slice_len:
        pad = human_speech_array_slice_len - len(audio_array)
        audio_array = np.concatenate([audio_array, np.zeros(pad, dtype=np.float32)])

    remainder = len(audio_array) % human_speech_array_slice_len
    if remainder > 0:
        pad = human_speech_array_slice_len - remainder
        audio_array = np.concatenate([audio_array, np.zeros(pad, dtype=np.float32)])

    slices = audio_array.reshape(-1, human_speech_array_slice_len)
    generated = []

    cached_audio_duration = params["cached_audio_duration"]
    cached_len = sample_rate * cached_audio_duration
    audio_end_idx = cached_audio_duration * tgt_fps
    audio_start_idx = audio_end_idx - frame_num

    audio_dq = deque([0.0] * cached_len, maxlen=cached_len)

    for chunk_idx, chunk in enumerate(slices):
        audio_dq.extend(chunk.tolist())
        audio_arr = np.array(audio_dq)
        emb = get_audio_embedding(_pipeline, audio_arr, audio_start_idx, audio_end_idx)
        video = run_pipeline(_pipeline, emb)
        video = video[motion_frames_num:]  # 去除动作重叠帧
        generated.append(video.cpu())

    return generated


def _frames_to_mp4_bytes(frames_list: list, wav_path: str) -> bytes:
    import imageio
    import imageio_ffmpeg
    import subprocess

    tgt_fps = _infer_params.get("tgt_fps", 25) if _infer_params else 25
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    tmp_video = tempfile.NamedTemporaryFile(suffix="_novid.mp4", delete=False)
    tmp_video.close()
    tmp_final = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_final.close()

    try:
        with imageio.get_writer(
            tmp_video.name,
            format="mp4",
            mode="I",
            fps=tgt_fps,
            codec="h264",
            ffmpeg_params=["-bf", "0"],
        ) as writer:
            for frames in frames_list:
                frames_np = frames.numpy().astype(np.uint8)
                for i in range(frames_np.shape[0]):
                    writer.append_data(frames_np[i])

        cmd = [
            ffmpeg_exe, "-y",
            "-i", tmp_video.name,
            "-i", wav_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            tmp_final.name,
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        with open(tmp_final.name, "rb") as f:
            return f.read()

    finally:
        for p in (tmp_video.name, tmp_final.name):
            try:
                os.unlink(p)
            except OSError:
                pass


def _frames_to_mp4_bytes_no_audio(frames_list: list) -> bytes:
    """将帧列表保存为无声 MP4。"""
    import imageio

    tgt_fps = _infer_params.get("tgt_fps", 25) if _infer_params else 25
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    try:
        with imageio.get_writer(
            tmp.name,
            format="mp4",
            mode="I",
            fps=tgt_fps,
            codec="h264",
            ffmpeg_params=["-bf", "0"],
        ) as writer:
            for frames in frames_list:
                frames_np = frames.numpy().astype(np.uint8)
                for i in range(frames_np.shape[0]):
                    writer.append_data(frames_np[i])
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def generate_idle_video_from_portrait(portrait_path: str, duration_sec: float = 6.0) -> bytes | None:
    """从肖像图生成单段待机视频（无声 MP4）。"""
    results = generate_idle_videos_from_portrait(portrait_path, count=1, duration_sec=duration_sec)
    return results[0] if results else None


def generate_idle_videos_from_portrait(portrait_path: str, count: int = 3, duration_sec: float = 6.0) -> list:
    """
    从肖像图生成多段待机视频（各段使用不同随机种子，产生自然变化）。
    在单次锁占用内连续推理，避免反复初始化开销。
    """
    global _current_avatar_id
    with _flash_lock:
        original_cwd = os.getcwd()
        try:
            os.chdir(os.path.abspath(FLASHHEAD_REPO_DIR))

            if not _load_pipeline():
                return []

            portrait_abs = os.path.abspath(portrait_path)
            if not os.path.isfile(portrait_abs):
                print(f"[FlashHead-Idle] 肖像图不存在: {portrait_abs}")
                return []

            _current_avatar_id = None
            from flash_head.inference import get_base_data
            get_base_data(
                _pipeline,
                cond_image_path_or_dir=portrait_abs,
                base_seed=9999,
                use_face_crop=False,
            )

            sample_rate = _infer_params.get("sample_rate", 16000) if _infer_params else 16000
            n_samples = int(duration_sec * sample_rate)

            results = []
            for i in range(count):
                rng = np.random.default_rng(seed=i * 137)
                audio_array = (rng.standard_normal(n_samples) * 0.001).astype(np.float32)
                frames = _run_inference(audio_array)
                if frames:
                    results.append(_frames_to_mp4_bytes_no_audio(frames))
                    print(f"[FlashHead-Idle] 第 {i+1}/{count} 段生成完成")

            return results

        except Exception as e:
            print(f"[FlashHead-Idle] 多段待机视频生成失败: {e}")
            return []
        finally:
            _current_avatar_id = None
            os.chdir(original_cwd)


def audio_to_video_mp4(audio_bytes: bytes, avatar_id: int) -> bytes | None:
    """将 TTS 音频（MP3 字节）转换为说话人视频（MP4），失败时返回 None。"""
    if not audio_bytes:
        return None

    with _flash_lock:
        original_cwd = os.getcwd()
        try:
            os.chdir(os.path.abspath(FLASHHEAD_REPO_DIR))

            if not _load_pipeline():
                return None

            tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp_wav.close()

            try:
                import librosa
                _mp3_bytes_to_wav_file(audio_bytes, tmp_wav.name)

                sample_rate = _infer_params.get("sample_rate", 16000) if _infer_params else 16000
                audio_array, _ = librosa.load(tmp_wav.name, sr=sample_rate, mono=True)

                _setup_avatar(avatar_id)
                frames = _run_inference(audio_array)

                if not frames:
                    return None

                return _frames_to_mp4_bytes(frames, tmp_wav.name)

            except Exception as e:
                print(f"[FlashHead] 视频生成失败（降级纯音频）: {e}")
                return None
            finally:
                try:
                    os.unlink(tmp_wav.name)
                except OSError:
                    pass
        finally:
            os.chdir(original_cwd)


def reset_avatar_cache():
    """清除当前已加载的肖像缓存，强制下次推理重新加载肖像（头像更新后调用）。"""
    global _current_avatar_id
    _current_avatar_id = None


def is_available() -> bool:
    return _check_available()
