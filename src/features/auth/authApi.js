export function createAuthApi({ apiBaseUrl, apiFetch }) {
  async function register(payload) {
    const response = await fetch(`${apiBaseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "注册失败，请稍后重试。");
    return result;
  }

  async function login(email, password) {
    return apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async function verifyEmail(token) {
    const response = await fetch(`${apiBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    const result = await response.json();
    return { ok: response.ok, message: result.message || "" };
  }

  async function getCurrentUser() {
    return apiFetch("/api/me");
  }

  async function logout() {
    return apiFetch("/api/auth/logout", { method: "POST" });
  }

  return { getCurrentUser, login, logout, register, verifyEmail };
}
