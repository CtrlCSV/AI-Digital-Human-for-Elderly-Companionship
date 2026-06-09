import os

import numpy as np
import speech_recognition as sr
import torch
from dotenv import load_dotenv
from transformers import WhisperForConditionalGeneration, WhisperProcessor

load_dotenv()

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASR_MODEL_PATH = os.environ.get(
    "ASR_MODEL_PATH",
    os.path.join(_HERE, "models", "whisper-small-model"),
)


class CustomASR:
    def __init__(self, model_path: str = _ASR_MODEL_PATH):
        print(f"正在加载 Whisper 中文模型: {model_path}")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[ASR] 使用设备: {self.device}")

        self.processor = WhisperProcessor.from_pretrained(model_path)
        self.model = WhisperForConditionalGeneration.from_pretrained(
            model_path,
            device_map="auto" if self.device == "cuda" else None,
        )
        if self.device == "cpu":
            self.model = self.model.to("cpu")
        self.model.eval()
        self.recognizer = sr.Recognizer()

    def speech_to_text(self, audio_bytes: bytes = None) -> str:
        """支持字节流（WebSocket）和麦克风两种输入模式。"""
        if audio_bytes is not None:
            try:
                print("正在本地识别（字节流模式）...")
                audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            except Exception as e:
                return f"音频解析失败: {e}"
        else:
            with sr.Microphone() as source:
                print("系统已就绪，请说话...")
                self.recognizer.adjust_for_ambient_noise(source, duration=0.8)
                audio = self.recognizer.listen(source)
            wav_data = audio.get_raw_data(convert_rate=16000, convert_width=2)
            audio_np = np.frombuffer(wav_data, dtype=np.int16).astype(np.float32) / 32768.0

        try:
            print("正在本地识别...")
            input_features = self.processor(
                audio_np,
                sampling_rate=16000,
                return_tensors="pt"
            ).input_features.to(self.device)

            with torch.no_grad():
                predicted_ids = self.model.generate(
                    input_features,
                    language="chinese",
                    max_new_tokens=128,
                )

            return self.processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        except Exception as e:
            return f"识别过程出错: {e}"


asr_engine = CustomASR()

if __name__ == "__main__":
    while True:
        result = asr_engine.speech_to_text()
        print(f"识别结果: {result}")
