/**
 * ECard 访客聊天：接口封装 + WS + 本地缓存。
 *
 * 注意：不能复用 src/apiClient.js —— 那个实例会带上管理端 Token，
 * 且 401 时会 reload 整个页面（访客会话过期是正常情况，不能重载）。
 * 这里用 fetch（同源帶 Cookie），Authorization 只用访客自己的 accessToken。
 */

const CONTACT_STORE_PREFIX = 'ecardChatContact:';
const CODE_STORE_PREFIX = 'ecardChatCode:';

async function request(path, { method = 'GET', token, body, params } = {}) {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url.toString(), {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.message || `請求失敗（${response.status}）`);
    error.code = payload?.code || null;
    error.status = response.status;
    throw error;
  }
  return payload?.data ?? payload;
}

const chatBase = (slug) => `/api/ecard/public/${encodeURIComponent(slug)}/chat`;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('錄音資料讀取失敗'));
    reader.readAsDataURL(blob);
  });
}

export const chatApi = {
  /** 登记（姓名/邮箱必填）→ 建访客 + 会话 + 首次返回聊天码 */
  register: (slug, contact) => request(`${chatBase(slug)}-register`, { method: 'POST', body: { contact } }),

  /** 用聊天码找回上次身份（会当场发会话并滑动续期聊天码） */
  resume: (slug, code) => request(`${chatBase(slug)}-resume`, { method: 'POST', body: { code } }),

  history: (slug, token, { before, limit } = {}) => request(chatBase(slug), { token, params: { before, limit } }),

  send: (slug, token, { content, clientMsgId }) =>
    request(`${chatBase(slug)}/messages`, { method: 'POST', token, body: { content, contentType: 'text', clientMsgId } }),

  markRead: (slug, token, uptoSeq) => request(`${chatBase(slug)}/read`, { method: 'POST', token, body: { uptoSeq } }),

  ticket: (slug, token) => request(`${chatBase(slug)}/ticket`, { token }),

  /** 更换聊天码：旧码立即失效，新码只返回一次 */
  rotateCode: (slug, token) => request(`${chatBase(slug)}/resume-code`, { method: 'POST', token }),

  /** 上传附件（图片/文件/语音通用）：返回 { key, kind, fileName, mimeType, fileSize } */
  uploadAttachment: async (slug, token, { blob, fileName, mimeType, durationMs }) =>
    request(`${chatBase(slug)}/uploads`, {
      method: 'POST',
      token,
      body: { filename: fileName, mimeType, durationMs: durationMs ?? null, data: await blobToDataUrl(blob) },
    }),

  /** 语音消息：先上传录音，再用返回的 key 发一条 contentType=audio 的消息 */
  uploadVoice: (slug, token, { blob, fileName, mimeType, durationMs }) =>
    chatApi.uploadAttachment(slug, token, { blob, fileName, mimeType, durationMs }),

  sendVoice: (slug, token, { key, fileName, durationMs, clientMsgId }) =>
    request(`${chatBase(slug)}/messages`, {
      method: 'POST',
      token,
      body: { contentType: 'audio', attachment: { key, fileName, durationMs }, content: '', clientMsgId },
    }),

  /** 图片 / 文件消息：带上原始文件名，避免落库/展示成随机存储名 */
  sendAttachment: (slug, token, { key, fileName, mimeType, contentType, clientMsgId }) =>
    request(`${chatBase(slug)}/messages`, {
      method: 'POST',
      token,
      body: { contentType, attachment: { key, fileName, mimeType }, content: '', clientMsgId },
    }),

  /** 取附件二进制（需 Bearer，故用 fetch 取 blob，不能直接给 <audio src>） */
  fetchAttachmentBlob: async (slug, token, attachmentId) => {
    const response = await fetch(`/api/ecard/public/${encodeURIComponent(slug)}/chat/attachments/${attachmentId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`附件讀取失敗（${response.status}）`);
    return response.blob();
  },
};

/* ------------------------------------------------------------------ *
 * 本地缓存（聊天码服务端只存哈希，无法再次下发，必须客户端留存）
 * ------------------------------------------------------------------ */

export function loadStoredContact(slug) {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_STORE_PREFIX + slug) || 'null') || null;
  } catch {
    return null;
  }
}

export function saveStoredContact(slug, contact) {
  try {
    localStorage.setItem(CONTACT_STORE_PREFIX + slug, JSON.stringify(contact || {}));
  } catch { /* 隐私模式下不可写，忽略 */ }
}

export function loadStoredCode(slug) {
  try {
    return localStorage.getItem(CODE_STORE_PREFIX + slug) || '';
  } catch {
    return '';
  }
}

export function saveStoredCode(slug, code) {
  try {
    if (code) localStorage.setItem(CODE_STORE_PREFIX + slug, code);
  } catch { /* 忽略 */ }
}

/* ------------------------------------------------------------------ *
 * 访客实时连接（一次票 → 一条 ws，断线自动重连并重新取票）
 * ------------------------------------------------------------------ */

export function createVisitorChatSocket({ slug, getToken, onEvent, onStateChange, wsPath = '/api/ca/ws' }) {
  let socket = null;
  let stopped = false;
  let attempts = 0;
  let pingTimer = null;
  let retryTimer = null;

  const emitState = (state) => { try { onStateChange?.(state); } catch { /* 忽略 */ } };

  async function connect() {
    if (stopped) return;
    const token = getToken();
    if (!token) return;
    emitState('connecting');
    try {
      const ticket = await chatApi.ticket(slug, token);
      if (stopped) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // 必须用外网可达的 /api/ca/ws：服务端返回的 wsPath 是 /ca/ws（本机路径，
      // Apache 只反代 /api 与 /v1，直接连 /ca/ws 到不了）
      const url = `${scheme}://${window.location.host}${wsPath}?ticket=${encodeURIComponent(ticket?.ticket || '')}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempts = 0;
        emitState('connected');
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* 忽略 */ }
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        let frame = null;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (!frame || frame.type === 'pong') return;
        try { onEvent?.(frame); } catch { /* 忽略 */ }
      };

      socket.onclose = () => {
        clearInterval(pingTimer);
        if (stopped) return;
        emitState('disconnected');
        const delay = Math.min(30000, 2000 * 2 ** attempts);
        attempts += 1;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => { try { socket?.close(); } catch { /* 忽略 */ } };
    } catch {
      emitState('disconnected');
      const delay = Math.min(30000, 2000 * 2 ** attempts);
      attempts += 1;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    }
  }

  connect();

  return function close() {
    stopped = true;
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    try { socket?.close(); } catch { /* 忽略 */ }
    socket = null;
  };
}
