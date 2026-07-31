import {
  getLoginPayload,
  getSignupPayload,
  openLegalDialog,
  setAuthMode,
  validateLoginPayload,
  validateSignupPayload,
} from "./authView.js";

export function createAuthController({
  authApi,
  enterConsole,
  returnToLogin,
  setAuthToken,
  showAuthMessage,
}) {
  async function handleSignup() {
    const form = document.querySelector("#signup-form");
    const payload = getSignupPayload(form);
    const validationMessage = validateSignupPayload(payload);
    const submitButton = document.querySelector("#signup-enter");

    if (validationMessage) {
      showAuthMessage(form, validationMessage, "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "註冊中...";

    try {
      const result = await authApi.register(payload);
      showAuthMessage(form, result.message || "註冊成功，請前往郵箱完成驗證。", "success");
      if (result.devVerificationUrl) console.info("Dev verification URL:", result.devVerificationUrl);
    } catch (error) {
      console.error(error);
      if (error.code === "EMAIL_UNVERIFIED") {
        showAuthMessage(form, error.message || "此郵箱已註冊但尚未驗證。", "info");
        let resendContainer = form.querySelector(".resend-verification-wrap");
        if (!resendContainer) {
          resendContainer = document.createElement("div");
          resendContainer.className = "resend-verification-wrap";
          resendContainer.style.cssText = "margin-top:8px;text-align:center;";
          form.appendChild(resendContainer);
        }
        resendContainer.innerHTML = "";
        const resendBtn = document.createElement("button");
        resendBtn.type = "button";
        resendBtn.textContent = "重新發送驗證郵件";
        resendBtn.style.cssText = "padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;";
        resendBtn.onclick = async () => {
          resendBtn.disabled = true;
          resendBtn.textContent = "傳送中...";
          try {
            const resp = await fetch("/api/auth/resend-verification", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: error.email || payload.email }),
            });
            const data = await resp.json();
            if (resp.ok) {
              resendContainer.innerHTML = `<span style="color:#10b981;font-size:14px;">${data.message || "验证邮件已发送，请检查邮箱。"}</span>`;
            } else {
              showAuthMessage(form, data.message || "傳送失敗，請稍後重試。", "error");
              resendBtn.disabled = false;
              resendBtn.textContent = "重新發送驗證郵件";
            }
          } catch {
            showAuthMessage(form, "無法連線伺服器，請稍後重試。", "error");
            resendBtn.disabled = false;
            resendBtn.textContent = "重新發送驗證郵件";
          }
        };
        resendContainer.appendChild(resendBtn);
      } else {
        showAuthMessage(form, error.message || "無法連線註冊服務，請確認 API 是否已啟動。", "error");
      }
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "註冊並驗證電子郵件";
    }
  }

  async function handleLogin() {
    const form = document.querySelector("#login-form");
    const { email, password } = getLoginPayload(form);
    const submitButton = document.querySelector("#enter-console");
    const validationMessage = validateLoginPayload({ email, password });

    if (validationMessage) {
      showAuthMessage(form, validationMessage, "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "登入中...";

    try {
      const result = await authApi.login(email, password);
      setAuthToken(result.token);
      await enterConsole();
    } catch (error) {
      showAuthMessage(form, error.message || "登入失敗，請稍後重試。", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "登入";
    }
  }

  async function verifyEmailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verifyEmailToken");
    if (!token) return;

    const loginForm = document.querySelector("#login-form");
    setAuthMode("login");

    try {
      const result = await authApi.verifyEmail(token);
      showAuthMessage(loginForm, result.message || "驗證郵件傳送成功，請登入。", result.ok ? "success" : "error");
    } catch (error) {
      console.error(error);
      showAuthMessage(loginForm, "無法連線驗證服務，請確認 API 是否已啟動。", "error");
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  async function handleLogout() {
    const logoutButton = document.querySelector("#logout-system");
    logoutButton.disabled = true;
    try {
      await authApi.logout();
    } catch (error) {
      console.warn("Logout request failed:", error.message);
    } finally {
      setAuthToken("");
      logoutButton.disabled = false;
      returnToLogin();
      showAuthMessage(document.querySelector("#login-form"), "已退出系統。", "success");
    }
  }

  return {
    handleLogin,
    handleLogout,
    handleSignup,
    openLegalDialog,
    setAuthMode,
    verifyEmailFromUrl,
  };
}
