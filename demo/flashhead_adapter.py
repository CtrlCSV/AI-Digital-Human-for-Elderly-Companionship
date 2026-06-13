"""
SoulX-FlashHead video generation adapter.

Receives TTS audio bytes and avatar id, then returns MP4 video bytes when FlashHead is available.
Paths can be absolute or relative to demo/ or the project root. If an old absolute path in .env
no longer exists, the adapter falls back to the repository layout used by init_project.py:
  ../SoulX-FlashHead/
  ../SoulX-FlashHead/models/SoulX-FlashHead-1_3B/
  ../SoulX-FlashHead/models/wav2vec2-base-960h/

Optional expression portraits can be added beside the base portraits, for example:
  avatars/portraits/girl_happy.png
  avatars/portraits/girl_sad.png
  avatars/portraits/old_neutral.png
"""

import io
import os
import sys
import tempfile
import threading
import time
import wave
from collections import deque
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

DEMO_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = DEMO_DIR.parent
load_dotenv(DEMO_DIR / ".env")

# chdir affects the whole process, so FlashHead calls must be serialized.
_flash_lock = threading.Lock()


def _resolve_config_path(env_name: str, *defaults: Path) -> str:
    """Resolve env paths portably; stale absolute .env values fall back to repo defaults."""
    raw = (os.environ.get(env_name) or "").strip()
    candidates: list[Path] = []
    if raw:
        raw_path = Path(os.path.expandvars(os.path.expanduser(raw)))
        if raw_path.is_absolute():
            candidates.append(raw_path)
        else:
            if raw_path.parts and raw_path.parts[0] == "..":
                candidates.append(DEMO_DIR / raw_path)
            else:
                candidates.extend([DEMO_DIR / raw_path, PROJECT_ROOT / raw_path])
    candidates.extend(defaults)

    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate.exists():
            return str(candidate)

    fallback = (defaults[0] if defaults else (DEMO_DIR / raw)).resolve()
    return str(fallback)


FLASHHEAD_REPO_DIR = _resolve_config_path(
    "FLASHHEAD_REPO_DIR",
    PROJECT_ROOT / "SoulX-FlashHead",
    PROJECT_ROOT / "third_party" / "SoulX-FlashHead",
)
if os.path.isdir(FLASHHEAD_REPO_DIR) and FLASHHEAD_REPO_DIR not in sys.path:
    sys.path.insert(0, os.path.abspath(FLASHHEAD_REPO_DIR))

FLASHHEAD_CKPT_DIR = _resolve_config_path(
    "FLASHHEAD_CKPT_DIR",
    Path(FLASHHEAD_REPO_DIR) / "models" / "SoulX-FlashHead-1_3B",
)
FLASHHEAD_WAV2VEC_DIR = _resolve_config_path(
    "FLASHHEAD_WAV2VEC_DIR",
    Path(FLASHHEAD_REPO_DIR) / "models" / "wav2vec2-base-960h",
)
FLASHHEAD_MODEL_TYPE = os.environ.get("FLASHHEAD_MODEL_TYPE", "lite")

# avatar_id 1=girl, 2=elderly, 3=boy
AVATAR_PORTRAITS = {
    1: str(PROJECT_ROOT / "avatars" / "portraits" / "girl.png"),
    2: str(PROJECT_ROOT / "avatars" / "portraits" / "old.png"),
    3: str(PROJECT_ROOT / "avatars" / "portraits" / "boy.png"),
}

_EMOTION_ALIASES = {
    "happy": "happy",
    "sad": "sad",
    "angry": "angry",
    "fear": "fear",
    "fearful": "fear",
    "surprise": "surprise",
    "surprised": "surprise",
    "disgust": "disgust",
    "neutral": "neutral",
    "开心": "happy",
    "高兴": "happy",
    "快乐": "happy",
    "难过": "sad",
    "悲伤": "sad",
    "生气": "angry",
    "愤怒": "angry",
    "害怕": "fear",
    "惊讶": "surprise",
    "厌恶": "disgust",
    "中性": "neutral",
}

_pipeline = None
_infer_params = None
_available = None
_current_avatar_id = None


