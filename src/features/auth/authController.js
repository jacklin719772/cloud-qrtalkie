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
    submitButton.textContent = "注册中...";

    try {
      const result = await authApi.register(payload);
      showAuthMessage(form, result.message || "注册成功，请前往邮箱完成验证。", "success");
      if (result.devVerificationUrl) console.info("Dev verification URL:", result.devVerificationUrl);
    } catch (error) {
      console.error(error);
      if (error.code === "EMAIL_UNVERIFIED") {
        showAuthMessage(form, error.message || "此邮箱已注册但尚未验证。", "info");
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
        resendBtn.textContent = "重新发送验证邮件";
        resendBtn.style.cssText = "padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;";
        resendBtn.onclick = async () => {
          resendBtn.disabled = true;
          resendBtn.textContent = "发送中...";
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
              showAuthMessage(form, data.message || "发送失败，请稍后重试。", "error");
              resendBtn.disabled = false;
              resendBtn.textContent = "重新发送验证邮件";
            }
          } catch {
            showAuthMessage(form, "无法连接服务器，请稍后重试。", "error");
            resendBtn.disabled = false;
            resendBtn.textContent = "重新发送验证邮件";
          }
        };
        resendContainer.appendChild(resendBtn);
      } else {
        showAuthMessage(form, error.message || "无法连接注册服务，请确认 API 是否已启动。", "error");
      }
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "注册并验证电子邮件";
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
    submitButton.textContent = "登录中...";

    try {
      const result = await authApi.login(email, password);
      setAuthToken(result.token);
      await enterConsole();
    } catch (error) {
      showAuthMessage(form, error.message || "登录失败，请稍后重试。", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "登录";
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
      showAuthMessage(loginForm, result.message || "验证邮件发送成功，请登录。", result.ok ? "success" : "error");
    } catch (error) {
      console.error(error);
      showAuthMessage(loginForm, "无法连接验证服务，请确认 API 是否已启动。", "error");
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
      showAuthMessage(document.querySelector("#login-form"), "已退出系统。", "success");
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
