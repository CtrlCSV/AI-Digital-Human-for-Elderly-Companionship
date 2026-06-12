import asyncio
import base64
import io
import json
import os
import re
import struct
import time
import traceback
import wave
from dataclasses import dataclass, field
from itertools import count
from typing import Any, Dict, Optional

from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env"))
from starlette.websockets import WebSocketState
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from llm import (
    llm_chat,
    append_user_message,
    commit_assistant_message,
    classify_interrupt_intent,
    build_followup_reply,
    get_session_messages,
)
from user_profile import record_turn, delete_profile
from asr import asr_engine
from emotion import get_face_emotion
from tts import tts_engine, TTSGenerationError
from tools import get_weather, get_calendar, get_news
import reminders as reminders_mod
import reminder_service as reminder_service_mod
import userdata as userdata_mod
import crisis as crisis_mod
import contacts as contacts_mod
from contacts import build_contact_action

import contextlib

import flashhead_adapter

DIALECTS = {
    "mandarin":  "普通话",
    "cantonese": "粤语",
    "taiwanese": "台湾腔",
}

IDLE_SEGMENT_COUNT = 1
IDLE_DURATION_SEC = 25.0


def _idle_segment_paths(role: str) -> list:
    paths = []
    i = 0
    while True:
        p = os.path.join(os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"), f"idle_{role}_{i}.mp4")
        if not os.path.isfile(p):
            break
        paths.append(p)
        i += 1
    return paths


async def _generate_preset_idle_videos():
    """服务启动后，为尚未有待机视频的预设角色自动生成多段待机视频。"""
    if not flashhead_adapter.is_available():
        return
    await asyncio.sleep(3)
    role_map = {1: "girl", 2: "elderly", 3: "boy"}
    _pub = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
    for avatar_id, role in role_map.items():
        if _idle_segment_paths(role):
            print(f"[IdleVideo] idle_{role}_*.mp4 已存在，跳过")
            continue
        portrait_path = flashhead_adapter.AVATAR_PORTRAITS.get(avatar_id)
        if not portrait_path or not os.path.isfile(portrait_path):
            continue
        print(f"[IdleVideo] 正在为预设角色 {role} 生成待机视频...")
        asyncio.create_task(_generate_idle_videos_bg(portrait_path, role, _pub))


async def _generate_idle_videos_bg(portrait_path: str, role: str, pub_dir: str, count: int = IDLE_SEGMENT_COUNT):
    try:
        loop = asyncio.get_running_loop()
        segments = await loop.run_in_executor(
            None,
            lambda: flashhead_adapter.generate_idle_videos_from_portrait(
                portrait_path, count=count, duration_sec=IDLE_DURATION_SEC
            ),
        )
        for i, mp4_bytes in enumerate(segments):
            save_path = os.path.join(pub_dir, f"idle_{role}_{i}.mp4")
            with open(save_path, "wb") as f:
                f.write(mp4_bytes)
        print(f"[IdleVideo] 已保存 {len(segments)} 段待机视频 ({role})")
    except Exception as e:
        print(f"[IdleVideo] 生成异常: {e}")
        traceback.print_exc()


@contextlib.asynccontextmanager
async def lifespan(app_instance):
    asyncio.create_task(_generate_preset_idle_videos())
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_PUBLIC_DIR = os.path.join(_HERE, "public")

app.mount("/static", StaticFiles(directory=_PUBLIC_DIR), name="static")

# 清洗 LLM 偶尔泄露的工具标签和 markdown 标记
_META_TAG_PATTERN = re.compile(r'【[^】]{0,30}】')
_STAGE_DIRECTION_PATTERN = re.compile(r'（[^）]{1,40}）')
_STAGE_DIRECTION_ASCII_PATTERN = re.compile(r'\([^)\d]{2,40}\)')
_MARKDOWN_BOLD_PATTERN = re.compile(r'\*{1,3}')
_MARKDOWN_HEADING_PATTERN = re.compile(r'^#{1,6}\s*', re.MULTILINE)
_MARKDOWN_CODE_PATTERN = re.compile(r'`{1,3}')
_BACKSLASH_NEWLINE_PATTERN = re.compile(r'\\n')
_MULTI_SPACE_PATTERN = re.compile(r'[ \t]{2,}')


def sanitize_chunk(text: str) -> str:
    if not text:
        return ''
    text = _META_TAG_PATTERN.sub('', text)
    text = _STAGE_DIRECTION_PATTERN.sub('', text)
    text = _STAGE_DIRECTION_ASCII_PATTERN.sub('', text)
    text = _MARKDOWN_HEADING_PATTERN.sub('', text)
    text = _MARKDOWN_BOLD_PATTERN.sub('', text)
    text = _MARKDOWN_CODE_PATTERN.sub('', text)
    text = _BACKSLASH_NEWLINE_PATTERN.sub(' ', text)
    text = _MULTI_SPACE_PATTERN.sub(' ', text)
    return text.strip()


EMOTION_INTERVAL = 1.0
CUSTOM_AVATAR_ID = 99  # 与前端 script.js 自定义形象的 avatar.id 保持一致
response_id_counter = count(1)
_CUSTOM_AVATAR_DIR = os.path.join(_PUBLIC_DIR, "custom_avatars")
os.makedirs(_CUSTOM_AVATAR_DIR, exist_ok=True)



@dataclass
class ResponseState:
    response_id: int
    session_id: str
    user_text: str
    full_text: str = ""
    interrupted: bool = False
    completed: bool = False
    started_at: float = field(default_factory=time.time)


def resolve_role(avatar_id):
    if avatar_id == 1:
        return "girl"
    if avatar_id == 2:
        return "elderly"
    if avatar_id == 3:
        return "boy"
    return "girl"


async def safe_send(ws: WebSocket, data: Dict[str, Any], lock: asyncio.Lock = None) -> bool:
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            if lock:
                async with lock:
                    await ws.send_json(data)
            else:
                await ws.send_json(data)
            return True
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print("发送失败:", e)
    return False


def pcm_list_to_wav_bytes(audio_data):
    raw_pcm = struct.pack(f"<{len(audio_data)}h", *audio_data)
    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(raw_pcm)
    return wav_io.getvalue()


async def send_stop_output(websocket: WebSocket, response_id: int, reason="barge_in", lock: asyncio.Lock = None):
    await safe_send(websocket, {
        "type": "stop_output",
        "responseId": response_id,
        "reason": reason,
        "stopAudio": True,
        "stopBlendshape": True,
        "enterListening": True,
    }, lock)
    await safe_send(websocket, {
        "type": "listen_state",
        "state": "listening",
        "responseId": response_id,
        "microActions": ["eye_contact", "nod"],
    }, lock)


async def synthesize_pipeline(clean_text: str, role: str, avatar_id, dialect: str = "mandarin", emotion: str = "neutral") -> tuple:
    """整句合成：TTS → FlashHead，返回 (audio_bytes, video_mp4)。"""
    audio_bytes = await tts_engine.generate_audio_bytes(clean_text, role=role, dialect=dialect)
    loop = asyncio.get_running_loop()
    video_mp4 = await loop.run_in_executor(
        None, flashhead_adapter.audio_to_video_mp4, audio_bytes, avatar_id, emotion
    )
    return audio_bytes, video_mp4


async def process_user_message(
    websocket: WebSocket,
    user_text: str,
    emotion: str,
    session_id: str,
    avatar_id,
    response_state: ResponseState,
    is_current_response,
    preset_reply: str = None,
    dialect: str = "mandarin",
    lock: asyncio.Lock = None,
    user_name: str = "",
    user_id: str = "",
    city: str = "",
    crisis_mode: bool = False,
):
    """收集完整 LLM 回复 → 一次 TTS + 一次视频合成 → 整句输出。"""
    role = resolve_role(avatar_id)

    try:
        full_reply = ""
        await append_user_message(session_id, user_text)

        await safe_send(websocket, {
            "type": "turn_start",
            "responseId": response_state.response_id,
            "userText": user_text,
        }, lock)

        # 1. 收集完整回复（流式读取，不分句发送）
        if preset_reply is not None:
            full_reply = preset_reply
        else:
            async for char in llm_chat(user_text, emotion, session_id,
                                       user_name=user_name, avatar_id=avatar_id,
                                       user_id=user_id, city=city,
                                       crisis_mode=crisis_mode):
                if not is_current_response(response_state.response_id):
                    response_state.interrupted = True
                    break
                full_reply += char
        response_state.full_text = full_reply

        if not full_reply.strip() and is_current_response(response_state.response_id):
            full_reply = "抱歉，我刚才走神了，您可以再说一遍吗？"
            response_state.full_text = full_reply

        # 2. 文字整句发送至前端（先清洗 markdown/元标签）
        if is_current_response(response_state.response_id):
            clean_full = sanitize_chunk(full_reply.strip())
            await safe_send(websocket, {
                "type": "assistant_text_delta",
                "responseId": response_state.response_id,
                "delta": clean_full,
                "fullText": clean_full,
            }, lock)

        # 3. 整句合成语音与视频
        if full_reply.strip() and is_current_response(response_state.response_id):
            clean_text = sanitize_chunk(full_reply.strip())
            audio_bytes, video_mp4 = None, None
            try:
                audio_bytes, video_mp4 = await synthesize_pipeline(clean_text, role, avatar_id, dialect, emotion)
            except TTSGenerationError as e:
                print(f"[TTS] 合成失败: {e}")
            except Exception as e:
                print(f"[合成] 异常: {e}")

            if is_current_response(response_state.response_id):
                payload = {
                    "type": "assistant_chunk",
                    "responseId": response_state.response_id,
                    "seq": 0,
                    "text": clean_text,
                    "emotion": emotion or "neutral",
                    "fullText": full_reply,
                    "isFinalChunk": True,
                }
                if video_mp4:
                    payload["video"] = base64.b64encode(video_mp4).decode("utf-8")
                elif audio_bytes:
                    payload["audio"] = base64.b64encode(audio_bytes).decode("utf-8")
                else:
                    payload["fallback"] = "text_only"
                await safe_send(websocket, payload, lock)

        if is_current_response(response_state.response_id) and not response_state.interrupted:
            response_state.completed = True
            await commit_assistant_message(session_id, response_state.full_text)
            asyncio.create_task(record_turn(user_id or session_id, user_text, response_state.full_text))

    except asyncio.CancelledError:
        response_state.interrupted = True
        raise
    except Exception as e:
        print("处理对话时发生异常:", e)
        traceback.print_exc()
        if is_current_response(response_state.response_id):
            await safe_send(websocket, {"type": "error", "message": "处理消息时出错了"}, lock)
    finally:
        if is_current_response(response_state.response_id) and not response_state.interrupted:
            await safe_send(websocket, {
                "type": "turn_end",
                "responseId": response_state.response_id,
                "fullText": response_state.full_text,
            }, lock)
        elif response_state.interrupted:
            await safe_send(websocket, {
                "type": "turn_interrupted",
                "responseId": response_state.response_id,
                "spokenText": response_state.full_text,
                "pendingText": "",
            }, lock)


@app.get("/")
async def get_index():
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@app.get("/api/weather")
async def api_weather(city: Optional[str] = None):
    data = await get_weather(city)
    return JSONResponse(data)


@app.get("/api/news")
async def api_news(topic: Optional[str] = None):
    data = await get_news(topic)
    return JSONResponse(data)


@app.get("/api/calendar")
async def api_calendar():
    return JSONResponse({"ok": True, **get_calendar()})


# =============================================================
#                       家庭联系人 CRUD
#   后端 contacts.py 是危机告警 / 「联系家属」的数据源，
#   前端必须写到这里，否则数字人拿不到真实联系人。
# =============================================================
@app.get("/api/contacts")
async def api_contacts_list(userId: Optional[str] = None):
    return JSONResponse({"ok": True, "contacts": contacts_mod.list_contacts(userId)})


@app.post("/api/contacts")
async def api_contacts_add(request: Request):
    body = await request.json()
    try:
        contact = contacts_mod.add_contact(
            user_id=body.get("userId"),
            name=body.get("name", ""),
            relation=body.get("relation", ""),
            phone=body.get("phone", ""),
            wechat=body.get("wechat", ""),
            note=body.get("note", ""),
            is_emergency=bool(body.get("emergency") or body.get("is_emergency")),
        )
        return JSONResponse({"ok": True, "contact": contact})
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.put("/api/contacts/{contact_id}")
async def api_contacts_update(contact_id: str, request: Request):
    body = await request.json()
    changes = {}
    for key in ("name", "relation", "phone", "wechat", "note"):
        if key in body:
            changes[key] = body[key]
    if "emergency" in body or "is_emergency" in body:
        changes["is_emergency"] = bool(body.get("emergency") or body.get("is_emergency"))
    contact = contacts_mod.update_contact(body.get("userId"), contact_id, **changes)
    if contact is None:
        return JSONResponse({"ok": False, "error": "联系人不存在"}, status_code=404)
    return JSONResponse({"ok": True, "contact": contact})


@app.delete("/api/contacts/{contact_id}")
async def api_contacts_delete(contact_id: str, userId: Optional[str] = None):
    removed = contacts_mod.remove_contact(userId, contact_id)
    return JSONResponse({"ok": removed, "removed": removed})


# =============================================================
#                  「我的提醒」可重复提醒 CRUD
# =============================================================
@app.get("/api/reminders")
async def api_reminders_list(userId: Optional[str] = None):
    return JSONResponse({"ok": True, "items": reminder_service_mod.list_items(userId)})


@app.post("/api/reminders")
async def api_reminders_add(request: Request):
    body = await request.json()
    try:
        item = reminder_service_mod.add(body.get("userId"), body)
        return JSONResponse({"ok": True, "item": item})
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/reminders/bulk")
async def api_reminders_bulk(request: Request):
    body = await request.json()
    items = reminder_service_mod.replace_all(body.get("userId"), body.get("items") or [])
    return JSONResponse({"ok": True, "items": items})


@app.put("/api/reminders/{item_id}")
async def api_reminders_update(item_id: str, request: Request):
    body = await request.json()
    item = reminder_service_mod.update(body.get("userId"), item_id, body)
    if item is None:
        return JSONResponse({"ok": False, "error": "提醒不存在"}, status_code=404)
    return JSONResponse({"ok": True, "item": item})


@app.delete("/api/reminders/{item_id}")
async def api_reminders_delete(item_id: str, userId: Optional[str] = None):
    removed = reminder_service_mod.remove(userId, item_id)
    return JSONResponse({"ok": removed, "removed": removed})


# =============================================================
#         通用「按用户分隔」键值存储（其余本地数据的后端落点）
# =============================================================
@app.get("/api/userdata")
async def api_userdata_get(userId: Optional[str] = None):
    return JSONResponse({"ok": True, "data": userdata_mod.get_all(userId)})


@app.put("/api/userdata")
async def api_userdata_set(request: Request):
    body = await request.json()
    key = (body.get("key") or "").strip()
    if not key:
        return JSONResponse({"ok": False, "error": "缺少 key"}, status_code=400)
    value = body.get("value")
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    userdata_mod.set(body.get("userId"), key, value)
    return JSONResponse({"ok": True})


@app.delete("/api/userdata")
async def api_userdata_delete(userId: Optional[str] = None, key: Optional[str] = None):
    removed = userdata_mod.delete(userId, key or "")
    return JSONResponse({"ok": removed, "removed": removed})


@app.post("/asr")
async def evaluate_asr(request: Request):
    try:
        audio_bytes = await request.body()
        if len(audio_bytes) > 10 * 1024 * 1024:
            return JSONResponse({"result": "文件过大"}, status_code=413)
        if not audio_bytes:
            return JSONResponse({"result": ""})
        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(None, asr_engine.speech_to_text, audio_bytes)
        return JSONResponse({"result": text})
    except Exception as e:
        return JSONResponse({"result": f"识别错误:{str(e)}"})


@app.post("/api/avatar/upload")
async def upload_avatar(
    file: UploadFile = File(...),
    slot: int = Form(default=0),
):
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
    if file.content_type not in allowed_types:
        return JSONResponse({"error": "仅支持 PNG/JPG/WebP 图片"}, status_code=400)

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        return JSONResponse({"error": "图片不能超过 10MB"}, status_code=400)

    ext = "png" if "png" in (file.content_type or "") else "jpg"

    if slot in (1, 2, 3):
        avatar_filenames = {1: "avatar-xiaoli", 2: "avatar-laowang", 3: "avatar-xiaoming"}
        role_names = {1: "girl", 2: "elderly", 3: "boy"}
        fname = f"{avatar_filenames[slot]}.{ext}"
        save_path = os.path.join(_PUBLIC_DIR, fname)
        flashhead_adapter.AVATAR_PORTRAITS[slot] = save_path
    else:
        import hashlib
        file_hash = hashlib.md5(content).hexdigest()[:8]
        fname = f"custom_{file_hash}.{ext}"
        save_path = os.path.join(_CUSTOM_AVATAR_DIR, fname)
        flashhead_adapter.AVATAR_PORTRAITS[CUSTOM_AVATAR_ID] = save_path
        slot = None

    with open(save_path, "wb") as f:
        f.write(content)

    flashhead_adapter.reset_avatar_cache()

    url = f"/static/custom_avatars/{os.path.basename(save_path)}" if slot is None else f"/static/{fname}"

    return JSONResponse({
        "status": "ok",
        "url": url,
        "slot": slot,
        "filename": fname,
    })


@app.get("/api/dialects")
async def get_dialects():
    return JSONResponse({"dialects": [{"id": k, "label": v} for k, v in DIALECTS.items()]})


@app.get("/api/idle-video/playlist")
async def get_idle_video_playlist(role: str = "girl"):
    allowed_roles = {"girl", "elderly", "boy", "custom"}
    if role not in allowed_roles:
        return JSONResponse({"error": "无效角色"}, status_code=400)
    _pub = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
    urls = [f"/static/idle_{role}_{i}.mp4" for i in range(20)
            if os.path.isfile(os.path.join(_pub, f"idle_{role}_{i}.mp4"))]
    if not urls:
        old = os.path.join(_pub, f"idle_{role}.mp4")
        if os.path.isfile(old):
            urls = [f"/static/idle_{role}.mp4"]
    return JSONResponse({"urls": urls})


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    print("客户端已连接")

    send_lock = asyncio.Lock()  # 每连接独立锁，避免跨连接串行
    tasks = set()
    current_chat_task = None
    current_response_id = 0
    active_response_state = None

    current_emotion = "neutral"
    current_session_id = "default"
    current_avatar_id = 1
    current_dialect = "mandarin"
    current_user_name = ""
    current_user_id = ""
    current_city = ""
    last_emotion_time = 0
    emotion_busy = False
    session_risks: Dict[str, crisis_mod.SessionRiskState] = {}

    def get_session_risk() -> crisis_mod.SessionRiskState:
        if current_session_id not in session_risks:
            session_risks[current_session_id] = crisis_mod.SessionRiskState()
        return session_risks[current_session_id]

    def is_current_response(response_id: int) -> bool:
        return response_id == current_response_id

    async def start_chat_task(user_text: str, preset_reply: str = None, crisis_mode: bool = False):
        nonlocal current_chat_task, current_response_id, active_response_state

        previous_state = active_response_state
        had_active_task = current_chat_task and not current_chat_task.done()

        if had_active_task or (previous_state and not previous_state.completed):
            if previous_state:
                previous_state.interrupted = True
            current_response_id = next(response_id_counter)
            await send_stop_output(websocket, current_response_id, reason="barge_in", lock=send_lock)
            if current_chat_task and not current_chat_task.done():
                current_chat_task.cancel()
        else:
            current_response_id = next(response_id_counter)

        current_state = ResponseState(
            response_id=current_response_id,
            session_id=current_session_id,
            user_text=user_text,
        )
        active_response_state = current_state

        current_chat_task = asyncio.create_task(
            process_user_message(
                websocket, user_text, current_emotion, current_session_id,
                current_avatar_id, current_state, is_current_response,
                preset_reply=preset_reply,
                dialect=current_dialect,
                lock=send_lock,
                user_name=current_user_name,
                user_id=current_user_id,
                city=current_city,
                crisis_mode=crisis_mode,
            )
        )
        tasks.add(current_chat_task)
        current_chat_task.add_done_callback(tasks.discard)
        return current_state

    async def handle_user_text(user_text: str):
        nonlocal current_user_name
        previous_state = active_response_state
        had_active_task = current_chat_task and not current_chat_task.done()
        preset_reply = None
        session_risk = get_session_risk()

        signal_type = crisis_mod.detect_signal(user_text)
        if signal_type:
            if signal_type == "direct_high":
                risk = {"level": "high", "score": 0.95, "reason": "命中具体自杀方式词，直接判定"}
            else:
                try:
                    _, ctx_messages = get_session_messages(current_session_id)
                    risk = await asyncio.wait_for(
                        crisis_mod.classify_crisis_risk(
                            user_text, list(ctx_messages), signal_type=signal_type
                        ),
                        timeout=8.0,
                    )
                except asyncio.TimeoutError:
                    if signal_type in ("hard", "classifier"):
                        risk = {"level": "medium", "score": 0.5, "reason": "精判超时，风险信号保守判定"}
                    else:
                        risk = {"level": "none", "score": 0.0, "reason": "精判超时，间接信号降级"}

            level = risk["level"]
            if level != "none":
                session_risk.record(level, signal_type=signal_type)
                crisis_mod.log_crisis_event(
                    user_id=current_user_id,
                    session_id=current_session_id,
                    user_text=user_text,
                    level=level,
                    score=risk["score"],
                    reason=risk["reason"],
                    action="detect",
                    signal_type=signal_type,
                )
                print(f"[crisis] signal={signal_type} level={level} score={risk['score']:.2f} reason={risk['reason']!r}")

                if session_risk.needs_full_alert:
                    session_risk.mark_alerted()
                    contact_action = build_contact_action(current_user_id, "紧急联系家属", action="call")
                    await safe_send(websocket, {
                        "type": "crisis_alert",
                        "level": level,
                        "hotlines": crisis_mod.CRISIS_HOTLINES,
                        "contactAction": contact_action,
                    }, send_lock)
                    crisis_mod.log_crisis_event(
                        user_id=current_user_id,
                        session_id=current_session_id,
                        user_text=user_text,
                        level=level,
                        score=risk["score"],
                        reason=risk["reason"],
                        action="alert_sent",
                        signal_type=signal_type,
                    )
                    preset_reply = crisis_mod.build_crisis_alert_reply()

        # 提醒意图优先
        parsed = reminders_mod.try_parse_reminder(user_text)
        if parsed:
            when_dt, content = parsed
            reminder = reminders_mod.add(when_dt, content)
            await safe_send(websocket, {
                "type": "reminder_added",
                "reminder": reminder.to_dict(),
            }, send_lock)
            ack = reminders_mod.build_ack_text(
                reminders_mod.format_when(reminder.when_ts),
                content,
                current_user_name,
            )
            await start_chat_task(user_text, preset_reply=ack, crisis_mode=session_risk.caring_mode)
            return

        if had_active_task and previous_state:
            predicted_response_id = current_response_id + 1
            await send_stop_output(websocket, predicted_response_id, reason="barge_in_detected", lock=send_lock)
            interrupt_type = await classify_interrupt_intent(
                user_text,
                previous_state.full_text,
                "",
            )
            await safe_send(websocket, {
                "type": "interrupt_classified",
                "intent": interrupt_type,
                "responseId": predicted_response_id,
            }, send_lock)
            if interrupt_type == "ack":
                preset_reply = "嗯，我听到了。刚才的意思是，" + (previous_state.full_text or "我们可以接着慢慢聊。")
            elif interrupt_type == "supplement":
                preset_reply = await build_followup_reply(
                    user_text, current_emotion,
                    previous_state.full_text,
                    "",
                )

        await start_chat_task(user_text, preset_reply=preset_reply, crisis_mode=session_risk.caring_mode)

    async def reminder_scanner():
        """每 5 秒扫一次提醒，到期就推前端 + 让数字人主动播报"""
        try:
            while True:
                await asyncio.sleep(5)
                due = reminders_mod.pop_due()
                for r in due:
                    await safe_send(websocket, {
                        "type": "reminder_fired",
                        "reminder": r.to_dict(),
                    }, send_lock)
                    fire_text = reminders_mod.build_fire_text(r.content, current_user_name)
                    await start_chat_task(
                        f"[reminder:{r.id}]",
                        preset_reply=fire_text,
                        crisis_mode=get_session_risk().caring_mode,
                    )

                # 「我的提醒」管理页里用户维护的可重复提醒（按当前登录用户调度）
                if current_user_id:
                    for item in reminder_service_mod.pop_due(current_user_id):
                        await safe_send(websocket, {
                            "type": "reminder_service_fired",
                            "item": item,
                        }, send_lock)
                        fire_text = reminder_service_mod.build_fire_text(
                            item.get("name", ""), item.get("type", ""), current_user_name
                        )
                        await start_chat_task(
                            f"[reminder_service:{item['id']}]",
                            preset_reply=fire_text,
                            crisis_mode=get_session_risk().caring_mode,
                        )
        except asyncio.CancelledError:
            return

    scanner_task = asyncio.create_task(reminder_scanner())
    tasks.add(scanner_task)
    scanner_task.add_done_callback(tasks.discard)

    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                payload = json.loads(data_str)
            except Exception:
                continue

            msg_type = payload.get("type")

            if msg_type == "ping":
                await safe_send(websocket, {"type": "pong"}, send_lock)
                continue

            if msg_type == "barge_in_start":
                if current_chat_task and not current_chat_task.done():
                    if active_response_state:
                        active_response_state.interrupted = True
                    current_response_id = next(response_id_counter)
                    await send_stop_output(websocket, current_response_id, reason="barge_in_start", lock=send_lock)
                    current_chat_task.cancel()
                continue

            if msg_type == "delete_user":
                uid = (payload.get("userId") or "").strip()
                if uid:
                    await delete_profile(uid)
                continue

            if msg_type in ["init", "new_session", "switch_session"]:
                current_session_id = payload.get("sessionId", "default")
                incoming_uid = (payload.get("userId") or "").strip()
                if incoming_uid:
                    current_user_id = incoming_uid
                incoming_name = (payload.get("userName") or "").strip()
                if incoming_name:
                    current_user_name = incoming_name
                incoming_city = (payload.get("city") or "").strip()
                if incoming_city:
                    current_city = incoming_city
                if msg_type == "init":
                    current_avatar_id = payload.get("avatarId", 1)
                    current_dialect = payload.get("dialect", "mandarin")
                    await safe_send(websocket, {
                        "type": "reminder_list",
                        "reminders": [r.to_dict() for r in reminders_mod.list_active()],
                    }, send_lock)
                continue

            if msg_type == "location":
                incoming_city = (payload.get("city") or "").strip()
                if incoming_city:
                    current_city = incoming_city
                    print(f"[location] 城市更新: {current_city}")
                continue

            if msg_type == "set_dialect":
                new_dialect = payload.get("dialect", "mandarin")
                if new_dialect in DIALECTS:
                    current_dialect = new_dialect
                    await safe_send(websocket, {"type": "dialect_changed", "dialect": current_dialect}, send_lock)
                continue

            if msg_type == "frame":
                now = time.time()
                if now - last_emotion_time < EMOTION_INTERVAL:
                    continue
                if emotion_busy:
                    continue
                last_emotion_time = now
                emotion_busy = True
                try:
                    img_b64 = payload.get("data", "")
                    if img_b64.startswith("data:image"):
                        img_b64 = img_b64.split(",")[1]
                    img_bytes = base64.b64decode(img_b64)
                    loop = asyncio.get_running_loop()
                    current_emotion = await loop.run_in_executor(None, get_face_emotion, img_bytes)
                except Exception as e:
                    print("情绪识别失败:", e)
                finally:
                    emotion_busy = False
                continue

            if msg_type in ["message", "text", "barge_in_commit"]:
                user_text = payload.get("content", payload.get("data", "")).strip()
                incoming_name = (payload.get("userName") or "").strip()
                if incoming_name:
                    current_user_name = incoming_name
                incoming_uid = (payload.get("userId") or "").strip()
                if incoming_uid:
                    current_user_id = incoming_uid
                incoming_city = (payload.get("city") or "").strip()
                if incoming_city:
                    current_city = incoming_city
                if user_text:
                    await handle_user_text(user_text)
                continue

            if msg_type == "audio":
                try:
                    if current_chat_task and not current_chat_task.done():
                        if active_response_state:
                            active_response_state.interrupted = True
                        current_response_id = next(response_id_counter)
                        current_chat_task.cancel()
                        await send_stop_output(websocket, current_response_id, reason="audio_barge_in", lock=send_lock)
                    audio_data = payload.get("data")
                    if isinstance(audio_data, list):
                        audio_bytes = pcm_list_to_wav_bytes(audio_data)
                    elif isinstance(audio_data, str) and audio_data.startswith("data:audio"):
                        audio_b64 = audio_data.split(",")[1]
                        audio_bytes = base64.b64decode(audio_b64)
                    else:
                        continue
                    loop = asyncio.get_running_loop()
                    user_text = await loop.run_in_executor(None, asr_engine.speech_to_text, audio_bytes)
                    if user_text:
                        await handle_user_text(user_text)
                except Exception as e:
                    print("语音识别失败:", e)
                    await safe_send(websocket, {"type": "error", "message": "语音识别失败"}, send_lock)
                    await safe_send(websocket, {"type": "turn_end", "responseId": current_response_id}, send_lock)
                continue

    except WebSocketDisconnect:
        print("客户端主动断开")
    except RuntimeError as e:
        print("连接关闭:", e)
    except Exception as e:
        print("WebSocket总异常:", e)
        traceback.print_exc()
    finally:
        for t in tasks.copy():
            t.cancel()
        print("连接结束")


@app.get("/{asset_name}")
async def get_legacy_public_asset(asset_name: str):
    """Serve root-relative assets used by the 2a7da21 frontend."""
    allowed_exts = {".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webp", ".ico"}
    safe_name = os.path.basename(asset_name)
    if safe_name != asset_name:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in allowed_exts:
        return JSONResponse({"detail": "Not found"}, status_code=404)
    path = os.path.join(_PUBLIC_DIR, safe_name)
    if not os.path.isfile(path):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    return FileResponse(path)


if __name__ == "__main__":
    import uvicorn
    _host = os.environ.get("SERVER_HOST", "0.0.0.0")
    _port = int(os.environ.get("SERVER_PORT", "8000"))
    uvicorn.run(app, host=_host, port=_port)



