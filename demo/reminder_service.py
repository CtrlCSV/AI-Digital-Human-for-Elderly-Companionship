"""
「我的提醒」服务 —— 按用户持久化的可重复提醒 + 简单调度。

与 reminders.py 的区别：
  - reminders.py：聊天里自然语言解析出来的一次性提醒，内存存储，全局。
  - reminder_service.py：提醒管理页里用户手动维护的条目，JSON 持久化、按用户分隔、
    支持「每天 HH:MM / 每 N 小时 / 工作日」等重复规则，由 WS 扫描器到点让数字人播报。

条目对前端暴露的字段：id / name / type / time / repeat / enabled
内部调度字段（不返回给前端的渲染逻辑、但会一起持久化）：
  created_at / last_fired_date / last_fired_ts
"""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_FILE = Path(__file__).resolve().parent / "reminder_service.json"
DEFAULT_USER_ID = "default"

_lock = threading.Lock()

_PUBLIC_FIELDS = ("id", "name", "type", "time", "repeat", "enabled")


def _normalize_user_id(user_id: Optional[str]) -> str:
    return (user_id or DEFAULT_USER_ID).strip() or DEFAULT_USER_ID


def _load_store() -> Dict[str, List[Dict[str, Any]]]:
    if not DATA_FILE.exists():
        return {}
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"[reminder_service] load failed: {e}")
        return {}


def _save_store(store: Dict[str, List[Dict[str, Any]]]) -> None:
    try:
        tmp = DATA_FILE.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        tmp.replace(DATA_FILE)
    except Exception as e:
        print(f"[reminder_service] save failed: {e}")


def _public(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": item.get("name", ""),
        "type": item.get("type", "other"),
        "time": item.get("time", ""),
        "repeat": item.get("repeat", ""),
        "enabled": bool(item.get("enabled", True)),
    }


def _new_item(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(data.get("id") or uuid.uuid4().hex[:8]),
        "name": str(data.get("name") or "").strip(),
        "type": str(data.get("type") or "other").strip() or "other",
        "time": str(data.get("time") or "").strip(),
        "repeat": str(data.get("repeat") or "").strip(),
        "enabled": bool(data.get("enabled", True)),
        "created_at": float(data.get("created_at") or time.time()),
        "last_fired_date": data.get("last_fired_date") or "",
        "last_fired_ts": float(data.get("last_fired_ts") or 0.0),
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────
def list_items(user_id: Optional[str]) -> List[Dict[str, Any]]:
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        return [_public(it) for it in store.get(uid, [])]


def add(user_id: Optional[str], data: Dict[str, Any]) -> Dict[str, Any]:
    uid = _normalize_user_id(user_id)
    item = _new_item(data)
    if not item["name"]:
        raise ValueError("提醒名称不能为空")
    with _lock:
        store = _load_store()
        store.setdefault(uid, []).insert(0, item)
        _save_store(store)
    return _public(item)


def update(user_id: Optional[str], item_id: str, changes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        items = store.get(uid, [])
        for idx, it in enumerate(items):
            if str(it.get("id")) != str(item_id):
                continue
            for key in ("name", "type", "time", "repeat"):
                if key in changes and changes[key] is not None:
                    it[key] = str(changes[key]).strip()
            if "enabled" in changes and changes["enabled"] is not None:
                it["enabled"] = bool(changes["enabled"])
            # 改了时间/规则就重置已触发标记，让新规则重新生效
            if any(k in changes for k in ("time", "repeat", "enabled")):
                it["last_fired_date"] = ""
                it["last_fired_ts"] = 0.0
            items[idx] = it
            store[uid] = items
            _save_store(store)
            return _public(it)
    return None


def remove(user_id: Optional[str], item_id: str) -> bool:
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        items = store.get(uid, [])
        new_items = [it for it in items if str(it.get("id")) != str(item_id)]
        if len(new_items) == len(items):
            return False
        store[uid] = new_items
        _save_store(store)
        return True


def replace_all(user_id: Optional[str], items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """整批覆盖（前端首次迁移本地数据时用）。保留已存在条目的调度状态。"""
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        old_by_id = {str(it.get("id")): it for it in store.get(uid, [])}
        merged = []
        for data in (items or []):
            it = _new_item(data)
            old = old_by_id.get(it["id"])
            if old:
                it["created_at"] = old.get("created_at", it["created_at"])
                if it["time"] == old.get("time") and it["repeat"] == old.get("repeat"):
                    it["last_fired_date"] = old.get("last_fired_date", "")
                    it["last_fired_ts"] = float(old.get("last_fired_ts") or 0.0)
            merged.append(it)
        store[uid] = merged
        _save_store(store)
        return [_public(it) for it in merged]


# ── 调度 ──────────────────────────────────────────────────────────────────────
_HHMM_RE = re.compile(r"(\d{1,2})\s*[:：]\s*(\d{2})")
_INTERVAL_RE = re.compile(r"每\s*(\d+)\s*(?:个)?\s*小时")
_WEEKDAY_KEYS = ("每天", "每日", "天天")


def _parse_hhmm(text: str):
    m = _HHMM_RE.search(text or "")
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if 0 <= h <= 23 and 0 <= mi <= 59:
        return h, mi
    return None


def _parse_interval_hours(text: str) -> Optional[int]:
    m = _INTERVAL_RE.search(text or "")
    if m:
        n = int(m.group(1))
        return n if n > 0 else None
    return None


def _weekday_ok(repeat: str, now: datetime) -> bool:
    repeat = repeat or ""
    wd = now.weekday()  # 0=周一 .. 6=周日
    if "工作日" in repeat:
        return wd <= 4
    if "周末" in repeat:
        return wd >= 5
    return True


def pop_due(user_id: Optional[str], now_ts: Optional[float] = None) -> List[Dict[str, Any]]:
    """取出此刻应触发的提醒，更新调度状态后返回（公开字段）。"""
    uid = _normalize_user_id(user_id)
    now_ts = time.time() if now_ts is None else now_ts
    now = datetime.fromtimestamp(now_ts)
    today = now.strftime("%Y-%m-%d")
    due: List[Dict[str, Any]] = []
    with _lock:
        store = _load_store()
        items = store.get(uid, [])
        changed = False
        for it in items:
            if not it.get("enabled", True):
                continue
            time_str = it.get("time", "")
            repeat_str = it.get("repeat", "")
            combined = f"{time_str} {repeat_str}"

            interval = _parse_interval_hours(combined)
            if interval:
                last_ts = float(it.get("last_fired_ts") or 0.0) or float(it.get("created_at") or now_ts)
                if now_ts - last_ts >= interval * 3600:
                    it["last_fired_ts"] = now_ts
                    changed = True
                    due.append(_public(it))
                continue

            hhmm = _parse_hhmm(time_str)
            if hhmm and _weekday_ok(repeat_str, now):
                scheduled = now.replace(hour=hhmm[0], minute=hhmm[1], second=0, microsecond=0)
                if now >= scheduled and it.get("last_fired_date") != today:
                    it["last_fired_date"] = today
                    it["last_fired_ts"] = now_ts
                    changed = True
                    due.append(_public(it))
        if changed:
            store[uid] = items
            _save_store(store)
    return due


def build_fire_text(name: str, item_type: str = "", user_name: str = "") -> str:
    addr = f"{user_name}，" if user_name else ""
    type_hint = {
        "medicine": "记得按时吃药哦",
        "water": "起来喝口水吧",
        "activity": "该活动活动了",
    }.get(item_type, "记得放在心上哦")
    return f"{addr}到时间啦，您设置的提醒是「{name}」，{type_hint}。"
