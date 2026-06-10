import axios from 'axios';

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_API_DEFAULT_TIMEOUT_MS || 10000);
const DEFAULT_TIMEOUT_RULES = [
  {
    method: 'patch',
    path: '/pbx/webrtc-accounts/:extension/display-name',
    timeoutMs: 60000,
  },
  {
    method: 'patch',
    path: '/pbx/webrtc-accounts/:extension/password',
    timeoutMs: 60000,
  },
  {
    method: 'post',
    path: '/pbx/webrtc-accounts',
    timeoutMs: 120000,
  },
  {
    method: 'delete',
    path: '/pbx/webrtc-accounts/:extension',
    timeoutMs: 120000,
  },
];

function parseTimeoutRules() {
  const raw = import.meta.env.VITE_API_TIMEOUT_RULES_JSON || '';
  if (!raw) return DEFAULT_TIMEOUT_RULES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return [...DEFAULT_TIMEOUT_RULES, ...parsed];
  } catch {}
  return DEFAULT_TIMEOUT_RULES;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePathPattern(pathPattern) {
  const raw = String(pathPattern || '').trim();
  if (!raw) return null;
  const escaped = escapeRegExp(raw);
  const regex = '^' + escaped
    .replace(/(^|[^\\]):([A-Za-z0-9_]+)/g, '$1[^/]+')
    .replace(/\\\*/g, '.*') + '$';
  return new RegExp(regex);
}

function normalizeRequestPath(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const normalized = new URL(value, 'http://localhost');
    return normalized.pathname || '';
  } catch {
    return value.split('?')[0].split('#')[0];
  }
}

function resolveTimeoutMs(config) {
  // 只有调用方显式传递的 timeoutMs 才优先使用
  if (config.timeoutMs !== undefined && config.timeoutMs !== null) {
    const timeoutMs = Number(config.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
  }

  // 按路径规则匹配
  const requestPath = normalizeRequestPath(config.url);
  const requestMethod = String(config.method || 'get').toLowerCase();
  for (const rule of parseTimeoutRules()) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.method && String(rule.method).toLowerCase() !== requestMethod) continue;
    const pattern = compilePathPattern(rule.path || rule.pattern || '');
    if (pattern && pattern.test(requestPath)) {
      const timeoutMs = Number(rule.timeoutMs);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
    }
  }

  return Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 10000;
}

// 建立 Axios 實例
const apiClient = axios.create({
  baseURL: '/api', // 配合 Vite Proxy
  timeout: DEFAULT_TIMEOUT_MS,
});

// 請求攔截器：自動帶上 Token
apiClient.interceptors.request.use(
  (config) => {
    config.timeout = resolveTimeoutMs(config);
    const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 回應攔截器：自動解構資料與統一錯誤處理
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('qrtalkieAdminToken');
      sessionStorage.removeItem('qrtalkieAdminToken');
      window.location.reload(); // 登入過期，重整頁面讓 App.jsx 將使用者導回首頁
    }
    const data = error.response?.data || {};
    const errorMessage = data.message || error.message || '發生未知的錯誤';
    const err = new Error(errorMessage);
    err.code = data.code;
    err.status = error.response?.status;
    err.data = data;
    return Promise.reject(err);
  }
);

export default apiClient;
