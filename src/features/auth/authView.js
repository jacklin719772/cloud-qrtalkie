import { legalTexts } from "../../data/prototypeData.js";
import { isValidEmail } from "../../core/validation.js";

export function setAuthMode(mode) {
  document.querySelectorAll(".auth-tabs button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.mode === mode);
  });
  document.querySelectorAll(".auth-form").forEach((form) => form.classList.remove("active"));
  document.querySelector(`#${mode}-form`)?.classList.add("active");
}

export function getSignupPayload(form) {
  return {
    companyName: form.elements.companyName.value.trim(),
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
    confirmPassword: form.elements.confirmPassword.value,
    acceptedTerms: document.querySelector("#terms-consent").checked,
  };
}

export function validateSignupPayload(payload) {
  if (!payload.companyName) return "请输入公司名称";
  if (!payload.email) return "请输入邮箱地址";
  if (!isValidEmail(payload.email)) return "请输入有效的邮箱格式";
  if (!payload.password) return "请输入密码";
  if (payload.password.length < 8) return "密码至少需要 8 位字符";
  if (!payload.confirmPassword) return "请再次输入密码";
  if (payload.password !== payload.confirmPassword) return "两次输入的密码不一致";
  if (!payload.acceptedTerms) return "请先阅读并同意服务条款与隐私政策";
  return "";
}

export function getLoginPayload(form) {
  const inputs = form.querySelectorAll("input");
  return {
    email: inputs[0]?.value.trim() || "",
    password: inputs[1]?.value || "",
  };
}

export function validateLoginPayload(payload) {
  if (!isValidEmail(payload.email) || !payload.password) return "请输入有效的登录邮箱和密码。";
  return "";
}

export function openLegalDialog(type) {
  const content = legalTexts[type] || legalTexts.terms;
  document.querySelector("#legal-title").textContent = content.title;
  document.querySelector("#legal-content").innerHTML = content.body;
  document.querySelector("#legal-dialog").showModal();
}
