export function createApiClient({ apiBaseUrl, getAuthToken }) {
  async function apiFetch(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(result.message || "請求失敗，請稍後重試。");
      err.code = result.code;
      err.status = response.status;
      err.data = result;
      throw err;
    }
    return result;
  }

  return { apiFetch };
}
