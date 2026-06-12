// ============================================================
// script.js v10
// ============================================================

const AVATARS = [
  null,
  { id: 1, name: '小丽', desc: '温柔可爱，陪你聊天～', skinClass: 'avatar-friend1', welcome: '你好呀～我是小丽，很高兴认识你！', imagePath: '/static/avatar-xiaoli.png?v=3' },
  { id: 2, name: '老王', desc: '风趣幽默，随时唠嗑～', skinClass: 'avatar-friend2', welcome: '你好，我是老王，咱们随便聊！', imagePath: '/static/avatar-laowang.png?v=3' },
  { id: 3, name: '小明', desc: '年轻伙伴，活力陪聊～', skinClass: 'avatar-friend3', welcome: '你好，我是小明，和你聊聊生活、兴趣、好心情！', imagePath: '/static/avatar-xiaoming.png?v=3' },
];

const COMPANION_CARDS = [
  { id: 1, name: '\u5c0f\u4e3d', desc: '\u8d34\u5fc3\u5b59\u5973 \u00b7 \u6e29\u67d4\u966a\u4f34', image: '/static/avatar-xiaoli.png?v=3', action: '\u9009\u62e9\u5979' },
  { id: 2, name: '\u8001\u738b', desc: '\u540c\u9f84\u8001\u53cb \u00b7 \u5520\u55d1\u8c08\u5fc3', image: '/static/avatar-laowang.png?v=3', action: '\u9009\u62e9\u4ed6' },
  { id: 3, name: '\u5c0f\u660e', desc: '\u5e74\u8f7b\u4f19\u4f34 \u00b7 \u6d3b\u529b\u966a\u804a', image: '/static/avatar-xiaoming.png?v=3', action: '\u9009\u62e9\u4ed6' },
];

const REMINDER_CATEGORIES = [
  { key: 'all', label: '\u5168\u90e8' },
  { key: 'medicine', label: '\u7528\u836f\u63d0\u9192' },
  { key: 'water', label: '\u559d\u6c34\u63d0\u9192' },
  { key: 'activity', label: '\u6d3b\u52a8\u63d0\u9192' },
  { key: 'other', label: '\u5176\u4ed6' },
];

const REMINDER_ICON_BY_TYPE = {
  medicine: 'pill',
  water: 'glass-water',
  activity: 'footprints',
  other: 'bell',
};

const REMINDER_SERVICE_KEY = 'warm-companion-service-reminders';
const FAMILY_NOTIFY_KEY = 'warm-companion-family-notify-settings';
const REMINDER_LOG_KEY = 'warm-companion-reminder-logs';
const AUTH_TOKEN_KEY = 'warm-companion-token';
const AUTH_ACCOUNT_KEY = 'warm-companion-current-account';
const AUTH_ACCOUNTS_KEY = 'warm-companion-accounts';
const REMEMBER_USERNAME_KEY = 'warm-companion-remember-username';

// ============================================================
// 后端接口对接层
//   - 联系人 → /api/contacts（contacts.py，危机告警/联系家属的数据源）
//   - 我的提醒 → /api/reminders（reminder_service.py，后端定时让数字人播报）
//   - 其余本地数据 → /api/userdata（通用按用户键值存储）
//   一律「本地缓存 + 异步同步 + 登录时拉取」：后端失败时回退本地，绝不阻塞 UI。
// ============================================================
const SYNCED_KEY_PREFIXES = [
  'warm-companion-family-notify-settings',
  'warm-companion-reminder-logs',
  'warm-companion-health-profile',
  'warm-companion-profile-settings',
  'warm-companion-feedback-list',
  'warm-companion-duration-',
  'chatbot-sessions',
  'care-mode',
];

async function apiJson(path, options = {}) {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function currentUserId() {
  return state.userId || '';
}

function shouldSyncKey(key) {
  return SYNCED_KEY_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix));
}

// 写本地，并异步把通用键镜像到后端（fire-and-forget）
function persistLocal(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { }
  const uid = currentUserId();
  if (!uid || !shouldSyncKey(key)) return;
  apiJson('/api/userdata', {
    method: 'PUT',
    body: JSON.stringify({ userId: uid, key, value }),
  });
}

// 登录后从后端拉回该用户的所有同步键，覆盖到本地缓存
async function hydrateUserDataFromBackend() {
  const uid = currentUserId();
  if (!uid) return;
  const res = await apiJson('/api/userdata?userId=' + encodeURIComponent(uid));
  if (!res || !res.ok || !res.data) return;
  Object.entries(res.data).forEach(([key, value]) => {
    if (typeof value === 'string') {
      try { localStorage.setItem(key, value); } catch (_) { }
    }
  });
}

// 家庭联系人：从后端拉取并写入本地缓存（保持 getFamilyContacts 同步可用）
async function hydrateFamilyContacts() {
  const uid = currentUserId();
  if (!uid) return;
  const res = await apiJson('/api/contacts?userId=' + encodeURIComponent(uid));
  if (!res || !res.ok || !Array.isArray(res.contacts)) return;
  const mapped = res.contacts.map(c => ({
    id: String(c.id),
    name: c.name || '',
    relation: c.relation || '',
    phone: c.phone || '',
    emergency: !!(c.emergency ?? c.is_emergency),
    createdAt: c.createdAt || c.created_at || Date.now(),
    updatedAt: c.updatedAt || c.updated_at || Date.now(),
  }));
  saveFamilyContacts(mapped);
}

// 我的提醒：从后端拉取；首次为空则把本地默认条目推上去
async function hydrateReminderService() {
  const uid = currentUserId();
  if (!uid) return;
  const res = await apiJson('/api/reminders?userId=' + encodeURIComponent(uid));
  if (!res || !res.ok || !Array.isArray(res.items)) return;
  if (res.items.length === 0 && reminderServiceState.items.length > 0) {
    const bulk = await apiJson('/api/reminders/bulk', {
      method: 'POST',
      body: JSON.stringify({ userId: uid, items: reminderServiceState.items }),
    });
    if (bulk && Array.isArray(bulk.items) && bulk.items.length) {
      reminderServiceState.items = bulk.items;
    }
  } else {
    reminderServiceState.items = res.items;
  }
  saveReminderServiceItems();
}

// 登录后统一拉取该用户的所有后端数据，再刷新各视图
async function hydrateAllUserData() {
  if (!currentUserId()) return;
  await Promise.all([
    hydrateUserDataFromBackend(),
    hydrateFamilyContacts(),
    hydrateReminderService(),
  ]);
  loadReminderServiceItems();
  loadFamilyNotifySettings();
  if (typeof renderReminderService === 'function') renderReminderService();
  if (typeof renderFamilyNotifyPanel === 'function') renderFamilyNotifyPanel();
}

let reminderServiceState = {
  category: 'all',
  items: [
    { id: 'medicine-1', type: 'medicine', name: '\u964d\u538b\u836f', time: '\u6bcf\u5929 08:00', repeat: '\u6bcf\u65e5', enabled: true },
    { id: 'water-1', type: 'water', name: '\u559d\u6c34\u63d0\u9192', time: '\u6bcf 2 \u5c0f\u65f6', repeat: '08:00-20:00', enabled: true },
    { id: 'walk-1', type: 'activity', name: '\u6563\u6b65\u63d0\u9192', time: '\u6bcf\u5929 17:00', repeat: '\u6bcf\u65e5', enabled: true },
  ],
};

function getDefaultReminderServiceItems() {
  return [
    { id: 'medicine-1', type: 'medicine', name: '\u964d\u538b\u836f', time: '\u6bcf\u5929 08:00', repeat: '\u6bcf\u65e5', enabled: true },
    { id: 'water-1', type: 'water', name: '\u559d\u6c34\u63d0\u9192', time: '\u6bcf 2 \u5c0f\u65f6', repeat: '08:00-20:00', enabled: true },
    { id: 'walk-1', type: 'activity', name: '\u6563\u6b65\u63d0\u9192', time: '\u6bcf\u5929 17:00', repeat: '\u6bcf\u65e5', enabled: true },
  ];
}

let editingReminderId = null;

let familyNotifySettings = {
  medicine: true,
  emergency: true,
  summary: false,
};

let editingProfileAvatarBase64 = '';
let companionTimerStart = null;

const PROFILE_MENU_ITEMS = [
  { key: 'health', label: '\u6211\u7684\u5065\u5eb7\u6863\u6848', icon: 'heart-pulse' },
  { key: 'family', label: '\u5bb6\u5ead\u8054\u7cfb\u4eba', icon: 'users' },
  { key: 'history', label: '\u804a\u5929\u8bb0\u5f55', icon: 'messages-square' },
  { key: 'settings', label: '\u8bbe\u7f6e', icon: 'settings' },
  { key: 'help', label: '\u5e2e\u52a9\u4e0e\u53cd\u9988', icon: 'circle-help' },
];

