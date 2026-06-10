// ============================================================
// script.js v10
// ============================================================

const AVATARS = [
  null,
  { id: 1, name: '小丽', desc: '温柔可爱，陪你聊天～', skinClass: 'avatar-friend1', welcome: '你好呀～我是小丽，很高兴认识你！', imagePath: '/static/avatar-xiaoli.png?v=3' },
  { id: 2, name: '老王', desc: '风趣幽默，随时唠嗑～', skinClass: 'avatar-friend2', welcome: '你好，我是老王，咱们随便聊！',     imagePath: '/static/avatar-laowang.png?v=3' },
  { id: 3, name: '小明', desc: '年轻伙伴，活力陪聊～', skinClass: 'avatar-friend3', welcome: '你好，我是小明，和你聊聊生活、兴趣、好心情！', imagePath: '/static/avatar-xiaoming.png?v=3' },
];

const STATUS = {
  online:    { key: 'online',        text: '在线' },
  thinking:  { key: 'thinking',      text: '思考中...' },
  speaking:  { key: 'speaking',      text: '正在说话' },
  playAudio: { key: 'speaking',      text: '播放语音' },
  listening: { key: 'listening',     text: '正在听您说话...' },
  listenSay: { key: 'listening',     text: '我在听，您说' },
  offline:   { key: 'offline',       text: '离线' },
  offlineD:  { key: 'offline',       text: '连接断开' },
  reconnect: { key: 'reconnecting',  text: '重连中...' },
  genReply:  { key: 'thinking',      text: '正在生成回复...' },
};

const MAX_RECONNECT = 5;

const DIALECT_LABELS = {
  mandarin:  '普通话',
  cantonese: '粤语',
  taiwanese: '台湾腔',
};

const state = {
  avatar: null, sessionId: null, sessions: [], userName: '',
  userId: '',
  ws: null, wsConnected: false, reconnects: 0,
  recording: false, recognition: null,
  responseId: null, botChunks: [],
  currentChunkEl: null,
  thinkingEl: null, pressTimer: null, isLongPress: false,
  bargeInActive: false,
  customAvatarFile: null,
  dialect: 'mandarin',
  reminders: [],
};

const dom = {};
function cacheDom() {
  ['selectPage', 'chatPage', 'botName', 'botDesc', 'messageInput',
    'messagesContainer', 'avatarContainer', 'sessionList', 'sendBtn',
    'timeGreeting', 'userDisplayName'].forEach(id => {
      dom[id] = document.getElementById(id);
    });
}

// ---------------------- utils ----------------------
function scrollToBottom() {
  const area = document.querySelector('.chat-history-area');
  if (area) setTimeout(() => { area.scrollTop = area.scrollHeight; }, 10);
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast-message ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOutDown 0.3s ease'; setTimeout(() => t.remove(), 300); }, 3000);
}

function base64ToBlob(b64, mime) {
  const raw = atob(b64), arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function setStatus(s) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = s.text;
  const light = document.getElementById('breathingLight');
  if (!light) return;
  light.classList.remove('active', 'listening', 'thinking', 'speaking');
  if (['listening', 'thinking', 'speaking'].includes(s.key)) light.classList.add('active', s.key);
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 9)   return '早上好';
  if (h >= 9 && h < 12)  return '上午好';
  if (h >= 12 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 22) return '晚上好';
  return '夜深了';
}

function getTimePrefix() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12)  return '早上好';
  if (h >= 12 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  return '晚上好';
}

function personalGreeting(base) {
  const name = state.userName ? `，${state.userName}` : '';
  return `${getTimePrefix()}${name}！${base}`;
}

// ---------------------- AudioPlayer（纯音频降级）----------------------
const AudioPlayer = {
  el: new Audio(),
  queue: [],
  playing: false,
  currentUrl: null,
  responseId: null,

  enqueue(base64Audio, responseId, seq = 0) {
    try {
      const blob = base64ToBlob(base64Audio, 'audio/mpeg');
      const url = URL.createObjectURL(blob);
      this.queue.push({ url, responseId, seq: Number(seq) || 0 });
      this.queue.sort((a, b) => a.seq - b.seq);
      this.playNext();
    } catch (e) { showToast('音频入队失败', 'warning'); }
  },

  playNext() {
    if (this.playing) return;
    const next = this.queue.shift();
    if (!next) { this.responseId = null; setStatus(STATUS.online); return; }
    this.playing = true;
    this.responseId = next.responseId;
    this.currentUrl = next.url;
    this.el.pause();
    this.el.currentTime = 0;
    this.el.src = next.url;
    this.el.onended = () => this.finish();
    this.el.onerror = () => this.finish();
    this.el.play().catch(() => { showToast('浏览器阻止了音频自动播放', 'warning'); this.finish(); });
  },

  finish() {
    const url = this.currentUrl;
    this.el.onended = null;
    this.el.onerror = null;
    this.el.removeAttribute('src');
    this.el.load();
    if (url) URL.revokeObjectURL(url);
    this.currentUrl = null;
    this.playing = false;
    setTimeout(() => this.playNext(), 40);
  },

  reset() {
    this.el.pause();
    this.el.currentTime = 0;
    this.el.removeAttribute('src');
    this.el.load();
    this.el.onended = null;
    this.el.onerror = null;
    this.queue.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); });
    this.queue = [];
    this.playing = false;
    this.responseId = null;
    if (this.currentUrl) { URL.revokeObjectURL(this.currentUrl); this.currentUrl = null; }
  },
};