def _disable_torch_compile_for_flashhead() -> None:
    """Force FlashHead to run in eager mode when Triton/inductor is unavailable."""
    if os.environ.get("FLASHHEAD_DISABLE_TORCH_COMPILE", "1").lower() in {"0", "false", "no"}:
        return
    try:
        import torch

        try:
            import torch._dynamo
            torch._dynamo.config.suppress_errors = True
        except Exception:
            pass

        if getattr(torch.compile, "__name__", "") != "_flashhead_eager_compile":
            def _flashhead_eager_compile(model=None, *args, **kwargs):
                return model

            torch.compile = _flashhead_eager_compile
            print("[FlashHead] torch.compile disabled; using eager mode.")
    except Exception as e:
        print(f"[FlashHead] Failed to disable torch.compile: {e}")


def _check_available() -> bool:
    """Check whether SoulX-FlashHead is available."""
    global _available
    if _available is not None:
        return _available
    if not os.path.isdir(FLASHHEAD_REPO_DIR):
        print(f"[FlashHead] Repository directory does not exist: {FLASHHEAD_REPO_DIR}; falling back to audio only.")
        _available = False
        return False
    try:
        import importlib.util
        spec = importlib.util.find_spec("flash_head")
        if spec is None:
            print("[FlashHead] Cannot find flash_head module; falling back to audio only.")
            _available = False
            return False
    except Exception as e:
        print(f"[FlashHead] Module check failed: {e}; falling back to audio only.")
        _available = False
        return False
    _available = True
    return True

def _load_pipeline():
    """Lazy-load the FlashHead pipeline once."""
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

        _disable_torch_compile_for_flashhead()
        from flash_head.inference import get_pipeline, get_infer_params
        try:
            from flash_head.src.pipeline import flash_head_pipeline
            flash_head_pipeline.COMPILE_MODEL = False
            flash_head_pipeline.COMPILE_VAE = False
        except Exception as e:
            print(f"[FlashHead] Could not disable compile flags: {e}")

        print(f"[FlashHead] Loading pipeline: ckpt={FLASHHEAD_CKPT_DIR}, wav2vec={FLASHHEAD_WAV2VEC_DIR}, type={FLASHHEAD_MODEL_TYPE}")
        _pipeline = get_pipeline(
            world_size=1,
            ckpt_dir=FLASHHEAD_CKPT_DIR,
            model_type=FLASHHEAD_MODEL_TYPE,
            wav2vec_dir=FLASHHEAD_WAV2VEC_DIR,
        )
        _infer_params = get_infer_params()
        print("[FlashHead] Pipeline loaded.")
        return True
    except Exception as e:
        print(f"[FlashHead] Pipeline load failed: {e}; falling back to audio only.")
        _pipeline = None
        _infer_params = None
        _available = False
        return False
    finally:
        os.chdir(original_cwd)


def _normalize_emotion(emotion: str | None) -> str:
    key = (emotion or "neutral").strip().lower()
    return _EMOTION_ALIASES.get(key, "neutral")


def _portrait_for_emotion(avatar_id: int, emotion: str | None) -> tuple[str, str]:
    base = Path(AVATAR_PORTRAITS.get(avatar_id, AVATAR_PORTRAITS[1])).resolve()
    emotion_key = _normalize_emotion(emotion)
    if emotion_key != "neutral":
        candidate = base.with_name(f"{base.stem}_{emotion_key}{base.suffix}")
        if candidate.is_file():
            return str(candidate), emotion_key
    neutral_candidate = base.with_name(f"{base.stem}_neutral{base.suffix}")
    if neutral_candidate.is_file():
        return str(neutral_candidate), "neutral"
    return str(base), "neutral"
def _setup_avatar(avatar_id: int, emotion: str | None = None) -> bool:
    """Set the condition image for the selected avatar and emotion portrait."""
    global _current_avatar_id
    portrait_path, emotion_key = _portrait_for_emotion(avatar_id, emotion)
    cache_key = (avatar_id, emotion_key, portrait_path)
    if _current_avatar_id == cache_key:
        return True

    if not os.path.isfile(portrait_path):
        print(f"[FlashHead] Portrait does not exist: {portrait_path}; using avatar 1 default.")
        portrait_path, emotion_key = _portrait_for_emotion(1, "neutral")
        cache_key = (1, emotion_key, portrait_path)
    try:
        from flash_head.inference import get_base_data
        get_base_data(
            _pipeline,
            cond_image_path_or_dir=portrait_path,
            base_seed=9999,
            use_face_crop=False,
        )
        _current_avatar_id = cache_key
        print(f"[FlashHead] Avatar {avatar_id} portrait set: {portrait_path} (emotion={emotion_key})")
        return True
    except Exception as e:
        _current_avatar_id = None
        print(f"[FlashHead] Failed to set avatar portrait: {e}")
        return False