const STATUS = {
  online: { key: 'online', text: '在线' },
  thinking: { key: 'thinking', text: '思考中...' },
  speaking: { key: 'speaking', text: '正在说话' },
  playAudio: { key: 'speaking', text: '播放语音' },
  listening: { key: 'listening', text: '正在听您说话...' },
  listenSay: { key: 'listening', text: '我在听，您说' },
  offline: { key: 'offline', text: '离线' },
  offlineD: { key: 'offline', text: '连接断开' },
  reconnect: { key: 'reconnecting', text: '重连中...' },
  genReply: { key: 'thinking', text: '正在生成回复...' },
};

const MAX_RECONNECT = 5;

const DIALECT_LABELS = {
  mandarin: '普通话',
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
  call: { muted: false, cameraOn: false },
  auth: {
    login: { username: '', password: '', remember: false },
    register: { username: '', password: '', agreed: false },
  },
};

const dom = {};
function cacheDom() {
  ['selectPage', 'chatPage', 'botName', 'botDesc', 'messageInput',
    'messagesContainer', 'avatarContainer', 'sessionList', 'sendBtn',
    'timeGreeting', 'userDisplayName'].forEach(id => {
      dom[id] = document.getElementById(id);
    });
}

function renderCompanionCards() {
  const grid = document.getElementById('companionCards');
  if (!grid) return;
  grid.innerHTML = '';
  COMPANION_CARDS.forEach(card => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'companion-card';
    button.onclick = () => selectAvatar(card.id);
    button.innerHTML = `
      <img src="${card.image}" alt="${escapeHtml(card.name)}">
      <h3>${escapeHtml(card.name)}</h3>
      <p>${escapeHtml(card.desc)}</p>
      <span class="choose-companion-btn">${escapeHtml(card.action)} <i data-lucide="arrow-right" style="width:18px;height:18px"></i></span>
    `;
    grid.appendChild(button);
  });
  if (window.lucide) lucide.createIcons();
}

function loadReminderServiceItems() {
  reminderServiceState.category = 'all';
  reminderServiceState.items = getDefaultReminderServiceItems();
  try {
    const saved = localStorage.getItem(getReminderServiceKey());
    if (!saved) return;
    const data = JSON.parse(saved);
    if (Array.isArray(data)) {
      reminderServiceState.items = data;
      return;
    }
    if (data && Array.isArray(data.items)) {
      reminderServiceState.items = data.items;
      if (REMINDER_CATEGORIES.some(category => category.key === data.category)) {
        reminderServiceState.category = data.category;
      }
    }
  } catch (_) { }
}

function saveReminderServiceItems() {
  try {
    localStorage.setItem(getReminderServiceKey(), JSON.stringify({
      category: reminderServiceState.category,
      items: reminderServiceState.items,
    }));
  } catch (_) { }
}

function getReminderServiceKey() {
  return `${REMINDER_SERVICE_KEY}-${state.userId || 'default'}`;
}

function getFamilyNotifyKey() {
  return state.userId ? `${FAMILY_NOTIFY_KEY}-${state.userId}` : '';
}

function loadFamilyNotifySettings() {
  familyNotifySettings = { medicine: true, emergency: true, summary: false };
  try {
    const key = getFamilyNotifyKey();
    if (!key) {
      return;
    }
    const saved = localStorage.getItem(key);
    if (!saved) return;
    const data = JSON.parse(saved);
    familyNotifySettings = {
      ...familyNotifySettings,
      ...data,
    };
  } catch (_) { }
}

function saveFamilyNotifySettings(showSavedToast = true) {
  const key = getFamilyNotifyKey();
  if (!key) {
    showToast('请先登录', 'warning');
    return;
  }
  persistLocal(key, JSON.stringify(familyNotifySettings));
  if (showSavedToast) showToast('家人通知设置已保存', 'info');
}

function getReminderLogs() {
  try {
    const saved = localStorage.getItem(REMINDER_LOG_KEY);
    const logs = saved ? JSON.parse(saved) : [];
    return Array.isArray(logs) ? logs : [];
  } catch (_) {
    return [];
  }
}