// ---------------------- VideoPlayer（FlashHead MP4）----------------------
const VideoPlayer = {
  elA: null,
  elB: null,
  idleElA: null,
  idleElB: null,
  _idleActiveEl: null,
  _idleStandbyEl: null,
  activeEl: null,
  standbyEl: null,
  queue: [],
  playing: false,
  responseId: null,
  containerEl: null,
  posterEl: null,
  _activeUrl: null,
  _standbyUrl: null,
  _idleUrl: null,
  _idlePlaylist: [],
  _idleIndex: 0,
  _turnActive: false,

  init(container, posterSrc) {
    this.containerEl = container;
    this._idleUrl = null;

    this.posterEl = document.createElement('img');
    this.posterEl.className = 'avatar-poster';
    this.posterEl.alt = '';
    if (posterSrc) this.posterEl.src = posterSrc;
    container.appendChild(this.posterEl);

    this.idleElA = this._makeIdleEl();
    this.idleElB = this._makeIdleEl();
    this.idleElA.addEventListener('ended', () => this._advanceIdlePlaylist());
    this.idleElB.addEventListener('ended', () => this._advanceIdlePlaylist());
    container.appendChild(this.idleElA);
    container.appendChild(this.idleElB);
    this._idleActiveEl = this.idleElA;
    this._idleStandbyEl = this.idleElB;

    this.elA = this._makeVideoEl();
    this.elB = this._makeVideoEl();
    container.appendChild(this.elA);
    container.appendChild(this.elB);

    this.activeEl = this.elA;
    this.standbyEl = this.elB;
  },

  _makeIdleEl() {
    const el = document.createElement('video');
    el.playsInline = true;
    el.muted = true;
    el.loop = true;
    el.style.cssText = 'width:100%;height:100%;object-fit:contain;position:absolute;inset:0;z-index:2;display:none;border-radius:inherit;background:transparent;';
    return el;
  },

  _makeVideoEl() {
    const el = document.createElement('video');
    el.playsInline = true;
    el.muted = false;
    el.style.cssText = 'width:100%;height:100%;object-fit:contain;position:absolute;inset:0;z-index:3;display:none;opacity:0;transition:opacity 100ms linear;border-radius:inherit;background:transparent;';
    return el;
  },

  setPoster(src) {
    if (this.posterEl && src) this.posterEl.src = src;
  },

  setIdleVideo(url) {
    this.setIdleVideos([url]);
  },

  setIdleVideos(urls) {
    this._idlePlaylist = urls || [];
    this._idleIndex = 0;
    this._idleUrl = this._idlePlaylist[0] || null;
    if (!this._idlePlaylist.length) return;
    this._idleActiveEl = this.idleElA;
    this._idleStandbyEl = this.idleElB;
    this._idleActiveEl.src = this._idlePlaylist[0];
    this._idleActiveEl.load();
    this._preloadIdleStandby();
    if (!this.playing && !this._turnActive) this._showIdle();
  },

  _preloadIdleStandby() {
    if (this._idlePlaylist.length <= 1) return;
    const nextIdx = (this._idleIndex + 1) % this._idlePlaylist.length;
    const nextUrl = this._idlePlaylist[nextIdx];
    if (this._idleStandbyEl.dataset.preloadSrc === nextUrl) return;
    this._idleStandbyEl.dataset.preloadSrc = nextUrl;
    this._idleStandbyEl.src = nextUrl;
    this._idleStandbyEl.load();
  },

  _advanceIdlePlaylist() {
    if (!this._idlePlaylist.length) return;
    if (this._idlePlaylist.length === 1) {
      this._idleActiveEl.currentTime = 0;
      this._idleActiveEl.play().catch(() => {});
      return;
    }

    this._idleIndex = (this._idleIndex + 1) % this._idlePlaylist.length;
    const next = this._idleStandbyEl;
    const curr = this._idleActiveEl;

    // 显示已预加载的下一段，等第一帧就绪后再隐藏当前段
    next.style.display = 'block';
    next.play().then(() => {
      curr.style.display = 'none';
      curr.pause();
      curr.removeAttribute('src');
      curr.load();
      curr.dataset.preloadSrc = '';
      this._preloadIdleStandby();
    }).catch(() => {
      curr.style.display = 'none';
      curr.pause();
      this._preloadIdleStandby();
    });

    this._idleActiveEl = next;
    this._idleStandbyEl = curr;
  },

  _showIdle() {
    // 先把回答视频淡出（已隐藏的跳过）
    [this.elA, this.elB].forEach(el => {
      if (!el || el.style.display === 'none') return;
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; el.pause(); }, 120);
    });
    if (this._idleUrl && this._idleActiveEl) {
      if (this.posterEl) this.posterEl.style.display = 'none';
      this._idleActiveEl.style.display = 'block';
      if (this._idleActiveEl.paused) {
        this._idleActiveEl.play().catch(() => {
          this._idleActiveEl.style.display = 'none';
          if (this.posterEl) this.posterEl.style.display = '';
        });
      }
    } else {
      if (this.posterEl) this.posterEl.style.display = '';
    }
  },

  _hideIdle() {
    // 待机视频在后台持续运行；回答视频(z-index:3)叠在上方自然遮住它
  },

  beginTurn() {
    this._turnActive = true;
    // 保持待机视频播放，等回答视频就绪后自然衔接
  },

  endTurn() {
    this._turnActive = false;
    if (!this.playing && this.queue.length === 0) {
      this._showIdle();
    }
  },

  _showPoster() {
    [this.idleElA, this.idleElB].forEach(el => {
      if (!el) return;
      el.style.display = 'none';
      el.pause();
    });
    if (this.posterEl) this.posterEl.style.display = '';
    [this.elA, this.elB].forEach(el => {
      if (!el) return;
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; el.pause(); }, 100);
    });
  },

  enqueue(base64Video, responseId, seq) {
    const blob = base64ToBlob(base64Video, 'video/mp4');
    const url = URL.createObjectURL(blob);
    this.queue.push({ url, responseId, seq: Number(seq) || 0 });
    this.queue.sort((a, b) => a.seq - b.seq);
    this._preloadNext();
    if (!this.playing) this._playNext();
  },

  _preloadNext() {
    if (!this.standbyEl || this.queue.length === 0) return;
    const next = this.queue[0];
    if (this._standbyUrl === next.url) return;
    if (this._standbyUrl) {
      try { URL.revokeObjectURL(this._standbyUrl); } catch (_) { }
    }
    this._standbyUrl = next.url;
    this.standbyEl.src = next.url;
    this.standbyEl.load();
  },

  _playNext() {
    const next = this.queue.shift();
    if (!next) {
      this.playing = false;
      if (!this._turnActive) this._showIdle();
      setStatus(STATUS.online);
      return;
    }
    this.playing = true;
    this.responseId = next.responseId;

    if (this.posterEl) this.posterEl.style.display = 'none';
    // 不隐藏待机视频：回答视频(z-index:3)叠加在待机视频(z-index:2)上，形成自然过渡

    const toPlay = this.standbyEl;
    const toHide = this.activeEl;

    if (this._activeUrl && this._activeUrl !== next.url) {
      try { URL.revokeObjectURL(this._activeUrl); } catch (_) { }
    }
    this._activeUrl = next.url;
    if (this._standbyUrl === next.url) this._standbyUrl = null;

    if (toPlay.src !== next.url) toPlay.src = next.url;
    toPlay.style.display = 'block';
    requestAnimationFrame(() => { toPlay.style.opacity = '1'; });
    toPlay.play().catch(e => {
      console.warn('[VideoPlayer] 播放失败:', e);
      this._finish();
    });
    toPlay.onended = () => this._finish();
    toPlay.onerror = () => this._finish();

    toHide.style.opacity = '0';
    setTimeout(() => { toHide.style.display = 'none'; toHide.pause(); }, 100);

    this.activeEl = toPlay;
    this.standbyEl = toHide;
    this._preloadNext();
  },

  _finish() {
    this.activeEl.onended = null;
    this.activeEl.onerror = null;
    this._playNext();
  },

  reset() {
    [this.elA, this.elB].forEach(el => {
      if (!el) return;
      el.pause();
      el.onended = null;
      el.onerror = null;
      el.style.display = 'none';
      el.style.opacity = '0';
      el.src = '';
    });
    this.queue.forEach(item => { try { URL.revokeObjectURL(item.url); } catch (_) { } });
    this.queue = [];
    if (this._activeUrl) { try { URL.revokeObjectURL(this._activeUrl); } catch (_) { } this._activeUrl = null; }
    if (this._standbyUrl) { try { URL.revokeObjectURL(this._standbyUrl); } catch (_) { } this._standbyUrl = null; }
    this.playing = false;
    this._turnActive = false;
    this.responseId = null;
    this._showIdle();
  },
};

