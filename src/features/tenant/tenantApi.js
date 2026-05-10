export function createTenantApi(apiFetch) {
  return {
    getSettings() {
      return apiFetch("/api/tenant/settings");
    },
    updateSettings(payload) {
      return apiFetch("/api/tenant/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    requestLoginEmailChangeCode(payload) {
      return apiFetch("/api/admin/login-email-change/request-code", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    confirmLoginEmailChange(payload) {
      return apiFetch("/api/admin/login-email-change/confirm", {
        method: "POST",
        body: JSON.stringify({ newEmail: payload.newEmail, code: payload.code }),
      });
    },
  };
}