function addReminderLog(action, detail) {
  const logs = getReminderLogs();
  logs.unshift({
    action,
    detail,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  persistLocal(REMINDER_LOG_KEY, JSON.stringify(logs.slice(0, 50)));
}

function switchReminderPanel(panel) {
  const panels = {
    mine: document.getElementById('myReminderPanel'),
    family: document.getElementById('familyNotifyPanel'),
    records: document.getElementById('reminderRecordPanel'),
  };
  const menus = {
    mine: document.getElementById('reminderMenuMine'),
    family: document.getElementById('reminderMenuFamily'),
    records: document.getElementById('reminderMenuRecords'),
  };

  Object.keys(panels).forEach(key => {
    if (panels[key]) panels[key].classList.toggle('reminder-panel-hidden', key !== panel);
    if (menus[key]) menus[key].classList.toggle('active', key === panel);
  });

  if (panel === 'mine') {
    renderReminderService();
    hydrateReminderService().then(renderReminderService).catch(() => { });
  }
  if (panel === 'family') {
    renderFamilyNotifyPanel();
    hydrateFamilyContacts().then(renderFamilyNotifyPanel).catch(() => { });
  }
  if (panel === 'records') renderReminderRecordPanel();
  if (window.lucide) lucide.createIcons();
}

function renderFamilyNotifyPanel() {
  const listEl = document.getElementById('familyNotifySettingsList');
  const contactEl = document.querySelector('#familyNotifyPanel .family-contact-list');
  if (contactEl) {
    if (!state.userId) {
      contactEl.innerHTML = '<div><strong>请先登录</strong><span>未绑定</span></div>';
    } else {
      const contacts = getFamilyContacts();
      contactEl.innerHTML = contacts.length
        ? contacts.map(contact => `
          <div>
            <strong>${escapeHtml(contact.relation || '家属')} ${escapeHtml(contact.name)}</strong>
            <span>${escapeHtml(contact.phone || '未填写电话')}${contact.emergency ? ' · 紧急' : ''}</span>
          </div>
        `).join('')
        : '<div><strong>暂无家庭联系人</strong><span>请到个人中心添加</span></div>';
    }
  }
  if (!listEl) return;
  const options = [
    { key: 'medicine', label: '用药提醒同步给家属' },
    { key: 'emergency', label: '紧急情况通知家属' },
    { key: 'summary', label: '每日陪伴摘要通知家属' },
  ];
  listEl.innerHTML = options.map(option => `
    <div class="family-notify-row">
      <span>${option.label}</span>
      <button type="button" class="reminder-switch ${familyNotifySettings[option.key] ? 'on' : ''}"
        onclick="toggleFamilyNotifySetting('${option.key}')" aria-label="${option.label}">
        <span></span>
      </button>
    </div>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function toggleFamilyNotifySetting(key) {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  familyNotifySettings[key] = !familyNotifySettings[key];
  saveFamilyNotifySettings(false);
  renderFamilyNotifyPanel();
}

function renderReminderRecordPanel() {
  const listEl = document.getElementById('reminderRecordList');
  if (!listEl) return;
  const logs = getReminderLogs();
  if (logs.length === 0) {
    listEl.innerHTML = '<div class="reminder-empty">暂无提醒记录</div>';
    return;
  }
  listEl.innerHTML = logs.map(log => `
    <article class="reminder-card reminder-record-card">
      <div class="reminder-icon"><i data-lucide="history" style="width:28px;height:28px"></i></div>
      <div class="reminder-info">
        <h3>${escapeHtml(log.action)}</h3>
        <div class="reminder-meta">
          <span>${escapeHtml(log.detail)}</span>
          <span>${escapeHtml(log.time)}</span>
        </div>
      </div>
    </article>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

function renderReminderService() {
  const tabsEl = document.getElementById('reminderCategoryTabs');
  const listEl = document.getElementById('reminderServiceList');
  if (!tabsEl || !listEl) return;

  tabsEl.innerHTML = '';
  REMINDER_CATEGORIES.forEach(category => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'reminder-tab' + (category.key === reminderServiceState.category ? ' active' : '');
    tab.textContent = category.label;
    tab.onclick = () => switchReminderCategory(category.key);
    tabsEl.appendChild(tab);
  });

  const reminders = reminderServiceState.category === 'all'
    ? reminderServiceState.items
    : reminderServiceState.items.filter(item => item.type === reminderServiceState.category);

  listEl.innerHTML = '';
  if (reminders.length === 0) {
    listEl.innerHTML = '<div class="reminder-empty">\u6682\u65e0\u8be5\u7c7b\u63d0\u9192</div>';
    return;
  }

  reminders.forEach(item => {
    const card = document.createElement('article');
    card.className = 'reminder-card';
    const icon = REMINDER_ICON_BY_TYPE[item.type] || REMINDER_ICON_BY_TYPE.other;
    card.innerHTML = `
      <div class="reminder-icon"><i data-lucide="${icon}" style="width:28px;height:28px"></i></div>
      <div class="reminder-info">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="reminder-meta">
          <span>${escapeHtml(item.time)}</span>
          <span>${escapeHtml(item.repeat)}</span>
        </div>
      </div>
      <div class="reminder-actions">
        <button type="button" class="reminder-switch ${item.enabled ? 'on' : ''}" onclick="toggleReminderEnabled('${item.id}')" aria-label="toggle reminder"><span></span></button>
        <button type="button" class="reminder-action-btn" onclick="editReminderPlaceholder('${item.id}')" title="编辑"><i data-lucide="pencil" style="width:18px;height:18px"></i></button>
        <button type="button" class="reminder-action-btn delete" onclick="deleteReminderPlaceholder('${item.id}')" title="删除"><i data-lucide="trash-2" style="width:18px;height:18px"></i></button>
      </div>
    `;
    listEl.appendChild(card);
  });
  if (window.lucide) lucide.createIcons();
}

function switchReminderCategory(category) {
  reminderServiceState.category = category;
  saveReminderServiceItems();
  renderReminderService();
}

function toggleReminderEnabled(id) {
  const item = reminderServiceState.items.find(reminder => reminder.id === id);
  if (!item) return;
  item.enabled = !item.enabled;
  saveReminderServiceItems();
  addReminderLog(item.enabled ? '开启提醒' : '关闭提醒', item.name);
  renderReminderService();
  apiJson('/api/reminders/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify({ userId: currentUserId(), enabled: item.enabled }),
  });
}

function addReminderPlaceholder() {
  editingReminderId = null;
  openReminderModal('添加提醒');
}

function editReminderPlaceholder(id) {
  const item = reminderServiceState.items.find(reminder => reminder.id === id);
  if (!item) return;
  editingReminderId = id;
  openReminderModal('编辑提醒', item);
}

function deleteReminderPlaceholder(id) {
  const item = reminderServiceState.items.find(reminder => reminder.id === id);
  if (!item) return;
  if (!confirm('确定删除这个提醒吗？')) return;
  reminderServiceState.items = reminderServiceState.items.filter(reminder => reminder.id !== id);
  saveReminderServiceItems();
  addReminderLog('删除提醒', item.name);
  renderReminderService();
  showToast('提醒已删除', 'info');
  apiJson('/api/reminders/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(currentUserId()), {
    method: 'DELETE',
  });
}

function openReminderModal(title, item = null) {
  const modal = document.getElementById('reminderEditModal');
  const titleEl = document.getElementById('reminderModalTitle');
  const nameInput = document.getElementById('reminderNameInput');
  const typeSelect = document.getElementById('reminderTypeSelect');
  const timeInput = document.getElementById('reminderTimeInput');
  const repeatInput = document.getElementById('reminderRepeatInput');
  const enabledInput = document.getElementById('reminderEnabledInput');
  if (!modal || !titleEl || !nameInput || !typeSelect || !timeInput || !repeatInput || !enabledInput) return;

  titleEl.textContent = title;
  nameInput.value = item ? item.name : '';
  typeSelect.value = item ? item.type : '';
  timeInput.value = item ? item.time : '';
  repeatInput.value = item ? item.repeat : '';
  enabledInput.checked = item ? Boolean(item.enabled) : true;
  modal.style.display = 'flex';
  nameInput.focus();
  if (window.lucide) lucide.createIcons();
}

function closeReminderModal() {
  const modal = document.getElementById('reminderEditModal');
  if (modal) modal.style.display = 'none';
}

function saveReminderFromModal() {
  const nameInput = document.getElementById('reminderNameInput');
  const typeSelect = document.getElementById('reminderTypeSelect');
  const timeInput = document.getElementById('reminderTimeInput');
  const repeatInput = document.getElementById('reminderRepeatInput');
  const enabledInput = document.getElementById('reminderEnabledInput');
  if (!nameInput || !typeSelect || !timeInput || !repeatInput || !enabledInput) return;

  const name = nameInput.value.trim();
  const type = typeSelect.value.trim();
  const time = timeInput.value.trim();
  const repeat = repeatInput.value.trim() || '不重复';

  if (!name) {
    showToast('提醒名称不能为空', 'info');
    return;
  }
  if (!type) {
    showToast('提醒类型不能为空', 'info');
    return;
  }
  if (!time) {
    showToast('提醒时间不能为空', 'info');
    return;
  }

  if (editingReminderId) {
    const item = reminderServiceState.items.find(reminder => reminder.id === editingReminderId);
    if (!item) return;
    item.name = name;
    item.type = type;
    item.time = time;
    item.repeat = repeat;
    item.enabled = enabledInput.checked;
    saveReminderServiceItems();
    addReminderLog('编辑提醒', name);
    closeReminderModal();
    renderReminderService();
    showToast('提醒已更新', 'info');
    apiJson('/api/reminders/' + encodeURIComponent(editingReminderId), {
      method: 'PUT',
      body: JSON.stringify({ userId: currentUserId(), name, type, time, repeat, enabled: item.enabled }),
    });
    return;
  }

  const item = {
    id: `${type}-${Date.now()}`,
    type,
    name,
    time,
    repeat,
    enabled: enabledInput.checked,
  };
  reminderServiceState.items.unshift(item);
  saveReminderServiceItems();
  addReminderLog('添加提醒', name);
  closeReminderModal();
  renderReminderService();
  showToast('提醒已添加', 'info');
  apiJson('/api/reminders', {
    method: 'POST',
    body: JSON.stringify({ userId: currentUserId(), type, name, time, repeat, enabled: item.enabled }),
  }).then(res => {
    if (res && res.ok && res.item) {
      item.id = res.item.id;  // 用后端 id 替换本地临时 id，保证后续编辑/删除命中
      saveReminderServiceItems();
      renderReminderService();
    }
  });
}

function renderProfileCenter() {
  const menuEl = document.getElementById('profileMenuList');
  const statsEl = document.getElementById('profileStatsGrid');
  const chartEl = document.getElementById('profileCompanionChart');

  const currentUser = getCurrentUser();
  const displayName = currentUser?.name || state.userName || '\u5f20\u963f\u59e8';
  const avatarEl = document.getElementById('profileAvatar');
  const nameEl = document.getElementById('profileName');
  const phoneEl = document.getElementById('profilePhone');
  if (avatarEl) {
    avatarEl.innerHTML = '';
    avatarEl.style.backgroundImage = '';
    if (currentUser?.avatar) {
      avatarEl.style.backgroundImage = `url('${currentUser.avatar}')`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
    } else {
      avatarEl.textContent = displayName.charAt(0) || '\u5f20';
    }
  }
  if (nameEl) nameEl.textContent = displayName;
  if (phoneEl) phoneEl.textContent = currentUser?.phone || '未填写手机号';
  const userCard = document.querySelector('.profile-user-card');
  if (userCard) {
    let memoryEl = document.getElementById('profileMemoryStatus');
    if (!memoryEl) {
      memoryEl = document.createElement('div');
      memoryEl.id = 'profileMemoryStatus';
      memoryEl.className = 'profile-memory-status';
      const editBtn = userCard.querySelector('.profile-edit-btn');
      userCard.insertBefore(memoryEl, editBtn);
    }
    const memoryOn = currentUser?.memoryEnabled !== false;
    memoryEl.textContent = `个人记忆：${memoryOn ? '已开启' : '已关闭'}`;
  }

  if (menuEl) {
    menuEl.innerHTML = '';
    PROFILE_MENU_ITEMS.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-menu-item';
      button.onclick = () => openProfileMenuPlaceholder(item.key);
      button.innerHTML = `<i data-lucide="${item.icon}" style="width:22px;height:22px"></i><span>${item.label}</span>`;
      menuEl.appendChild(button);
    });
  }

  if (statsEl) {
    const todaySeconds = getTodayDurationSeconds();
    const continuousDays = getContinuousCompanionDays();
    const stats = [
      {
        title: '\u4eca\u65e5\u966a\u4f34\u65f6\u957f',
        value: formatDuration(todaySeconds),
        note: todaySeconds > 0 ? '今天已经完成陪伴' : '今天还没有陪伴记录',
        icon: 'clock',
      },
      {
        title: '\u8fde\u7eed\u966a\u4f34',
        value: `${continuousDays} \u5929`,
        note: continuousDays > 0 ? '保持温暖联系' : '开始一次陪伴后会自动记录',
        icon: 'sparkles',
      },
    ];
    statsEl.innerHTML = '';
    stats.forEach(stat => {
      const card = document.createElement('article');
      card.className = 'profile-stat-card';
      card.innerHTML = `
        <div class="profile-stat-top">
          <h3>${stat.title}</h3>
          <div class="profile-stat-icon"><i data-lucide="${stat.icon}" style="width:26px;height:26px"></i></div>
        </div>
        <div>
          <div class="profile-stat-value">${stat.value}</div>
          <div class="profile-stat-note">${stat.note}</div>
        </div>
      `;
      statsEl.appendChild(card);
    });
  }

  if (chartEl) {
    const durationData = getLastDaysDuration(7);
    const maxSeconds = Math.max(...durationData.map(item => item.seconds), 1);
    chartEl.innerHTML = '';
    if (durationData.every(item => item.seconds === 0)) {
      chartEl.innerHTML = '<div class="profile-chart-empty">暂无陪伴记录</div>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    durationData.forEach(item => {
      const bar = document.createElement('div');
      bar.className = 'profile-bar-item';
      const height = Math.max(12, Math.round((item.seconds / maxSeconds) * 100));
      bar.innerHTML = `
        <div class="profile-bar-value">${formatDuration(item.seconds)}</div>
        <div class="profile-bar-track"><div class="profile-bar-fill" style="height:${height}%"></div></div>
        <div class="profile-bar-label">${item.day}</div>
      `;
      chartEl.appendChild(bar);
    });
  }

  if (window.lucide) lucide.createIcons();
}