def _mp3_bytes_to_wav_file(audio_bytes: bytes, tmp_wav_path: str):
    """Convert TTS audio bytes to a temporary WAV file for librosa/FlashHead."""
    import soundfile as sf
    import librosa

    audio_io = io.BytesIO(audio_bytes)
    # Try soundfile first for WAV/FLAC/OGG and similar formats.
    try:
        data, sr = sf.read(audio_io)
    except Exception:
        # Fall back to librosa for MP3.
        audio_io.seek(0)
        data, sr = librosa.load(audio_io, sr=None, mono=True)

    # Normalize to float32 mono.
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)

    # Write the sample rate required by FlashHead.
    target_sr = _infer_params.get("sample_rate", 16000) if _infer_params else 16000
    if sr != target_sr:
        data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)

    # Save as 16-bit PCM WAV.
    pcm = (np.clip(data, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(tmp_wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(target_sr)
        wf.writeframes(pcm.tobytes())


def _run_inference(audio_array: np.ndarray) -> list:
    """Run FlashHead inference on a float32 audio array and return frame tensors."""
    import torch
    from flash_head.inference import get_audio_embedding, run_pipeline

    if not hasattr(_pipeline, "latent_motion_frames"):
        raise RuntimeError("FlashHead avatar portrait is not initialized.")

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

    total_chunks = len(slices)
    print(f"[FlashHead] Inference start: chunks={total_chunks}, slice_samples={human_speech_array_slice_len}")
    for chunk_idx, chunk in enumerate(slices):
        chunk_start = time.time()
        print(f"[FlashHead] Running chunk {chunk_idx + 1}/{total_chunks}")
        audio_dq.extend(chunk.tolist())
        audio_arr = np.array(audio_dq)
        emb = get_audio_embedding(_pipeline, audio_arr, audio_start_idx, audio_end_idx)
        video = run_pipeline(_pipeline, emb)
        video = video[motion_frames_num:]  # Drop repeated motion frames.
        generated.append(video.cpu())
        print(f"[FlashHead] Chunk {chunk_idx + 1}/{total_chunks} done in {time.time() - chunk_start:.1f}s")

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
        print("[FlashHead] Frames encoded, muxing audio with ffmpeg")

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
    """Convert TTS audio bytes to a temporary WAV file for librosa/FlashHead."""
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
    """Generate a single silent idle video from a portrait image."""
    results = generate_idle_videos_from_portrait(portrait_path, count=1, duration_sec=duration_sec)
    return results[0] if results else None


def generate_idle_videos_from_portrait(portrait_path: str, count: int = 3, duration_sec: float = 6.0) -> list:
    """Generate multiple silent idle videos from a portrait image."""
    global _current_avatar_id
    with _flash_lock:
        original_cwd = os.getcwd()
        try:
            os.chdir(os.path.abspath(FLASHHEAD_REPO_DIR))

            if not _load_pipeline():
                return []

            portrait_abs = os.path.abspath(portrait_path)
            if not os.path.isfile(portrait_abs):
                print(f"[FlashHead-Idle] Portrait does not exist: {portrait_abs}")
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
                    print(f"[FlashHead-Idle] Generated segment {i+1}/{count}")

            return results

        except Exception as e:
            print(f"[FlashHead-Idle] Failed to generate idle videos: {e}")
            return []
        finally:
            _current_avatar_id = None
            os.chdir(original_cwd)

def audio_to_video_mp4(audio_bytes: bytes, avatar_id: int, emotion: str | None = None) -> bytes | None:
    """Convert TTS audio bytes to a talking-head MP4. Return None on failure."""
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

                if not _setup_avatar(avatar_id, emotion):
                    return None
                frames = _run_inference(audio_array)

                if not frames:
                    return None

                print("[FlashHead] Encoding MP4")
                return _frames_to_mp4_bytes(frames, tmp_wav.name)

            except Exception as e:
                print(f"[FlashHead] Video generation failed; falling back to audio only: {e}")
                return None
            finally:
                try:
                    os.unlink(tmp_wav.name)
                except OSError:
                    pass
        finally:
            os.chdir(original_cwd)

def reset_avatar_cache():
    """Clear the currently loaded avatar portrait cache."""
    global _current_avatar_id
    _current_avatar_id = None


def is_available() -> bool:
    return _check_available()