// ---------------------- 自定义数字人形象 ----------------------
let _pendingCustomFile = null;

function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  _pendingCustomFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('uploadPreview');
    const img = document.getElementById('uploadPreviewImg');
    img.src = e.target.result;
    preview.style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

async function selectCustomAvatar() {
  if (!_pendingCustomFile) return;
  const formData = new FormData();
  formData.append('file', _pendingCustomFile);
  formData.append('slot', 0);
  try {
    const resp = await fetch('/api/avatar/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (resp.ok) {
      const customAvatar = {
        id: 99,
        name: '自定义',
        desc: '您上传的数字人形象',
        skinClass: 'avatar-custom',
        welcome: '你好，我是您自定义的数字人！',
        imagePath: data.url,
      };
      AVATARS[99] = customAvatar;
      cancelUpload();
      selectAvatar(99);

    } else {
      showToast(`上传失败: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`上传失败: ${e.message}`, 'error');
  }
}

function cancelUpload() {
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('avatarUploadInput').value = '';
  _pendingCustomFile = null;
}


// ---------------------- 待机视频加载 ----------------------
async function tryLoadIdleVideo(avatarId) {
  const roleMap = { 1: 'girl', 2: 'elderly', 3: 'boy', 99: 'custom' };
  const role = roleMap[avatarId];
  if (!role) return;
  const playlistUrl = `/api/idle-video/playlist?role=${role}`;
  try {
    const res = await fetch(playlistUrl);
    const data = await res.json();
    if (data.urls && data.urls.length > 0) {
      const ts = Date.now();
      VideoPlayer.setIdleVideos(data.urls.map(u => u + '?t=' + ts));
    } else {
      pollForIdleVideo(playlistUrl, avatarId);
    }
  } catch (_) {}
}

async function pollForIdleVideo(playlistUrl, forAvatarId = 99, maxWaitMs = 360000) {
  const interval = 8000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    if (state.avatar?.id !== forAvatarId) return;
    try {
      const res = await fetch(playlistUrl + '&t=' + Date.now());
      const data = await res.json();
      if (data.urls && data.urls.length > 0) {
        if (state.avatar?.id !== forAvatarId) return;
        VideoPlayer.setIdleVideos(data.urls.map(u => u + '?t=' + Date.now()));
        return;
      }
    } catch (_) {}
  }
}

// ---------------------- Bot Message Rendering ----------------------
function createBotBubble(responseId, text) {
  if (state.responseId !== responseId) {
    state.responseId = responseId;
    state.botChunks = [];
    state.currentChunkEl = null;
  }
  const div = document.createElement('div');
  div.className = 'message message-bot';
  div.dataset.responseId = String(responseId);
  div.textContent = text;
  dom.messagesContainer.appendChild(div);
  state.currentChunkEl = div;
  state.botChunks.push(text);
  scrollToBottom();
  return div;
}

function getBotFullText() { return state.botChunks.join(''); }

function resetBotBubbleState() {
  state.botChunks = [];
  state.currentChunkEl = null;
}

function showThinking(show) {
  if (show) {
    if (!state.thinkingEl) {
      state.thinkingEl = document.createElement('div');
      state.thinkingEl.className = 'message message-thinking';
      state.thinkingEl.innerHTML = '<span class="thinking-dots">正在思考...</span>';
      dom.messagesContainer.appendChild(state.thinkingEl);
      scrollToBottom();
    }
  } else if (state.thinkingEl) {
    state.thinkingEl.remove();
    state.thinkingEl = null;
  }
}

// ---------------------- 方言选择 ----------------------
function selectDialect(dialect) {
  if (!DIALECT_LABELS[dialect]) return;
  state.dialect = dialect;
  document.querySelectorAll('.dialect-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dialect === dialect);
  });
  wsSend({ type: 'set_dialect', dialect });
  showToast(`已切换到${DIALECT_LABELS[dialect]}`, 'info');
}

// ---------------------- WebSocket ----------------------
function wsSend(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

function handleChunk(d) {
  showThinking(false);
  const rid = d.responseId || state.responseId || `${Date.now()}`;
  const chunkText = (d.text || '').trim();
  if (chunkText && !state.botChunks.includes(chunkText)) {
    createBotBubble(rid, chunkText);
  }
  if (d.video) {
    setStatus(STATUS.speaking);
    VideoPlayer.enqueue(d.video, rid, d.seq);
  } else {
    const audio = d.data || d.audio;
    if (audio) {
      setStatus(STATUS.playAudio);
      AudioPlayer.enqueue(audio, rid, d.seq);
    }
  }
}

const msgHandlers = {
  audio_chunk: handleChunk,
  assistant_chunk: handleChunk,
  assistant_text_delta(d) {
    showThinking(false);
    const rid = d.responseId || state.responseId || `${Date.now()}`;
    const delta = d.delta || d.text || '';
    if (delta) createBotBubble(rid, delta);
  },
  turn_start(d) {
    showThinking(false);
    VideoPlayer.reset();
    VideoPlayer.beginTurn();
    AudioPlayer.reset();
    resetBotBubbleState();
    state.responseId = d.responseId || `${Date.now()}`;
    setStatus(STATUS.genReply);
  },
  stop_output() {
    VideoPlayer.reset();
    AudioPlayer.reset();
    showThinking(false);
    const fullText = getBotFullText();
    if (fullText) addMsgToSession('bot', fullText + '…');
    resetBotBubbleState();
    state.responseId = null;
    setStatus(STATUS.listenSay);
  },
  turn_interrupted(d) {
    VideoPlayer.reset();
    AudioPlayer.reset();
    showThinking(false);
    const spokenText = d.spokenText || getBotFullText();
    if (spokenText) addMsgToSession('bot', spokenText + '…');
    resetBotBubbleState();
    state.responseId = null;
    setStatus(STATUS.listenSay);
  },
  listen_state() { setStatus(STATUS.listenSay); },
  turn_end(d) {
    showThinking(false);
    VideoPlayer.endTurn();
    const fullText = d.fullText || getBotFullText();
    if (fullText) addMsgToSession('bot', fullText);
    resetBotBubbleState();
    state.responseId = null;
    if (!VideoPlayer.playing && !AudioPlayer.playing && AudioPlayer.queue.length === 0) {
      setStatus(STATUS.online);
    }
  },
  error(d) { showToast(d.message || '服务器处理失败', 'error'); },
  dialect_changed(d) { state.dialect = d.dialect; },
  reminder_list(d) {
    state.reminders = Array.isArray(d.reminders) ? d.reminders.slice() : [];
    renderReminders();
  },
  reminder_added(d) {
    if (!d.reminder) return;
    state.reminders = state.reminders.filter(r => r.id !== d.reminder.id);
    state.reminders.push(d.reminder);
    showToast(`已设定提醒：${d.reminder.whenStr || ''} ${d.reminder.content || ''}`, 'info');
    renderReminders();
  },
  reminder_fired(d) {
    if (!d.reminder) return;
    const r = state.reminders.find(x => x.id === d.reminder.id);
    if (r) { r.fired = true; } else { state.reminders.push({ ...d.reminder, fired: true }); }
    renderReminders();
  },
  crisis_alert(d) {
    showCrisisBanner(d.hotlines || [], d.contactAction || null);
  },
};

function handleServerMessage(data) {
  if (!data || !data.type) return;
  const handler = msgHandlers[data.type];
  if (handler) handler(data);
}

function showCrisisBanner(hotlines, contactAction = null) {
  const existing = document.getElementById('crisisBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'crisisBanner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
    'background:#fff1f2', 'border-bottom:2px solid #fca5a5',
    'padding:12px 16px', 'display:flex', 'align-items:flex-start',
    'justify-content:center', 'box-shadow:0 8px 24px rgba(127,29,29,.18)'
  ].join(';');

  const body = document.createElement('div');
  body.style.cssText = 'max-width:960px;width:100%;display:flex;flex-direction:column;gap:8px;color:#7f1d1d;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
  const title = document.createElement('strong');
  title.style.cssText = 'font-size:15px;';
  title.textContent = '请先保证当下安全，可以马上联系身边的人或拨打援助热线';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭';
  close.style.cssText = 'border:1px solid #fecaca;background:#fff;color:#991b1b;border-radius:6px;padding:4px 8px;cursor:pointer;';
  close.onclick = () => banner.remove();
  header.appendChild(title);
  header.appendChild(close);
  body.appendChild(header);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  (hotlines.length ? hotlines : [{ name: '全国统一心理援助热线', phone: '12356', note: '24小时' }]).forEach(h => {
    const chip = document.createElement('a');
    chip.href = `tel:${h.phone}`;
    chip.style.cssText = [
      'display:inline-flex', 'align-items:center', 'gap:4px',
      'background:#fee2e2', 'border:1px solid #fca5a5', 'border-radius:999px',
      'padding:5px 10px', 'font-size:13px', 'color:#7f1d1d',
      'text-decoration:none', 'font-weight:600'
    ].join(';');
    chip.textContent = `${h.name || '心理援助热线'} ${h.phone || ''}${h.note ? ` (${h.note})` : ''}`;
    list.appendChild(chip);
  });
  body.appendChild(list);

  if (contactAction && contactAction.ok && contactAction.phone) {
    const contact = contactAction.contact || {};
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;';
    const label = document.createElement('span');
    label.textContent = '也可以联系家属：';
    const link = document.createElement('a');
    link.href = `tel:${contactAction.phone}`;
    link.style.cssText = 'color:#7f1d1d;font-weight:700;text-decoration:underline;';
    link.textContent = `${contact.displayName || '家属'} ${contactAction.phone}`;
    row.appendChild(label);
    row.appendChild(link);
    body.appendChild(row);
  }

  banner.appendChild(body);
  document.body.appendChild(banner);
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}/ws/chat`);

  state.ws.onopen = () => {
    state.wsConnected = true;
    state.reconnects = 0;
    setStatus(STATUS.online);
    if (state.avatar) {
      wsSend({ type: 'init', avatarId: state.avatar.id, avatarName: state.avatar.name, sessionId: state.sessionId, userName: state.userName, userId: state.userId, dialect: state.dialect, city: localStorage.getItem('warm-companion-city') || '' });
    }
  };
  state.ws.onmessage = (e) => {
    try { handleServerMessage(JSON.parse(e.data)); } catch (_) { showToast('服务器消息解析失败', 'warning'); }
  };
  state.ws.onerror = () => { state.wsConnected = false; setStatus(STATUS.offlineD); };
  state.ws.onclose = () => {
    state.wsConnected = false;
    setStatus(STATUS.offline);
    if (state.reconnects < MAX_RECONNECT) {
      state.reconnects++;
      setStatus(STATUS.reconnect);
      setTimeout(connectWebSocket, Math.min(1000 * Math.pow(2, state.reconnects), 10000));
    } else {
      showToast('无法连接到服务器，请刷新页面重试', 'error');
    }
  };
}

// ---------------------- Camera ----------------------
const Camera = {
  stream: null,
  frameTimer: null,
  _canvas: null,
  _ctx: null,

  async init() {
    const video = document.getElementById('camera');
    if (!video || this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = this.stream;
      video.play().catch(() => { });
      this._canvas = document.createElement('canvas');
      this._canvas.width = 320;
      this._canvas.height = 240;
      this._ctx = this._canvas.getContext('2d');
      this._startFrameLoop(video);
    } catch (err) {
      console.warn('[Camera] 摄像头初始化失败:', err.name, err.message);
      const hint = document.querySelector('.camera-hint');
      if (hint) hint.textContent = '📷 摄像头不可用（' + err.name + '）';
    }
  },

  _startFrameLoop(video) {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = setInterval(() => {
      if (!state.wsConnected || !video.videoWidth || !video.videoHeight) return;
      try {
        this._ctx.drawImage(video, 0, 0, this._canvas.width, this._canvas.height);
        const dataUrl = this._canvas.toDataURL('image/jpeg', 0.6);
        wsSend({ type: 'frame', data: dataUrl });
      } catch (_) { }
    }, 1000);
  },

  stop() {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    const video = document.getElementById('camera');
    if (video) { video.srcObject = null; }
  },
};

// ---------------------- Avatar Video Area ----------------------
function initAvatarVideoArea(avatar) {
  const container = document.getElementById('digitalHumanArea');
  container.innerHTML = `
    <div id="breathingLight" class="breathing-light"></div>
    <div id="avatarStatus" class="avatar-status"><span id="statusText">在线</span></div>
  `;
  VideoPlayer.init(container, avatar ? (avatar.imagePath || '') : '');
}

function destroyAvatarArea() {
  VideoPlayer.reset();
  AudioPlayer.reset();
  const container = document.getElementById('digitalHumanArea');
  if (container) container.innerHTML = '';
}

// ---------------------- Session Manager ----------------------
function loadSessions() {
  try { state.sessions = JSON.parse(localStorage.getItem('chatbot-sessions') || '[]'); }
  catch (_) { state.sessions = []; }
}

function saveSessions() { localStorage.setItem('chatbot-sessions', JSON.stringify(state.sessions)); }

function getAvatarSessions() {
  return state.avatar ? state.sessions.filter(s => s.avatarId === state.avatar.id) : [];
}

function formatPreview(session) {
  if (!session.messages.length) return '空闲会话';
  const last = session.messages[session.messages.length - 1];
  const text = last.text.length > 24 ? last.text.slice(0, 24) + '...' : last.text;
  return `${last.role === 'user' ? '我' : state.avatar.name}：${text}`;
}

function renderSessionList() {
  dom.sessionList.innerHTML = '';
  const sorted = getAvatarSessions().sort((a, b) => b.updated - a.updated);
  const countEl = document.getElementById('sessionCount');
  if (countEl) countEl.textContent = `(${sorted.length})`;
  sorted.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item${session.id === state.sessionId ? ' active' : ''}`;
    item.dataset.sessionId = session.id;
    const summary = document.createElement('div');
    summary.className = 'session-summary';
    summary.textContent = session.title || formatPreview(session);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'session-delete-btn';
    del.dataset.deleteId = session.id;
    del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    del.setAttribute('aria-label', '删除会话');
    item.appendChild(summary);
    item.appendChild(del);
    dom.sessionList.appendChild(item);
  });
}

function initSessionListEvents() {
  dom.sessionList.addEventListener('click', e => {
    const delBtn = e.target.closest('.session-delete-btn');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = delBtn.dataset.deleteId;
      if (id) deleteSession(id);
      return;
    }
    const item = e.target.closest('.session-item');
    if (item && item.dataset.sessionId) selectSession(item.dataset.sessionId);
  });
}

function newConversation() {
  if (!state.avatar) return;
  const count = getAvatarSessions().length;
  state.sessionId = `${Date.now()}`;
  const session = { id: state.sessionId, avatarId: state.avatar.id, title: `会话 ${count + 1}`, messages: [], updated: Date.now() };
  state.sessions.unshift(session);
  saveSessions();
  renderSessionList();
  dom.messagesContainer.innerHTML = '';
  const welcome = personalGreeting(state.avatar.welcome || '你好，我在这里陪你聊天。');
  addHistory('bot', welcome);
  addMsgToSession('bot', welcome);
  setStatus(STATUS.speaking);
  wsSend({ type: 'new_session', sessionId: state.sessionId, userName: state.userName, userId: state.userId });
  closeDrawers();
}

function selectSession(sessionId) {
  state.sessionId = sessionId;
  renderSessionList();
  loadSessionMessages(sessionId);
  wsSend({ type: 'switch_session', sessionId: state.sessionId, userName: state.userName, userId: state.userId });
  closeDrawers();
}

function loadSessionMessages(sessionId) {
  dom.messagesContainer.innerHTML = '';
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  session.messages.forEach(m => addHistory(m.role, m.text));
  scrollToBottom();
}

function addMsgToSession(role, text) {
  if (!state.sessionId) return;
  const session = state.sessions.find(s => s.id === state.sessionId);
  if (!session) return;
  session.messages.push({ role, text, timestamp: Date.now() });
  session.updated = Date.now();
  const titleChanged = session.messages.length === 2 && role === 'user' && !session.title.includes(text);
  if (titleChanged) {
    session.title = text.length > 15 ? text.slice(0, 15) + '...' : text;
  }
  saveSessions();
  if (titleChanged) renderSessionList();
}

function deleteSession(sessionId) {
  const targetId = String(sessionId);
  state.sessions = state.sessions.filter(s => String(s.id) !== targetId);
  if (String(state.sessionId) === targetId) {
    const remaining = getAvatarSessions();
    if (remaining.length > 0) { state.sessionId = remaining[0].id; loadSessionMessages(state.sessionId); }
    else { state.sessionId = null; dom.messagesContainer.innerHTML = ''; }
  }
  saveSessions();
  renderSessionList();
}

// ---------------------- Chat ----------------------
function addHistory(role, text) {
  const div = document.createElement('div');
  div.className = `message message-${role}`;
  div.textContent = text;
  dom.messagesContainer.appendChild(div);
  scrollToBottom();
}

function sendMessage() {
  const text = dom.messageInput.value.trim();
  if (!text || !state.avatar) return;
  dom.messageInput.value = '';
  addHistory('user', text);
  addMsgToSession('user', text);
  showThinking(true);
  setStatus(STATUS.thinking);
  if (!state.bargeInActive) {
    VideoPlayer.reset();
    AudioPlayer.reset();
  }
  state.bargeInActive = false;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    wsSend({ type: 'message', content: text, sessionId: state.sessionId, timestamp: Date.now(), userName: state.userName, userId: state.userId, city: localStorage.getItem('warm-companion-city') || '' });
  } else {
    showThinking(false);
    setStatus(STATUS.online);
    const err = '连接服务器失败，请刷新页面重试';
    addHistory('bot', err);
    addMsgToSession('bot', err);
  }
}

function sendQuickPhrase(phrase) {
  closeQuickMenu();
  dom.messageInput.value = phrase;
  sendMessage();
  dom.messageInput.focus();
}

// ---------------------- CareMode / UserName ----------------------
function toggleCareMode() {
  document.body.classList.toggle('care-mode');
  const on = document.body.classList.contains('care-mode');
  localStorage.setItem('care-mode', on ? 'enabled' : 'disabled');
  showToast(on ? '✅ 已开启关怀模式，文字更大更清晰' : '关怀模式已关闭', 'info');
}

function applyCareModePreference() {
  if (localStorage.getItem('care-mode') === 'enabled') document.body.classList.add('care-mode');
}

// ---------------------- 对话历史抽屉（左侧滑出，底部含设置）----------------------
function _toggleDrawerOverlay(show) {
  const overlay = document.getElementById('drawerOverlay');
  if (!overlay) return;
  overlay.classList.toggle('opacity-0', !show);
  overlay.classList.toggle('pointer-events-none', !show);
}

function openHistory() {
  document.getElementById('historyDrawer')?.classList.remove('-translate-x-full');
  _toggleDrawerOverlay(true);
  if (window.lucide) lucide.createIcons();
}

function closeDrawers() {
  document.getElementById('historyDrawer')?.classList.add('-translate-x-full');
  _toggleDrawerOverlay(false);
}

// 抽屉底部设置面板：展开/收起
function toggleSettingsPanel() {
  const panel   = document.getElementById('settingsPanel');
  const chevron = document.getElementById('settingsChevron');
  if (!panel) return;
  const open = panel.classList.toggle('hidden') === false;
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  if (open && window.lucide) lucide.createIcons();
}

// ---------------------- 快捷服务下拉列表 ----------------------
function toggleQuickMenu() {
  const menu    = document.getElementById('quickMenu');
  const chevron = document.getElementById('quickMenuChevron');
  if (!menu) return;
  const open = menu.classList.toggle('hidden') === false;
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
}

function closeQuickMenu() {
  const menu    = document.getElementById('quickMenu');
  const chevron = document.getElementById('quickMenuChevron');
  if (menu)    menu.classList.add('hidden');
  if (chevron) chevron.style.transform = '';
}

// =====================================================================
// 提醒列表渲染
// =====================================================================
function renderReminders() {
  const listEl  = document.getElementById('reminderList');
  const hintEl  = document.getElementById('reminderEmptyHint');
  const countEl = document.getElementById('reminderCount');
  if (!listEl) return;
  listEl.innerHTML = '';
  const active = state.reminders.filter(r => !r.fired);
  const fired  = state.reminders.filter(r =>  r.fired);
  if (countEl) {
    if (active.length > 0) { countEl.textContent = `${active.length} 条待提醒`; countEl.classList.remove('hidden'); }
    else { countEl.classList.add('hidden'); }
  }
  if (hintEl) hintEl.style.display = state.reminders.length === 0 ? '' : 'none';
  [...active, ...fired].forEach(r => {
    const li = document.createElement('li');
    li.style.cssText = `display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:10px;background:${r.fired ? '#f3f4f6' : '#fff'};border:1px solid ${r.fired ? '#e5e7eb' : '#e8d5a8'}`;
    li.innerHTML = `
      <span style="color:${r.fired ? '#e89b4c' : '#8b7a65'};margin-top:2px;flex-shrink:0">${r.fired ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.78rem;color:#d87e2a;font-weight:600">${escapeHtml(r.whenStr || '')}</div>
        <div style="font-size:0.9rem;color:#3d2e1f;word-break:break-word">${escapeHtml(r.content || '')}</div>
      </div>
      <button onclick="dismissReminder('${r.id}')" style="background:transparent;border:none;cursor:pointer;color:#aaa;font-size:1rem;padding:2px 4px;border-radius:4px;flex-shrink:0" title="移除">✕</button>`;
    listEl.appendChild(li);
  });
}

function dismissReminder(id) {
  state.reminders = state.reminders.filter(r => r.id !== id);
  renderReminders();
}
window.dismissReminder = dismissReminder;

// =====================================================================
// 用户管理系统
// =====================================================================
const USERS_KEY    = 'warm-companion-users';
const CUR_USER_KEY = 'warm-companion-current-user';

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
  catch (_) { return []; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _applyUser(user) {
  if (!user) return;
  state.userId   = user.id;
  state.userName = user.name;
  localStorage.setItem(CUR_USER_KEY, user.id);
  if (dom.userDisplayName) dom.userDisplayName.textContent = user.name;
  const nameEl   = document.getElementById('currentUserDisplay');
  const avatarEl = document.getElementById('currentUserAvatar');
  if (nameEl)   nameEl.textContent   = user.name;
  if (avatarEl) avatarEl.textContent = user.name.charAt(0);
  const input = document.getElementById('userNameInput');
  if (input) input.value = user.name;
}

function selectUser(userId) {
  const users = loadUsers();
  const user  = users.find(u => u.id === userId);
  if (!user) return;
  user.lastActiveAt = Date.now();
  saveUsers(users);
  _applyUser(user);
  renderUserModalList();
  hideUserModal();
}

function confirmNewUser() {
  const input = document.getElementById('newUserNameInput');
  const name  = (input ? input.value : '').trim();
  if (!name) { showToast('请输入名字', 'warning'); return; }
  const users  = loadUsers();
  const exists = users.find(u => u.name === name);
  if (exists) { selectUser(exists.id); if (input) input.value = ''; return; }
  const newUser = { id: String(Date.now()), name, createdAt: Date.now(), lastActiveAt: Date.now() };
  users.push(newUser);
  saveUsers(users);
  if (input) input.value = '';
  _applyUser(newUser);
  renderUserModalList();
  hideUserModal();
  showToast(`欢迎，${name}！个人记忆已为您开启`, 'info');
}

window.deleteUser = function(userId) {
  const users = loadUsers();
  const user  = users.find(u => u.id === userId);
  if (!user) return;
  if (!confirm(`确定删除用户「${user.name}」及其所有记忆记录吗？`)) return;
  const newUsers = users.filter(u => u.id !== userId);
  saveUsers(newUsers);
  wsSend({ type: 'delete_user', userId });
  if (state.userId === userId) {
    if (newUsers.length > 0) {
      _applyUser(newUsers[0]);
    } else {
      state.userId   = '';
      state.userName = '';
      localStorage.removeItem(CUR_USER_KEY);
      if (dom.userDisplayName) dom.userDisplayName.textContent = '朋友';
      const nameEl   = document.getElementById('currentUserDisplay');
      const avatarEl = document.getElementById('currentUserAvatar');
      if (nameEl)   nameEl.textContent   = '未选择用户';
      if (avatarEl) avatarEl.textContent = '?';
    }
  }
  renderUserModalList();
};

function renderUserModalList() {
  const listEl = document.getElementById('userModalList');
  if (!listEl) return;
  listEl.innerHTML = '';
  const users = loadUsers();
  if (users.length === 0) {
    listEl.innerHTML = '<p style="text-align:center;color:#8b7a65;font-size:0.85rem;padding:12px 0">还没有用户，请在下方创建</p>';
    return;
  }
  users.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)).forEach(u => {
    const isActive = u.id === state.userId;
    const div = document.createElement('div');
    div.className = 'user-list-item' + (isActive ? ' active' : '');
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <div class="user-avatar-mini">${escapeHtml(u.name.charAt(0))}</div>
        <span class="user-list-name">${escapeHtml(u.name)}${isActive ? ' <span style="color:#d87e2a;font-size:0.75rem">当前</span>' : ''}</span>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${!isActive ? `<button style="font-size:0.78rem;padding:4px 10px;background:#e89b4c;color:#fff;border:none;border-radius:8px;cursor:pointer" onclick="selectUser('${u.id}')">选择</button>` : ''}
        <button class="user-list-delete" onclick="deleteUser('${u.id}')" title="删除用户"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div>`;
    listEl.appendChild(div);
  });
}

function showUserModal() {
  const modal = document.getElementById('userModal');
  if (modal) { modal.style.display = 'flex'; renderUserModalList(); }
  if (window.lucide) lucide.createIcons();
  setTimeout(() => { const inp = document.getElementById('newUserNameInput'); if (inp) inp.focus(); }, 100);
}

function hideUserModal() {
  const modal = document.getElementById('userModal');
  if (modal) modal.style.display = 'none';
}

function _refreshUserBars() {
  renderSelectPageUserBar();
  renderUserModalList();
}

function renderSelectPageUserBar() {
  const bar = document.getElementById('selectPageUserBar');
  if (!bar) return;
  bar.innerHTML = '';
  const users = loadUsers();
  if (users.length === 0) {
    bar.innerHTML = `<div style="text-align:center;width:100%"><p style="color:#8b7a65;font-size:0.9rem;margin-bottom:8px">首次使用，请先告诉我您的名字</p><button onclick="showUserModal()" style="padding:8px 24px;background:#e89b4c;color:#fff;border:none;border-radius:9999px;font-weight:600;cursor:pointer;font-size:0.95rem">创建我的账号</button></div>`;
    return;
  }
  users.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)).forEach(u => {
    const btn = document.createElement('button');
    const isActive = u.id === state.userId;
    btn.style.cssText = `padding:8px 20px;border-radius:9999px;font-size:1rem;font-weight:500;cursor:pointer;transition:all .15s;border:2px solid;${isActive ? 'background:#e89b4c;color:#fff;border-color:#e89b4c;box-shadow:0 3px 10px rgba(232,155,76,.35)' : 'background:#fff;color:#5c4a36;border-color:#e8d5a8'}`;
    btn.textContent = u.name;
    btn.onclick = () => selectUser(u.id);
    bar.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.style.cssText = 'padding:8px 20px;border-radius:9999px;font-size:1rem;font-weight:500;cursor:pointer;background:#fdf9f1;color:#8b7a65;border:2px dashed #e8d5a8;transition:all .15s';
  addBtn.textContent = '＋ 新用户';
  addBtn.onclick = showUserModal;
  bar.appendChild(addBtn);
}

function initUserSystem() {
  const users   = loadUsers();
  const curId   = localStorage.getItem(CUR_USER_KEY);
  const oldName = localStorage.getItem('warm-companion-username');
  if (users.length === 0 && oldName) {
    const migrated = { id: String(Date.now()), name: oldName, createdAt: Date.now(), lastActiveAt: Date.now() };
    saveUsers([migrated]);
    _applyUser(migrated);
  } else {
    const cur = users.find(u => u.id === curId) || (users.length > 0 ? users[0] : null);
    if (cur) _applyUser(cur);
  }
  renderSelectPageUserBar();
}

function loadUserName() { initUserSystem(); }

function saveUserName() {
  const input = document.getElementById('userNameInput');
  const name = (input ? input.value : '').trim();
  if (!name) { showToast('请输入您的称呼', 'warning'); return; }
  const users = loadUsers();
  if (state.userId) {
    const u = users.find(x => x.id === state.userId);
    if (u) {
      u.name = name;
      u.lastActiveAt = Date.now();
      saveUsers(users);
      _applyUser(u);
      showToast(`好的，${name}，我会记住您的名字！`, 'info');
      return;
    }
  }
  confirmNewUser();
}

function updateTimeGreeting() {
  if (dom.timeGreeting) dom.timeGreeting.textContent = getGreeting();
}

// ---------------------- Voice Recognition ----------------------
let _SRConstructor = null;

function initVoiceRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
  _SRConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
}