function editProfilePlaceholder() {
  openEditProfileModal();
}

function openProfileMenuPlaceholder(key) {
  switch (key) {
    case 'health':
      openHealthProfileModal();
      break;
    case 'family':
      openFamilyContactsModal();
      break;
    case 'history':
      openProfileChatHistory();
      break;
    case 'settings':
      openProfileSettingsModal();
      break;
    case 'help':
      openFeedbackModal();
      break;
    default:
      showToast('暂不支持该功能', 'info');
  }
}

function getCurrentUser() {
  const users = loadUsers();
  return users.find(user => user.id === state.userId) || null;
}

function setAvatarPreview(el, name, avatar) {
  if (!el) return;
  el.innerHTML = '';
  el.style.backgroundImage = '';
  if (avatar) {
    el.style.backgroundImage = `url('${avatar}')`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.textContent = (name || '张').charAt(0);
  }
}

function openEditProfileModal() {
  const user = getCurrentUser();
  if (!user) {
    showToast('请先登录', 'warning');
    return;
  }
  editingProfileAvatarBase64 = user.avatar || '';
  const modal = document.getElementById('editProfileModal');
  const nameInput = document.getElementById('editProfileNameInput');
  const phoneInput = document.getElementById('editProfilePhoneInput');
  const remarkInput = document.getElementById('editProfileRemarkInput');
  const memoryInput = document.getElementById('editProfileMemoryInput');
  const avatarInput = document.getElementById('editProfileAvatarInput');
  if (!modal || !nameInput || !phoneInput || !remarkInput || !memoryInput) return;
  nameInput.value = user.loginName || user.name || state.userName || '';
  nameInput.readOnly = true;
  nameInput.title = '用户名由登录账号决定';
  phoneInput.value = user.phone || '';
  remarkInput.value = user.remark || '';
  memoryInput.checked = user.memoryEnabled !== false;
  if (avatarInput) avatarInput.value = '';
  setAvatarPreview(document.getElementById('editProfileAvatarPreview'), user.name, editingProfileAvatarBase64);
  modal.style.display = 'flex';
  nameInput.focus();
  if (window.lucide) lucide.createIcons();
}

function closeEditProfileModal() {
  const modal = document.getElementById('editProfileModal');
  if (modal) modal.style.display = 'none';
}

function handleProfileModalBackdrop(event) {
  if (event.target?.id === 'editProfileModal') closeEditProfileModal();
}

function isValidProfilePhone(phone) {
  if (!phone) return true;
  return /^\d{11}$/.test(phone) || /^\d{3,4}\*{3,4}\d{4}$/.test(phone);
}

function handleEditProfileAvatarUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const allowTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowTypes.includes(file.type)) {
    showToast('请上传 PNG、JPEG 或 WebP 图片', 'warning');
    event.target.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('头像图片不能超过 5MB', 'warning');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    editingProfileAvatarBase64 = String(reader.result || '');
    const name = document.getElementById('editProfileNameInput')?.value || state.userName || '';
    setAvatarPreview(document.getElementById('editProfileAvatarPreview'), name, editingProfileAvatarBase64);
  };
  reader.readAsDataURL(file);
}

function saveEditProfile() {
  const phone = (document.getElementById('editProfilePhoneInput')?.value || '').trim();
  const remark = (document.getElementById('editProfileRemarkInput')?.value || '').trim();
  const memoryEnabled = !!document.getElementById('editProfileMemoryInput')?.checked;
  if (!isValidProfilePhone(phone)) {
    showToast('手机号需为 11 位数字或脱敏格式', 'warning');
    return;
  }
  const users = loadUsers();
  const user = users.find(item => item.id === state.userId);
  if (!user) {
    showToast('请先登录', 'warning');
    return;
  }
  user.name = user.loginName || state.userName;
  user.phone = phone;
  user.remark = remark;
  user.memoryEnabled = memoryEnabled;
  user.avatar = editingProfileAvatarBase64;
  user.updatedAt = Date.now();
  saveUsers(users);
  _applyUser(user);
  renderProfileCenter();
  renderSelectPageUserBar();
  closeEditProfileModal();
  showToast('资料已保存', 'info');
}

function userScopedKey(prefix) {
  return `${prefix}-${state.userId}`;
}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  persistLocal(key, JSON.stringify(value));
}

function ensureProfileModal(id, title, bodyHtml, saveAction = '') {
  let modal = document.getElementById(id);
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = id;
  modal.className = 'profile-feature-modal';
  modal.style.display = 'none';
  modal.onclick = event => {
    if (event.target === modal) closeProfileFeatureModal(id);
  };
  modal.innerHTML = `
    <div class="profile-feature-card">
      <div class="profile-modal-head">
        <h2>${title}</h2>
        <button type="button" class="profile-modal-close" onclick="closeProfileFeatureModal('${id}')" aria-label="关闭">
          <i data-lucide="x" style="width:22px;height:22px"></i>
        </button>
      </div>
      <div class="profile-feature-body">${bodyHtml}</div>
      ${saveAction ? `
        <div class="profile-modal-actions">
          <button type="button" class="profile-modal-cancel" onclick="closeProfileFeatureModal('${id}')">取消</button>
          <button type="button" class="profile-modal-save" onclick="${saveAction}">保存</button>
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(modal);
  modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  return modal;
}

function closeProfileFeatureModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function closeAllProfileModals() {
  closeEditProfileModal();
  ['healthProfileModal', 'familyContactsModal', 'profileChatHistoryModal', 'profileSettingsModal', 'feedbackModal']
    .forEach(closeProfileFeatureModal);
}

function openHealthProfileModal() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const data = readJsonStorage(userScopedKey('warm-companion-health-profile'), {});
  document.getElementById('healthHeightInput').value = data.height || '';
  document.getElementById('healthWeightInput').value = data.weight || '';
  document.getElementById('healthBloodPressureInput').value = data.bloodPressure || '';
  document.getElementById('healthBloodSugarInput').value = data.bloodSugar || '';
  document.getElementById('healthMedicineInput').value = data.medicine || '';
  document.getElementById('healthAllergyInput').value = data.allergy || '';
  document.getElementById('healthNoteInput').value = data.note || '';
  const modal = document.getElementById('healthProfileModal');
  if (modal) modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function saveHealthProfile() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const data = {
    height: document.getElementById('healthHeightInput')?.value.trim() || '',
    weight: document.getElementById('healthWeightInput')?.value.trim() || '',
    bloodPressure: document.getElementById('healthBloodPressureInput')?.value.trim() || '',
    bloodSugar: document.getElementById('healthBloodSugarInput')?.value.trim() || '',
    medicine: document.getElementById('healthMedicineInput')?.value.trim() || '',
    allergy: document.getElementById('healthAllergyInput')?.value.trim() || '',
    note: document.getElementById('healthNoteInput')?.value.trim() || '',
    updatedAt: Date.now(),
  };
  writeJsonStorage(userScopedKey('warm-companion-health-profile'), data);
  closeProfileFeatureModal('healthProfileModal');
  showToast('健康档案已保存', 'info');
}

function getFamilyContacts() {
  return readJsonStorage(userScopedKey('warm-companion-family-contacts'), []);
}

function saveFamilyContacts(contacts) {
  writeJsonStorage(userScopedKey('warm-companion-family-contacts'), contacts);
}

function openFamilyContactsModal() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const modal = document.getElementById('familyContactsModal');
  if (modal) modal.style.display = 'flex';
  renderFamilyContactsList();
  resetFamilyContactForm();
  if (window.lucide) lucide.createIcons();
  hydrateFamilyContacts().then(renderFamilyContactsList).catch(() => { });
}

function renderFamilyContactsList() {
  const listEl = document.getElementById('familyContactList');
  if (!listEl) return;
  const contacts = getFamilyContacts();
  if (contacts.length === 0) {
    listEl.innerHTML = '<div class="profile-empty">暂无联系人</div>';
    return;
  }
  listEl.innerHTML = contacts.map(contact => `
    <div class="profile-list-item">
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <p>${escapeHtml(contact.relation || '未填写关系')} · ${escapeHtml(contact.phone || '未填写电话')}${contact.emergency ? ' <span class="profile-emergency-tag">紧急联系人</span>' : ''}</p>
      </div>
      <div class="profile-list-actions">
        <button type="button" onclick="editFamilyContact('${contact.id}')">编辑</button>
        <button type="button" class="danger" onclick="deleteFamilyContact('${contact.id}')">删除</button>
      </div>
    </div>
  `).join('');
}

