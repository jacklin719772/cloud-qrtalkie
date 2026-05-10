export function createApiClient({ apiBaseUrl, getAuthToken }) {
  async function apiFetch(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "请求失败，请稍后重试。");
    return result;
  }

  return { apiFetch };
}