function createRecognitionInstance() {
  if (!_SRConstructor) return null;
  const rec = new _SRConstructor();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'zh-CN';
  rec.onstart = () => {
    state.recording = true;
    state.bargeInActive = true;
    wsSend({ type: 'barge_in_start', timestamp: Date.now() });
    VideoPlayer.reset();
    AudioPlayer.reset();
    setStatus(STATUS.listening);
  };
  rec.onresult = (e) => {
    dom.messageInput.value = e.results[0][0].transcript;
    setTimeout(() => { if (dom.messageInput.value.trim()) sendMessage(); }, 100);
  };
  rec.onerror = (e) => {
    stopVoiceUI();
    setStatus(STATUS.online);
    if (e.error !== 'no-speech') showToast('语音识别失败，请重试', 'warning');
  };
  rec.onend = () => { stopVoiceUI(); setStatus(STATUS.online); };
  return rec;
}

function stopVoiceUI() {
  state.recording = false;
  const btn = document.getElementById('centerVoiceBtn');
  if (btn) btn.classList.remove('recording');
}

function startVoiceRecording() {
  state.pressTimer = setTimeout(() => {
    state.isLongPress = true;
    const btn = document.getElementById('centerVoiceBtn');
    if (btn) { btn.classList.add('recording'); btn.innerHTML = '<div class="voice-wave"><span></span><span></span><span></span><span></span><span></span></div><span style="font-weight:600;font-size:0.95rem;margin-left:6px">松开发送</span>'; }
    if (!_SRConstructor) { showToast('您的浏览器不支持语音识别功能', 'warning'); return; }
    state.recognition = createRecognitionInstance();
    try { state.recognition.start(); } catch (_) { showToast('语音识别暂时不可用', 'warning'); }
  }, 300);
  const btn = document.getElementById('centerVoiceBtn');
  if (btn) btn.classList.add('pressing');
}

