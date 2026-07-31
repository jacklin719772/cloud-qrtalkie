import {
  getLoginEmailChangePayload,
  getTenantPayload,
  openLoginEmailDialog,
  validateLoginEmailChangePayload,
  validateTenantPayload,
} from "./tenantView.js";

export function createTenantController({
  getTenantSnapshot,
  hideInlineMessage,
  loadTenantSettings,
  setAuthToken,
  setTenantForm,
  showInlineMessage,
  tenantApi,
}) {
  async function saveTenantSettings(event) {
    event.preventDefault();
    const messageNode = document.querySelector("#tenant-message");
    const saveButton = document.querySelector("#save-tenant-settings");
    const payload = getTenantPayload();
    const validationMessage = validateTenantPayload(payload);

    if (validationMessage) {
      showInlineMessage(messageNode, validationMessage, "error");
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "儲存中...";

    try {
      const result = await tenantApi.updateSettings(payload);
      await loadTenantSettings();
      showInlineMessage(messageNode, result.message || "已儲存修改。", "success");
    } catch (error) {
      showInlineMessage(messageNode, error.message || "儲存失敗，請稍後重試。", "error");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "儲存修改";
    }
  }

  function resetTenantSettings() {
    setTenantForm(getTenantSnapshot());
    hideInlineMessage(document.querySelector("#tenant-message"));
  }

  function showLoginEmailDialog() {
    openLoginEmailDialog(getTenantSnapshot(), hideInlineMessage);
  }

  async function sendLoginEmailCode() {
    const messageNode = document.querySelector("#login-email-message");
    const sendButton = document.querySelector("#send-login-email-code");
    const payload = getLoginEmailChangePayload(false);
    const validationMessage = validateLoginEmailChangePayload(payload, false);

    if (validationMessage) {
      showInlineMessage(messageNode, validationMessage, "error");
      return;
    }

    sendButton.disabled = true;
    sendButton.textContent = "傳送中...";

    try {
      const result = await tenantApi.requestLoginEmailChangeCode(payload);
      showInlineMessage(messageNode, result.message || "驗證碼已傳送。", "success");
      document.querySelector("#email-code-field").classList.remove("hidden");
      document.querySelector("#confirm-login-email-change").classList.remove("hidden");
      sendButton.textContent = "60 秒後重發";
      let seconds = 60;
      const timer = window.setInterval(() => {
        seconds -= 1;
        sendButton.textContent = seconds > 0 ? `${seconds} 秒後重發` : "重新發送";
        if (seconds <= 0) {
          window.clearInterval(timer);
          sendButton.disabled = false;
        }
      }, 1000);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "驗證碼傳送失敗。", "error");
      sendButton.disabled = false;
      sendButton.textContent = "傳送驗證碼";
    }
  }

  async function confirmLoginEmailChange(event) {
    event.preventDefault();
    const messageNode = document.querySelector("#login-email-message");
    const confirmButton = document.querySelector("#confirm-login-email-change");
    const payload = getLoginEmailChangePayload(true);
    const validationMessage = validateLoginEmailChangePayload(payload, true);

    if (validationMessage) {
      showInlineMessage(messageNode, validationMessage, "error");
      return;
    }

    confirmButton.disabled = true;
    confirmButton.textContent = "確認中...";

    try {
      const result = await tenantApi.confirmLoginEmailChange(payload);
      showInlineMessage(messageNode, result.message || "已更新，請重新登入。", "success");
      setAuthToken("");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "修改失敗，請稍後重試。", "error");
      confirmButton.disabled = false;
      confirmButton.textContent = "確認修改";
    }
  }

  return {
    confirmLoginEmailChange,
    resetTenantSettings,
    saveTenantSettings,
    sendLoginEmailCode,
    showLoginEmailDialog,
  };
}