function resetFamilyContactForm() {
  const fields = ['familyContactNameInput', 'familyContactRelationInput', 'familyContactPhoneInput'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const emergency = document.getElementById('familyContactEmergencyInput');
  if (emergency) emergency.checked = false;
  const title = document.getElementById('familyContactEditorTitle');
  if (title) title.textContent = '新增联系人';
  const modal = document.getElementById('familyContactsModal');
  if (modal) modal.dataset.editingId = '';
}

function editFamilyContact(id) {
  const contact = getFamilyContacts().find(item => item.id === id);
  if (!contact) return;
  document.getElementById('familyContactNameInput').value = contact.name || '';
  document.getElementById('familyContactRelationInput').value = contact.relation || '';
  document.getElementById('familyContactPhoneInput').value = contact.phone || '';
  document.getElementById('familyContactEmergencyInput').checked = !!contact.emergency;
  document.getElementById('familyContactEditorTitle').textContent = '编辑联系人';
  document.getElementById('familyContactsModal').dataset.editingId = id;
}

async function saveFamilyContactFromForm() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const name = document.getElementById('familyContactNameInput')?.value.trim() || '';
  const relation = document.getElementById('familyContactRelationInput')?.value.trim() || '';
  const phone = document.getElementById('familyContactPhoneInput')?.value.trim() || '';
  const emergency = !!document.getElementById('familyContactEmergencyInput')?.checked;
  if (!name) {
    showToast('联系人姓名不能为空', 'warning');
    return;
  }
  if (phone && !isValidProfilePhone(phone)) {
    showToast('联系人电话需为 11 位数字或脱敏格式', 'warning');
    return;
  }
  const modal = document.getElementById('familyContactsModal');
  const editingId = modal?.dataset.editingId || '';
  const payload = { userId: currentUserId(), name, relation, phone, emergency };
  const res = editingId
    ? await apiJson('/api/contacts/' + encodeURIComponent(editingId), { method: 'PUT', body: JSON.stringify(payload) })
    : await apiJson('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
  if (res && res.ok) {
    await hydrateFamilyContacts();
  } else {
    // 后端不可用 → 本地兜底，保证不丢数据
    const contacts = getFamilyContacts();
    if (editingId) {
      const contact = contacts.find(item => item.id === editingId);
      if (contact) Object.assign(contact, { name, relation, phone, emergency, updatedAt: Date.now() });
    } else {
      contacts.unshift({ id: String(Date.now()), name, relation, phone, emergency, createdAt: Date.now(), updatedAt: Date.now() });
    }
    saveFamilyContacts(contacts);
  }
  renderFamilyContactsList();
  resetFamilyContactForm();
  showToast('家庭联系人已保存', 'info');
}

async function deleteFamilyContact(id) {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  if (!confirm('确定删除这个联系人吗？')) return;
  const res = await apiJson(
    '/api/contacts/' + encodeURIComponent(id) + '?userId=' + encodeURIComponent(currentUserId()),
    { method: 'DELETE' }
  );
  if (res && res.ok) {
    await hydrateFamilyContacts();
  } else {
    saveFamilyContacts(getFamilyContacts().filter(item => item.id !== id));
  }
  renderFamilyContactsList();
  resetFamilyContactForm();
  showToast('联系人已删除', 'info');
}

function openProfileChatHistory() {
  if (state.avatar) {
    openHistory();
    return;
  }
  loadSessions();
  const sessions = state.sessions
    .filter(session => !session.userId || session.userId === state.userId)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  ensureProfileModal('profileChatHistoryModal', '聊天记录', `
    <div class="profile-list">
      ${sessions.length ? sessions.map(session => `
        <div class="profile-list-item">
          <div>
            <strong>${escapeHtml(session.title || '未命名会话')}</strong>
            <p>${new Date(session.updated || Date.now()).toLocaleString('zh-CN', { hour12: false })} · ${session.messages?.length || 0} 条消息</p>
          </div>
        </div>
      `).join('') : '<div class="profile-empty">请选择陪伴对象后查看聊天记录</div>'}
    </div>
  `);
}

function getProfileSettings() {
  return {
    dialect: 'mandarin',
    autoCamera: true,
    autoVoice: true,
    ...readJsonStorage('warm-companion-profile-settings', {}),
  };
}

function openProfileSettingsModal() {
  const settings = getProfileSettings();
  ensureProfileModal('profileSettingsModal', '设置', `
    <div class="profile-settings-list">
      <div class="profile-setting-row">
        <div><strong>关怀模式</strong><p>放大文字，方便阅读</p></div>
        <button id="profileCareModeSwitch" type="button" class="reminder-switch ${document.body.classList.contains('care-mode') ? 'on' : ''}" onclick="toggleProfileCareMode()"><span></span></button>
      </div>
      <label class="profile-setting-field">
        <span>默认方言</span>
        <select id="profileDialectSelect">
          <option value="mandarin">普通话</option>
          <option value="cantonese">粤语</option>
          <option value="taiwanese">台湾腔</option>
        </select>
      </label>
      <label class="edit-profile-switch-row"><span>自动开启摄像头</span><input id="profileAutoCameraInput" type="checkbox"></label>
      <label class="edit-profile-switch-row"><span>自动播放数字人语音</span><input id="profileAutoVoiceInput" type="checkbox"></label>
    </div>
  `, 'saveProfileSettings()');
  document.getElementById('profileDialectSelect').value = settings.dialect || 'mandarin';
  document.getElementById('profileAutoCameraInput').checked = settings.autoCamera !== false;
  document.getElementById('profileAutoVoiceInput').checked = settings.autoVoice !== false;
}

function toggleProfileCareMode() {
  toggleCareMode();
  const button = document.getElementById('profileCareModeSwitch');
  if (button) button.classList.toggle('on', document.body.classList.contains('care-mode'));
}

function saveProfileSettings() {
  const settings = {
    dialect: document.getElementById('profileDialectSelect')?.value || 'mandarin',
    autoCamera: !!document.getElementById('profileAutoCameraInput')?.checked,
    autoVoice: !!document.getElementById('profileAutoVoiceInput')?.checked,
    updatedAt: Date.now(),
  };
  writeJsonStorage('warm-companion-profile-settings', settings);
  state.dialect = settings.dialect;
  closeProfileFeatureModal('profileSettingsModal');
  showToast('设置已保存', 'info');
}

function openFeedbackModal() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const modal = document.getElementById('feedbackModal');
  const input = document.getElementById('feedbackInput');
  if (input) input.value = '';
  if (modal) modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function submitFeedback() {
  if (!state.userId) {
    showToast('请先登录', 'warning');
    return;
  }
  const content = document.getElementById('feedbackInput')?.value.trim() || '';
  if (!content) {
    showToast('请先填写反馈内容', 'warning');
    return;
  }
  const list = readJsonStorage('warm-companion-feedback-list', []);
  list.unshift({ id: String(Date.now()), userId: state.userId, userName: state.userName, content, createdAt: Date.now() });
  writeJsonStorage('warm-companion-feedback-list', list.slice(0, 100));
  closeFeedbackModal();
  showToast('反馈已记录，感谢您的建议', 'info');
}

function closeFeedbackModal() {
  const input = document.getElementById('feedbackInput');
  if (input) input.value = '';
  closeProfileFeatureModal('feedbackModal');
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDurationKey(date = new Date()) {
  return `warm-companion-duration-${getDateKey(date)}`;
}

function startCompanionTimer() {
  if (companionTimerStart) return;
  companionTimerStart = Date.now();
}

function stopCompanionTimer() {
  if (!companionTimerStart) return;
  const seconds = Math.max(0, Math.floor((Date.now() - companionTimerStart) / 1000));
  companionTimerStart = null;
  if (seconds > 0) addTodayDuration(seconds);
}

function addTodayDuration(seconds) {
  const key = getDurationKey(new Date());
  const current = Number(localStorage.getItem(key) || '0') || 0;
  persistLocal(key, String(current + seconds));
}

function getTodayDurationSeconds() {
  const saved = Number(localStorage.getItem(getDurationKey(new Date())) || '0') || 0;
  const active = companionTimerStart ? Math.max(0, Math.floor((Date.now() - companionTimerStart) / 1000)) : 0;
  return saved + active;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${total}秒`;
}

function getLastDaysDuration(days = 7) {
  const result = [];
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const seconds = Number(localStorage.getItem(getDurationKey(date)) || '0') || 0;
    result.push({
      day: i === 0 ? '今天' : labels[date.getDay()],
      date: getDateKey(date),
      seconds,
    });
  }
  return result;
}

function getContinuousCompanionDays() {
  let days = 0;
  for (let i = 0; i < 365; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const seconds = Number(localStorage.getItem(getDurationKey(date)) || '0') || 0;
    if (i === 0 && getTodayDurationSeconds() > 0) {
      days++;
      continue;
    }
    if (seconds > 0) days++;
    else break;
  }
  return days;
}

// ---------------------- utils ----------------------
function scrollToBottom() {
  const area = document.querySelector('.chat-history-area');
  if (area) setTimeout(() => { area.scrollTop = area.scrollHeight; }, 10);
}

function setPageActive(pageId) {
  ['loginPage', 'registerPage', 'selectPage', 'reminderPage', 'profilePage', 'chatPage'].forEach(id => {
    const page = document.getElementById(id);
    if (page) page.classList.toggle('active', id === pageId);
  });
}

function showLoginPage() {
  closeLogoutConfirm();
  setPageActive('loginPage');
  const rememberedUsername = localStorage.getItem(REMEMBER_USERNAME_KEY) || '';
  const loginUsernameInput = document.getElementById('loginUsernameInput');
  const loginRememberInput = document.getElementById('loginRememberInput');
  if (loginUsernameInput) loginUsernameInput.value = rememberedUsername;
  if (loginRememberInput) loginRememberInput.checked = !!rememberedUsername;
  if (window.lucide) lucide.createIcons();
}

function showRegisterPage() {
  setPageActive('registerPage');
  if (window.lucide) lucide.createIcons();
}

function enterSelectPage() {
  setPageActive('selectPage');
  updateTimeGreeting();
  renderSelectPageUserBar();
  updateSelectUserPanel();
  if (window.lucide) lucide.createIcons();
}

function readAuthForms() {
  state.auth.login.username = (document.getElementById('loginUsernameInput')?.value || '').trim();
  state.auth.login.password = document.getElementById('loginPasswordInput')?.value || '';
  state.auth.login.remember = !!document.getElementById('loginRememberInput')?.checked;
  state.auth.register.username = (document.getElementById('registerUsernameInput')?.value || '').trim();
  state.auth.register.password = document.getElementById('registerPasswordInput')?.value || '';
  state.auth.register.agreed = !!document.getElementById('registerAgreementInput')?.checked;
}

function loadAuthAccounts() {
  try { return JSON.parse(localStorage.getItem(AUTH_ACCOUNTS_KEY) || '[]'); }
  catch (_) { return []; }
}

function saveAuthAccounts(accounts) {
  localStorage.setItem(AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function createOrSelectAuthUser(username) {
  const loginName = String(username || '').trim();
  if (!loginName) return null;

  const users = loadUsers();
  let user = users.find(item => item.loginName === loginName || (!item.loginName && item.name === loginName));
  if (user) {
    user.loginName = loginName;
    user.name = loginName;
    user.lastActiveAt = Date.now();
    saveUsers(users);
    _applyUser(user);
    return user;
  }

  user = {
    id: String(Date.now()),
    name: loginName,
    loginName,
    memoryEnabled: true,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  users.push(user);
  saveUsers(users);
  _applyUser(user);
  return user;
}

function handleLoginSubmit(event) {
  event.preventDefault();
  readAuthForms();
  const username = state.auth.login.username;
  const password = state.auth.login.password;
  if (!username) { showToast('\u8bf7\u8f93\u5165\u7528\u6237\u540d', 'warning'); return; }
  if (!password) { showToast('\u8bf7\u8f93\u5165\u5bc6\u7801', 'warning'); return; }
  const accounts = loadAuthAccounts();
  const account = accounts.find(item => item.username === username);
  if (!account) { showToast('\u8d26\u53f7\u4e0d\u5b58\u5728\uff0c\u8bf7\u5148\u6ce8\u518c', 'warning'); return; }
  if (account.password !== password) { showToast('\u5bc6\u7801\u4e0d\u6b63\u786e', 'warning'); return; }
  localStorage.setItem(AUTH_TOKEN_KEY, 'mock_token_' + Date.now());
  localStorage.setItem(AUTH_ACCOUNT_KEY, JSON.stringify({
    id: account.id,
    username: account.username,
    loginAt: Date.now()
  }));
  if (state.auth.login.remember) localStorage.setItem(REMEMBER_USERNAME_KEY, username);
  else localStorage.removeItem(REMEMBER_USERNAME_KEY);
  createOrSelectAuthUser(account.username);
  showToast('\u767b\u5f55\u6210\u529f\uff0c\u6b22\u8fce\u56de\u6765', 'info');
  enterSelectPage();
}

function handleRegisterSubmit(event) {
  event.preventDefault();
  readAuthForms();
  const username = state.auth.register.username;
  const password = state.auth.register.password;
  if (!username) { showToast('\u8bf7\u8bbe\u7f6e\u7528\u6237\u540d', 'warning'); return; }
  if (!password) { showToast('\u8bf7\u8bbe\u7f6e\u5bc6\u7801', 'warning'); return; }
  if (password.length < 6 || password.length > 16) { showToast('\u5bc6\u7801\u9700\u4e3a 6-16 \u4f4d', 'warning'); return; }
  if (!state.auth.register.agreed) { showToast('\u8bf7\u5148\u52fe\u9009\u7528\u6237\u534f\u8bae\u548c\u9690\u79c1\u653f\u7b56', 'warning'); return; }
  const accounts = loadAuthAccounts();
  if (accounts.some(item => item.username === username)) {
    showToast('\u8be5\u8d26\u53f7\u5df2\u5b58\u5728\uff0c\u8bf7\u76f4\u63a5\u767b\u5f55', 'warning');
    return;
  }
  accounts.push({
    id: 'account_' + Date.now(),
    username,
    password,
    createdAt: Date.now()
  });
  saveAuthAccounts(accounts);
  showToast('\u6ce8\u518c\u6210\u529f\uff0c\u8bf7\u767b\u5f55', 'info');
  showLoginPage();
}

function openLogoutConfirm() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) modal.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}

function closeLogoutConfirm() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) modal.style.display = 'none';
}

function clearCurrentAuthUser() {
  state.userId = '';
  state.userName = '';
  localStorage.removeItem(CUR_USER_KEY);
  if (dom.userDisplayName) dom.userDisplayName.textContent = '朋友';
  const selectUserNameEl = document.getElementById('selectUserDisplayName');
  if (selectUserNameEl) selectUserNameEl.textContent = '朋友';
  const reminderUserNameEl = document.getElementById('reminderUserDisplayName');
  if (reminderUserNameEl) reminderUserNameEl.textContent = '朋友';
  const profileUserNameEl = document.getElementById('profileUserDisplayName');
  if (profileUserNameEl) profileUserNameEl.textContent = '朋友';
  const nameEl = document.getElementById('currentUserDisplay');
  const avatarEl = document.getElementById('currentUserAvatar');
  if (nameEl) nameEl.textContent = '未登录';
  if (avatarEl) avatarEl.textContent = '?';
  renderSelectPageUserBar();
  updateSelectUserPanel();
  refreshUserScopedViews();
}

function confirmLogout() {
  stopCompanionTimer();
  if (state.ws) state.ws.close();
  Camera.stop();
  AudioPlayer.reset();
  VideoPlayer.reset();
  resetBotBubbleState();
  destroyAvatarArea();
  state.avatar = null;
  state.sessionId = null;
  if (dom.messagesContainer) dom.messagesContainer.innerHTML = '';
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_ACCOUNT_KEY);
  clearCurrentAuthUser();
  closeLogoutConfirm();
  showLoginPage();
  showToast('\u5df2\u9000\u51fa\u767b\u5f55', 'info');
}

function showHomePage() {
  stopCompanionTimer();
  if (state.avatar) {
    if (state.ws) state.ws.close();
    Camera.stop();
    AudioPlayer.reset();
    VideoPlayer.reset();
    resetBotBubbleState();
    destroyAvatarArea();
  }
  state.avatar = null;
  state.sessionId = null;
  if (dom.messagesContainer) dom.messagesContainer.innerHTML = '';
  setPageActive('selectPage');
  updateTimeGreeting();
  updateSelectUserPanel();
}

function showReminderService() {
  stopCompanionTimer();
  if (state.avatar) {
    if (state.ws) state.ws.close();
    Camera.stop();
    AudioPlayer.reset();
    VideoPlayer.reset();
    resetBotBubbleState();
    destroyAvatarArea();
  }
  state.avatar = null;
  state.sessionId = null;
  setPageActive('reminderPage');
  switchReminderPanel('mine');
  updateTimeGreeting();
}

function showProfileCenter() {
  stopCompanionTimer();
  if (state.avatar) {
    if (state.ws) state.ws.close();
    Camera.stop();
    AudioPlayer.reset();
    VideoPlayer.reset();
    resetBotBubbleState();
    destroyAvatarArea();
  }
  state.avatar = null;
  state.sessionId = null;
  setPageActive('profilePage');
  renderProfileCenter();
  updateTimeGreeting();
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
  if (h >= 5 && h < 9) return '早上好';
  if (h >= 9 && h < 12) return '上午好';
  if (h >= 12 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 22) return '晚上好';
  return '夜深了';
}

function getTimePrefix() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return '早上好';
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
    this.el.muted = !!state.call.muted;
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
    el.muted = !!state.call.muted;
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
      this._idleActiveEl.play().catch(() => { });
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
    toPlay.muted = !!state.call.muted;
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
  } catch (_) { }
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
    } catch (_) { }
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
  reminder_service_fired(d) {
    if (!d.item) return;
    addReminderLog('提醒触发', d.item.name || '');
    showToast(`⏰ 提醒：${d.item.name || ''}`, 'info');
    const recordsPanel = document.getElementById('reminderRecordPanel');
    if (recordsPanel && !recordsPanel.classList.contains('reminder-panel-hidden')) {
      renderReminderRecordPanel();
    }
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
    if (!video) return;
    if (this.stream) {
      state.call.cameraOn = true;
      syncCallControls();
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = this.stream;
      video.play().catch(() => { });
      state.call.cameraOn = true;
      const hint = document.querySelector('.camera-hint');
      if (hint) hint.textContent = '';
      syncCallControls();
      this._canvas = document.createElement('canvas');
      this._canvas.width = 320;
      this._canvas.height = 240;
      this._ctx = this._canvas.getContext('2d');
      this._startFrameLoop(video);
    } catch (err) {
      state.call.cameraOn = false;
      const hint = document.querySelector('.camera-hint');
      if (hint) hint.textContent = '\u6444\u50cf\u5934\u4e0d\u53ef\u7528\uff1a' + err.name;
      syncCallControls();
      console.warn('[Camera] init failed:', err.name, err.message);
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
    state.call.cameraOn = false;
    const hint = document.querySelector('.camera-hint');
    if (hint) hint.textContent = '\u6444\u50cf\u5934\u5df2\u5173\u95ed';
    syncCallControls();
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

function saveSessions() { persistLocal('chatbot-sessions', JSON.stringify(state.sessions)); }

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
  const session = { id: state.sessionId, avatarId: state.avatar.id, userId: state.userId, title: `会话 ${count + 1}`, messages: [], updated: Date.now() };
  state.sessions.unshift(session);
  saveSessions();
  renderSessionList();
  dom.messagesContainer.innerHTML = '';
  const welcome = personalGreeting(state.avatar.welcome || '你好，我在这里陪你聊天。');
  addHistory('bot', welcome);
  addMsgToSession('bot', welcome);
  setStatus(STATUS.speaking);
  wsSend({ type: 'new_session', sessionId: state.sessionId, userName: state.userName, userId: state.userId });
}

function selectSession(sessionId) {
  state.sessionId = sessionId;
  renderSessionList();
  loadSessionMessages(sessionId);
  wsSend({ type: 'switch_session', sessionId: state.sessionId, userName: state.userName, userId: state.userId });
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

function showSessionDeleteConfirm() {
  return new Promise(resolve => {
    const existing = document.getElementById('sessionDeleteConfirmModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sessionDeleteConfirmModal';
    modal.className = 'session-delete-modal';
    modal.innerHTML = `
      <div class="session-delete-card">
        <div class="session-delete-icon">
          <i data-lucide="trash-2" style="width:28px;height:28px"></i>
        </div>
        <h2>删除这条对话？</h2>
        <p>删除后将从本地聊天记录中移除，无法在当前页面恢复。</p>
        <div class="session-delete-actions">
          <button type="button" class="session-delete-cancel">取消</button>
          <button type="button" class="session-delete-confirm">确认删除</button>
        </div>
      </div>
    `;

    const close = result => {
      modal.remove();
      resolve(result);
    };

    modal.addEventListener('click', event => {
      if (event.target === modal) close(false);
    });
    modal.querySelector('.session-delete-cancel')?.addEventListener('click', () => close(false));
    modal.querySelector('.session-delete-confirm')?.addEventListener('click', () => close(true));

    document.body.appendChild(modal);
    if (window.lucide) lucide.createIcons();
  });
}

async function deleteSession(sessionId) {
  const targetId = String(sessionId);
  const target = state.sessions.find(s => String(s.id) === targetId);
  if (!target) {
    showToast('对话不存在', 'warning');
    return;
  }
  const confirmed = await showSessionDeleteConfirm();
  if (!confirmed) return;

  const deletingCurrent = String(state.sessionId) === targetId;
  state.sessions = state.sessions.filter(s => String(s.id) !== targetId);
  saveSessions();

  if (deletingCurrent) {
    const remaining = getAvatarSessions().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (remaining.length > 0) {
      selectSession(remaining[0].id);
    } else {
      newConversation();
    }
  } else {
    renderSessionList();
  }
  showToast('对话已删除', 'info');
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
  persistLocal('care-mode', on ? 'enabled' : 'disabled');
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
  const sidebar = document.getElementById('historyDrawer');
  document.querySelector('.companion-layout')?.classList.remove('sidebar-collapsed');
  sidebar?.classList.remove('-translate-x-full', 'closed');
  document.getElementById('sidebarOpenBtn')?.classList.remove('visible');
  _toggleDrawerOverlay(true);
  if (window.lucide) lucide.createIcons();
}

function closeDrawers() {
  const sidebar = document.getElementById('historyDrawer');
  sidebar?.classList.add('closed');
  sidebar?.classList.add('-translate-x-full');
  document.querySelector('.companion-layout')?.classList.add('sidebar-collapsed');
  document.getElementById('sidebarOpenBtn')?.classList.add('visible');
  _toggleDrawerOverlay(false);
}

function setDigitalHumanMuted(muted) {
  state.call.muted = !!muted;
  AudioPlayer.el.muted = state.call.muted;
  [VideoPlayer.elA, VideoPlayer.elB, VideoPlayer.activeEl, VideoPlayer.standbyEl].forEach(el => {
    if (el) el.muted = state.call.muted;
  });
}

function setButtonIcon(button, iconName, size = 22) {
  if (!button) return;
  button.innerHTML = `<i data-lucide="${iconName}" style="width:${size}px;height:${size}px"></i>`;
}

function syncCallControls() {
  const muteBtn = document.getElementById('audioMuteBtn');
  const cameraBtn = document.getElementById('cameraToggleBtn');
  setButtonIcon(muteBtn, state.call.muted ? 'volume-off' : 'volume-2');
  setButtonIcon(cameraBtn, state.call.cameraOn ? 'video' : 'video-off');
  if (muteBtn) {
    muteBtn.classList.toggle('is-muted', state.call.muted);
    muteBtn.title = state.call.muted ? '\u6253\u5f00\u58f0\u97f3' : '\u9759\u97f3';
  }
  if (cameraBtn) {
    cameraBtn.classList.toggle('is-off', !state.call.cameraOn);
    cameraBtn.title = state.call.cameraOn ? '\u5173\u95ed\u6444\u50cf\u5934' : '\u6253\u5f00\u6444\u50cf\u5934';
  }
  if (window.lucide) lucide.createIcons();
}

async function toggleCallControl(action) {
  if (action === 'mute') {
    setDigitalHumanMuted(!state.call.muted);
    syncCallControls();
    showToast(state.call.muted ? '\u5df2\u9759\u97f3\u6570\u5b57\u4eba\u58f0\u97f3' : '\u5df2\u6253\u5f00\u6570\u5b57\u4eba\u58f0\u97f3', 'info');
    return;
  }

  if (action === 'camera') {
    if (state.call.cameraOn || Camera.stream) {
      Camera.stop();
      showToast('\u6444\u50cf\u5934\u5df2\u5173\u95ed', 'info');
    } else {
      await Camera.init();
      if (state.call.cameraOn) showToast('\u6444\u50cf\u5934\u5df2\u6253\u5f00', 'info');
    }
    return;
  }

  if (action === 'hangup') {
    stopCompanionTimer();
    Camera.stop();
    AudioPlayer.reset();
    VideoPlayer.reset();
    setStatus(STATUS.online);
    showToast('\u901a\u8bdd\u5df2\u6302\u65ad\uff0c\u53ef\u70b9\u51fb\u6444\u50cf\u5934\u91cd\u65b0\u6253\u5f00\u5c0f\u7a97', 'info');
    return;
  }

  if (action === 'speaker') {
    showToast('\u626c\u58f0\u5668\u8bbe\u5907\u9009\u62e9\u529f\u80fd\u5df2\u9884\u7559', 'info');
    return;
  }

  showToast('\u66f4\u591a\u901a\u8bdd\u529f\u80fd\u5df2\u9884\u7559', 'info');
}
// 抽屉底部设置面板：展开/收起
function toggleSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  const chevron = document.getElementById('settingsChevron');
  if (!panel) return;
  const open = panel.classList.toggle('hidden') === false;
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  if (open && window.lucide) lucide.createIcons();
}

// ---------------------- 快捷服务下拉列表 ----------------------
function toggleQuickMenu() {
  const menu = document.getElementById('quickMenu');
  const chevron = document.getElementById('quickMenuChevron');
  if (!menu) return;
  const open = menu.classList.toggle('hidden') === false;
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
}

function closeQuickMenu() {
  const menu = document.getElementById('quickMenu');
  const chevron = document.getElementById('quickMenuChevron');
  if (menu) menu.classList.add('hidden');
  if (chevron) chevron.style.transform = '';
}

// =====================================================================
// 提醒列表渲染
// =====================================================================
function renderReminders() {
  const listEl = document.getElementById('reminderList');
  const hintEl = document.getElementById('reminderEmptyHint');
  const countEl = document.getElementById('reminderCount');
  if (!listEl) return;
  listEl.innerHTML = '';
  const active = state.reminders.filter(r => !r.fired);
  const fired = state.reminders.filter(r => r.fired);
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
const USERS_KEY = 'warm-companion-users';
const CUR_USER_KEY = 'warm-companion-current-user';

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
  catch (_) { return []; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateSelectUserPanel() {
  const panel = document.getElementById('selectUserPanel');
  const title = document.getElementById('selectCurrentUserTitle');
  const desc = document.getElementById('selectCurrentUserDesc');
  if (!panel || !title || !desc) return;
  if (state.userId && state.userName) {
    title.textContent = state.userName;
    desc.textContent = '\u5f53\u524d\u767b\u5f55\u7528\u6237\u540d\u5df2\u4f5c\u4e3a\u966a\u4f34\u7528\u6237\u540d\u79f0';
    panel.classList.add('selected');
  } else {
    title.textContent = '\u672a\u767b\u5f55';
    desc.textContent = '\u767b\u5f55\u7528\u6237\u540d\u5c06\u4f5c\u4e3a\u60a8\u7684\u966a\u4f34\u7528\u6237\u540d\u79f0';
    panel.classList.remove('selected');
  }
  if (window.lucide) lucide.createIcons();
}

function _applyUser(user) {
  if (!user) return;
  const displayName = user.loginName || user.name;
  user.name = displayName;
  state.userId = user.id;
  state.userName = displayName;
  localStorage.setItem(CUR_USER_KEY, user.id);
  if (dom.userDisplayName) dom.userDisplayName.textContent = displayName;
  const selectUserNameEl = document.getElementById('selectUserDisplayName');
  if (selectUserNameEl) selectUserNameEl.textContent = displayName;
  const reminderUserNameEl = document.getElementById('reminderUserDisplayName');
  if (reminderUserNameEl) reminderUserNameEl.textContent = displayName;
  const profileUserNameEl = document.getElementById('profileUserDisplayName');
  if (profileUserNameEl) profileUserNameEl.textContent = displayName;
  const nameEl = document.getElementById('currentUserDisplay');
  const avatarEl = document.getElementById('currentUserAvatar');
  if (nameEl) nameEl.textContent = displayName;
  if (avatarEl) {
    if (user.avatar) {
      avatarEl.style.backgroundImage = `url('${user.avatar}')`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = displayName.charAt(0);
    }
  }
  const input = document.getElementById('userNameInput');
  if (input) input.value = displayName;
  updateSelectUserPanel();
  updateTimeGreeting();
  if (typeof refreshUserScopedViews === 'function') refreshUserScopedViews();
}

function refreshUserScopedViews() {
  // 先用本地缓存即时渲染，再异步从后端拉取最新数据并重渲染
  loadReminderServiceItems();
  loadFamilyNotifySettings();
  renderReminderService();
  renderFamilyNotifyPanel();
  renderProfileCenter();
  hydrateAllUserData().then(() => {
    renderProfileCenter();
  }).catch(() => { });
}

function selectUser(userId) {
  syncCurrentUserFromAuth();
}

function confirmNewUser() {
  // 功能已移除，用户创建在登录/注册时自动进行
}

window.deleteUser = function (userId) {
  showToast('用户由登录账号决定，不能在主页删除或切换', 'warning');
};

function renderUserModalList() {
}

function showUserModal() {
  showToast('当前用户已由登录账号确定', 'info');
}

function hideUserModal() {
}

function _refreshUserBars() {
  updateSelectUserPanel();
}

function renderSelectPageUserBar() {
  const bar = document.getElementById('selectPageUserBar');
  if (!bar) return;
  bar.innerHTML = '';
  updateSelectUserPanel();
}

function getCurrentAuthAccount() {
  try { return JSON.parse(localStorage.getItem(AUTH_ACCOUNT_KEY) || 'null'); }
  catch (_) { return null; }
}

function syncCurrentUserFromAuth() {
  const account = getCurrentAuthAccount();
  if (!account?.username) {
    clearCurrentAuthUser();
    return null;
  }
  return createOrSelectAuthUser(account.username);
}

function initUserSystem() {
  syncCurrentUserFromAuth();
  updateSelectUserPanel();
}

function loadUserName() { initUserSystem(); }

function saveUserName() {
  syncCurrentUserFromAuth();
  showToast('用户名由登录账号决定', 'info');
}

function updateTimeGreeting() {
  if (dom.timeGreeting) dom.timeGreeting.textContent = getGreeting();
  const selectGreeting = document.getElementById('selectTimeGreeting');
  if (selectGreeting) selectGreeting.textContent = getGreeting();
  const reminderGreeting = document.getElementById('reminderTimeGreeting');
  if (reminderGreeting) reminderGreeting.textContent = getGreeting();
  const profileGreeting = document.getElementById('profileTimeGreeting');
  if (profileGreeting) profileGreeting.textContent = getGreeting();
  const displayName = state.userName || '\u670b\u53cb';
  if (dom.userDisplayName) dom.userDisplayName.textContent = displayName;
  const selectUserNameEl = document.getElementById('selectUserDisplayName');
  if (selectUserNameEl) selectUserNameEl.textContent = displayName;
  const reminderUserNameEl = document.getElementById('reminderUserDisplayName');
  if (reminderUserNameEl) reminderUserNameEl.textContent = displayName;
  const profileUserNameEl = document.getElementById('profileUserDisplayName');
  if (profileUserNameEl) profileUserNameEl.textContent = displayName;
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
  syncCurrentUserFromAuth();
  if (!state.userId) {
    showToast('请先登录', 'warning');
    showLoginPage();
    return;
  }
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

  setPageActive('chatPage');
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
  const profileSettings = getProfileSettings();
  state.dialect = profileSettings.dialect || state.dialect;
  if (profileSettings.autoCamera !== false) Camera.init();
  else syncCallControls();
  setDigitalHumanMuted(profileSettings.autoVoice === false);
  dom.messageInput.focus();
  setStatus(STATUS.online);
  startCompanionTimer();
}

function goBack() {
  stopCompanionTimer();
  state.reconnects = MAX_RECONNECT;
  if (state.ws) state.ws.close();
  VideoPlayer.reset();
  AudioPlayer.reset();
  resetBotBubbleState();
  Camera.stop();
  setPageActive('selectPage');
  destroyAvatarArea();
  state.avatar = null;
  state.sessionId = null;
  dom.messagesContainer.innerHTML = '';
  renderSelectPageUserBar();
  updateSelectUserPanel();
}

// ---------------------- Init ----------------------
window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  cacheDom();
  loadReminderServiceItems();
  loadFamilyNotifySettings();
  renderCompanionCards();
  renderReminderService();
  renderFamilyNotifyPanel();
  renderProfileCenter();
  applyCareModePreference();
  syncCallControls();
  loadUserName();
  updateTimeGreeting();
  setInterval(updateTimeGreeting, 60000);
  initVoiceRecognition();
  initSessionListEvents();
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawers(); closeQuickMenu(); closeLogoutConfirm(); closeReminderModal(); closeAllProfileModals(); } });
  // 点击快捷菜单外部时收起
  document.addEventListener('click', e => {
    if (!e.target.closest('#quickMenu') && !e.target.closest('#quickMenuBtn')) closeQuickMenu();
  });
});

window.selectAvatar = selectAvatar;
window.showLoginPage = showLoginPage;
window.showRegisterPage = showRegisterPage;
window.handleLoginSubmit = handleLoginSubmit;
window.handleRegisterSubmit = handleRegisterSubmit;
window.openLogoutConfirm = openLogoutConfirm;
window.closeLogoutConfirm = closeLogoutConfirm;
window.confirmLogout = confirmLogout;
window.showHomePage = showHomePage;
window.showReminderService = showReminderService;
window.showProfileCenter = showProfileCenter;
window.goBack = goBack;
window.newConversation = newConversation;
window.sendQuickPhrase = sendQuickPhrase;
window.toggleCareMode = toggleCareMode;
window.openHistory = openHistory;
window.closeDrawers = closeDrawers;
window.toggleSettingsPanel = toggleSettingsPanel;
window.toggleQuickMenu = toggleQuickMenu;
window.toggleCallControl = toggleCallControl;
window.switchReminderPanel = switchReminderPanel;
window.switchReminderCategory = switchReminderCategory;
window.toggleReminderEnabled = toggleReminderEnabled;
window.addReminderPlaceholder = addReminderPlaceholder;
window.editReminderPlaceholder = editReminderPlaceholder;
window.deleteReminderPlaceholder = deleteReminderPlaceholder;
window.closeReminderModal = closeReminderModal;
window.saveReminderFromModal = saveReminderFromModal;
window.toggleFamilyNotifySetting = toggleFamilyNotifySetting;
window.saveFamilyNotifySettings = saveFamilyNotifySettings;
window.editProfilePlaceholder = editProfilePlaceholder;
window.openProfileMenuPlaceholder = openProfileMenuPlaceholder;
window.openEditProfileModal = openEditProfileModal;
window.closeEditProfileModal = closeEditProfileModal;
window.handleProfileModalBackdrop = handleProfileModalBackdrop;
window.handleEditProfileAvatarUpload = handleEditProfileAvatarUpload;
window.saveEditProfile = saveEditProfile;
window.closeProfileFeatureModal = closeProfileFeatureModal;
window.saveHealthProfile = saveHealthProfile;
window.resetFamilyContactForm = resetFamilyContactForm;
window.editFamilyContact = editFamilyContact;
window.saveFamilyContactFromForm = saveFamilyContactFromForm;
window.deleteFamilyContact = deleteFamilyContact;
window.toggleProfileCareMode = toggleProfileCareMode;
window.saveProfileSettings = saveProfileSettings;
window.submitFeedback = submitFeedback;
window.closeFeedbackModal = closeFeedbackModal;
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
