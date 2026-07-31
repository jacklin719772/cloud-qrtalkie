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
  if (!payload.companyName) return "請輸入公司名稱";
  if (!payload.email) return "請輸入郵箱地址";
  if (!isValidEmail(payload.email)) return "請輸入有效的郵箱格式";
  if (!payload.password) return "請輸入密碼";
  if (payload.password.length < 8) return "密碼至少需要 8 位字元";
  if (!payload.confirmPassword) return "請再次輸入密碼";
  if (payload.password !== payload.confirmPassword) return "兩次輸入的密碼不一致";
  if (!payload.acceptedTerms) return "請先閱讀並同意服務條款與隱私政策";
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
  if (!isValidEmail(payload.email) || !payload.password) return "請輸入有效的登入郵箱和密碼。";
  return "";
}

export function openLegalDialog(type) {
  const content = legalTexts[type] || legalTexts.terms;
  document.querySelector("#legal-title").textContent = content.title;
  document.querySelector("#legal-content").innerHTML = content.body;
  document.querySelector("#legal-dialog").showModal();
}
