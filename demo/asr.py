import io
import os
import subprocess
import tempfile
import wave

import numpy as np
import speech_recognition as sr
import torch
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env"))


def _resolve_model_path(value: str | None) -> str:
    default_path = os.path.join(_HERE, "models", "SenseVoiceSmall")
    raw = (value or "").strip()
    candidates = []
    if raw:
        expanded = os.path.expandvars(os.path.expanduser(raw))
        if os.path.isabs(expanded):
            candidates.append(expanded)
        else:
            candidates.extend([
                os.path.join(_HERE, expanded),
                os.path.join(os.path.dirname(_HERE), expanded),
            ])
    candidates.append(default_path)
    for candidate in candidates:
        candidate = os.path.abspath(candidate)
        if os.path.isdir(candidate):
            return candidate
    return os.path.abspath(default_path)


ASR_MODEL_PATH = _resolve_model_path(os.environ.get("ASR_MODEL_PATH"))
ASR_MODEL_ID = os.environ.get("ASR_MODEL_ID", "FunAudioLLM/SenseVoiceSmall").strip()
ASR_LANGUAGE = os.environ.get("ASR_LANGUAGE", "auto").strip() or "auto"
ASR_DEVICE = os.environ.get("ASR_DEVICE", "auto").strip().lower()


def _pick_device() -> str:
    if ASR_DEVICE and ASR_DEVICE != "auto":
        return ASR_DEVICE
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _decode_wav_bytes(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if sample_width == 2:
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sample_width == 1:
        audio = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width}")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32), sample_rate


def _audio_bytes_to_wav_file(audio_bytes: bytes) -> str:
    if audio_bytes[:4] == b"RIFF":
        audio, sample_rate = _decode_wav_bytes(audio_bytes)
    elif _looks_like_container_audio(audio_bytes):
        return _browser_audio_to_wav_file(audio_bytes)
    else:
        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        sample_rate = 16000

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return path


def _looks_like_container_audio(audio_bytes: bytes) -> bool:
    return (
        audio_bytes[:4] in (b"\x1aE\xdf\xa3", b"OggS")
        or audio_bytes[:3] == b"ID3"
        or audio_bytes[4:8] == b"ftyp"
    )


def _browser_audio_to_wav_file(audio_bytes: bytes) -> str:
    """Convert MediaRecorder output such as WebM/Opus or Ogg/Opus to 16 kHz WAV."""
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError("浏览器录音需要 ffmpeg/imageio-ffmpeg 才能转码") from exc

    in_fd, in_path = tempfile.mkstemp(suffix=".webm")
    out_fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(in_fd)
    os.close(out_fd)
    try:
        with open(in_path, "wb") as f:
            f.write(audio_bytes)
        cmd = [
            ffmpeg_exe, "-y", "-hide_banner", "-loglevel", "error",
            "-i", in_path,
            "-ac", "1",
            "-ar", "16000",
            "-sample_fmt", "s16",
            out_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return out_path
    except Exception:
        try:
            os.remove(out_path)
        except OSError:
            pass
        raise
    finally:
        try:
            os.remove(in_path)
        except OSError:
            pass


class CustomASR:
    def __init__(self, model_path: str = ASR_MODEL_PATH):
        self.model_path = model_path
        self.device = _pick_device()
        self.recognizer = sr.Recognizer()
        self.model = None
        self.postprocess = None

        print(f"[ASR] SenseVoice model={ASR_MODEL_ID}, local={self.model_path}, device={self.device}, language={ASR_LANGUAGE}")
        self._load_model()

    def _load_model(self) -> None:
        try:
            from funasr import AutoModel
            from funasr.utils.postprocess_utils import rich_transcription_postprocess
        except ImportError as exc:
            raise RuntimeError("SenseVoice ASR requires: pip install funasr modelscope huggingface_hub") from exc

        required_files = [
            "configuration.json",
            "config.yaml",
            "model.pt",
            "chn_jpn_yue_eng_ko_spectok.bpe.model",
            "am.mvn",
        ]
        local_ready = os.path.isdir(self.model_path) and all(
            os.path.isfile(os.path.join(self.model_path, name)) for name in required_files
        )
        model_source = self.model_path if local_ready else ASR_MODEL_ID
        print(f"[ASR] loading source={model_source}")
        self.model = AutoModel(
            model=model_source,
            trust_remote_code=True,
            device=self.device,
            hub="hf",
            disable_update=True,
        )
        self.postprocess = rich_transcription_postprocess

    def _record_microphone(self) -> bytes:
        with sr.Microphone() as source:
            print("系统已就绪，请说话...")
            self.recognizer.adjust_for_ambient_noise(source, duration=0.8)
            audio = self.recognizer.listen(source)
        return audio.get_wav_data(convert_rate=16000, convert_width=2)

    def speech_to_text(self, audio_bytes: bytes = None) -> str:
        if audio_bytes is None:
            audio_bytes = self._record_microphone()

        wav_path = _audio_bytes_to_wav_file(audio_bytes)
        try:
            result = self.model.generate(
                input=wav_path,
                cache={},
                language=ASR_LANGUAGE,
                use_itn=True,
                batch_size_s=60,
                merge_vad=False,
                merge_length_s=15,
            )
            text = result[0].get("text", "") if result else ""
            if self.postprocess:
                text = self.postprocess(text)
            return text.strip()
        except Exception as e:
            return f"识别过程出错: {e}"
        finally:
            try:
                os.remove(wav_path)
            except OSError:
                pass


asr_engine = CustomASR()

if __name__ == "__main__":
    while True:
        result = asr_engine.speech_to_text()
        print(f"识别结果: {result}")



