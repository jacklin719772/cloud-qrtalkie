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
    saveButton.textContent = "保存中...";

    try {
      const result = await tenantApi.updateSettings(payload);
      await loadTenantSettings();
      showInlineMessage(messageNode, result.message || "已保存修改。", "success");
    } catch (error) {
      showInlineMessage(messageNode, error.message || "保存失败，请稍后重试。", "error");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "保存修改";
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
    sendButton.textContent = "发送中...";

    try {
      const result = await tenantApi.requestLoginEmailChangeCode(payload);
      showInlineMessage(messageNode, result.message || "验证码已发送。", "success");
      document.querySelector("#email-code-field").classList.remove("hidden");
      document.querySelector("#confirm-login-email-change").classList.remove("hidden");
      sendButton.textContent = "60 秒后重发";
      let seconds = 60;
      const timer = window.setInterval(() => {
        seconds -= 1;
        sendButton.textContent = seconds > 0 ? `${seconds} 秒后重发` : "重新发送";
        if (seconds <= 0) {
          window.clearInterval(timer);
          sendButton.disabled = false;
        }
      }, 1000);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "验证码发送失败。", "error");
      sendButton.disabled = false;
      sendButton.textContent = "发送验证码";
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
    confirmButton.textContent = "确认中...";

    try {
      const result = await tenantApi.confirmLoginEmailChange(payload);
      showInlineMessage(messageNode, result.message || "已更新，请重新登录。", "success");
      setAuthToken("");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "修改失败，请稍后重试。", "error");
      confirmButton.disabled = false;
      confirmButton.textContent = "确认修改";
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