function stopVoiceRecording() {
  clearTimeout(state.pressTimer);
  const btn = document.getElementById('centerVoiceBtn');
  if (btn) btn.classList.remove('pressing');
  if (state.isLongPress) {
    state.isLongPress = false;
    if (btn) {
      btn.classList.remove('recording');
      btn.innerHTML = `<div id="voiceIdleState" class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg><span class="font-medium text-base whitespace-nowrap">按住 说话</span></div>`;
    }
    if (state.recognition) { try { state.recognition.stop(); } catch (_) { stopVoiceUI(); } }
  } else {
    showToast('💡 长按按钮可以语音输入哦', 'info');
  }
}

// ---------------------- Page Navigation ----------------------
async function selectAvatar(id) {
  state.avatar = AVATARS[id];
  dom.botName.textContent = state.avatar.name;
  dom.botDesc.textContent = state.avatar.desc;

  // 聊天气泡头像（CSS 变量驱动 .message-bot::before）
  if (state.avatar.imagePath) {
    document.documentElement.style.setProperty('--bot-avatar-url', `url('${state.avatar.imagePath}')`);
  }

  // 旧接口兼容（avatarContainer 隐藏在 DOM 里仍用于部分逻辑）
  if (dom.avatarContainer) {
    dom.avatarContainer.className = `avatar-image ${state.avatar.skinClass || ''}`;
    dom.avatarContainer.textContent = '';
  }

  // 顶栏名牌头像
  const badgeAvatar = document.getElementById('botBadgeAvatar');
  if (badgeAvatar && state.avatar.imagePath) {
    badgeAvatar.style.backgroundImage = `url('${state.avatar.imagePath}')`;
    badgeAvatar.style.backgroundSize = 'cover';
    badgeAvatar.style.backgroundPosition = 'center';
    badgeAvatar.textContent = '';
  }

  destroyAvatarArea();
  initAvatarVideoArea(state.avatar);
  tryLoadIdleVideo(id);

  dom.selectPage.classList.remove('active');
  dom.chatPage.classList.add('active');
  loadSessions();
  loadUserName();

  const avatarSessions = getAvatarSessions();
  if (avatarSessions.length === 0) {
    newConversation();
  } else {
    // 切换形象后始终加载该形象的最新会话，不沿用上一个形象的 sessionId
    const sorted = avatarSessions.sort((a, b) => b.updated - a.updated);
    state.sessionId = sorted[0].id;
    renderSessionList();
    loadSessionMessages(state.sessionId);
  }
  connectWebSocket();
  Camera.init();
  dom.messageInput.focus();
  setStatus(STATUS.online);
}

