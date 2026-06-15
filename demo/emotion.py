import os

# 强制 DeepFace 的 TensorFlow 后端只用 CPU：把整块 GPU 显存让给 FlashHead 视频生成。
# 必须在 import deepface（会触发 import tensorflow）之前隐藏 GPU，否则 TF 会先抢占显存导致 FlashHead OOM。
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
try:
    import tensorflow as tf
    tf.config.set_visible_devices([], "GPU")
except Exception as _e:
    print(f"[emotion] 限制 TensorFlow 使用 CPU 失败（忽略）: {_e}")

import cv2
from deepface import DeepFace
import numpy as np

# 仅在情绪发生变化时打印一次，避免每秒都刷日志
_last_emotion = None


def get_face_emotion(img_bytes):
    global _last_emotion
    try:
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return "neutral"

        result = DeepFace.analyze(
            frame,
            actions=["emotion"],
            enforce_detection=False,
        )
        emotion = result[0]["dominant_emotion"]

        if emotion != _last_emotion:
            print(f"[emotion] 情绪变化: {_last_emotion} -> {emotion}")
            _last_emotion = emotion
        return emotion

    except Exception as e:
        print(f"[emotion] 识别出错: {e}")
        return "neutral"