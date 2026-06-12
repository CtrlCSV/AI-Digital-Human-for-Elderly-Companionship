"""
通用的「按用户分隔」键值存储 —— JSON 文件持久化。

前端原本把健康档案、资料设置、家人通知开关、提醒记录、会话、陪伴时长统计等
都塞在 localStorage 里。这里给它们一个统一的后端落点：以 (user_id, key) 为索引，
value 原样存字符串（前端存什么就是什么，通常是 JSON.stringify 后的串）。

这样后端不关心每个域的结构，前端可以无损地把任意 localStorage 键镜像上来，
登录时再整体拉回，实现多设备同步。

注意：联系人和「可重复提醒」因为后端有逻辑依赖（危机告警 / 定时播报），
不走这里，分别由 contacts.py 和 reminder_service.py 负责。
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

DATA_FILE = Path(__file__).resolve().parent / "user_data.json"
DEFAULT_USER_ID = "default"

_lock = threading.Lock()


def _normalize_user_id(user_id: Optional[str]) -> str:
    return (user_id or DEFAULT_USER_ID).strip() or DEFAULT_USER_ID


def _load_store() -> Dict[str, Dict[str, str]]:
    if not DATA_FILE.exists():
        return {}
    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"[userdata] load failed: {e}")
        return {}


def _save_store(store: Dict[str, Dict[str, str]]) -> None:
    try:
        tmp = DATA_FILE.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        tmp.replace(DATA_FILE)
    except Exception as e:
        print(f"[userdata] save failed: {e}")


def get_all(user_id: Optional[str]) -> Dict[str, str]:
    """返回某用户的所有键值（value 为原始字符串）。"""
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        return dict(store.get(uid, {}))


def get(user_id: Optional[str], key: str, default: Any = None) -> Any:
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        return store.get(uid, {}).get(key, default)


def set(user_id: Optional[str], key: str, value: str) -> None:
    """写入一个键。value 原样存（前端通常已 JSON.stringify）。"""
    if not key:
        return
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        bucket = store.setdefault(uid, {})
        bucket[key] = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        _save_store(store)


def set_many(user_id: Optional[str], items: Dict[str, str]) -> None:
    if not items:
        return
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        bucket = store.setdefault(uid, {})
        for key, value in items.items():
            if not key:
                continue
            bucket[key] = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        _save_store(store)


def delete(user_id: Optional[str], key: str) -> bool:
    uid = _normalize_user_id(user_id)
    with _lock:
        store = _load_store()
        bucket = store.get(uid)
        if bucket and key in bucket:
            del bucket[key]
            _save_store(store)
            return True
        return False