function goBack() {
  state.reconnects = MAX_RECONNECT;
  if (state.ws) state.ws.close();
  VideoPlayer.reset();
  AudioPlayer.reset();
  resetBotBubbleState();
  Camera.stop();
  dom.chatPage.classList.remove('active');
  dom.selectPage.classList.add('active');
  destroyAvatarArea();
  state.avatar = null;
  state.sessionId = null;
  dom.messagesContainer.innerHTML = '';
}

// ---------------------- Init ----------------------
window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  cacheDom();
  applyCareModePreference();
  loadUserName();
  updateTimeGreeting();
  setInterval(updateTimeGreeting, 60000);
  initVoiceRecognition();
  initSessionListEvents();
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawers(); closeQuickMenu(); } });
  // 点击快捷菜单外部时收起
  document.addEventListener('click', e => {
    if (!e.target.closest('#quickMenu') && !e.target.closest('#quickMenuBtn')) closeQuickMenu();
  });
});

window.selectAvatar = selectAvatar;
window.goBack = goBack;
window.newConversation = newConversation;
window.sendQuickPhrase = sendQuickPhrase;
window.toggleCareMode = toggleCareMode;
window.openHistory = openHistory;
window.closeDrawers = closeDrawers;
window.toggleSettingsPanel = toggleSettingsPanel;
window.toggleQuickMenu = toggleQuickMenu;
window.saveUserName = saveUserName;
window.startVoiceRecording = startVoiceRecording;
window.stopVoiceRecording = stopVoiceRecording;
window.handleAvatarUpload = handleAvatarUpload;
window.selectCustomAvatar = selectCustomAvatar;
window.cancelUpload = cancelUpload;
window.showUserModal = showUserModal;
window.hideUserModal = hideUserModal;
window.confirmNewUser = confirmNewUser;
window.selectUser = selectUser;
