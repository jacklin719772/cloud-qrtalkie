import { isValidEmail } from "../../core/validation.js";

export function setTenantForm(data, sipDomain) {
  const form = document.querySelector("#tenant-settings-form");
  if (!form || !data) return;
  form.elements.tenantNumber.value = data.tenant.tenantNumber || "";
  form.elements.companyName.value = data.tenant.companyName || "";
  form.elements.enterpriseEmail.value = data.tenant.enterpriseEmail || "";
  form.elements.contactPerson.value = data.tenant.contactPerson || "";
  form.elements.contactPhone.value = data.tenant.contactPhone || "";
  form.elements.billingAddress.value = data.tenant.billingAddress || "";
  form.elements.postalCode.value = data.tenant.postalCode || "";
  form.elements.loginEmail.value = data.admin.loginEmail || "";
  form.elements.adminPhone.value = data.admin.phoneNumber || "";

  const sidebarTenant = document.querySelector(".sidebar-foot strong");
  if (sidebarTenant) sidebarTenant.textContent = data.tenant.companyName || "QRTalkie Cloud";
  const tenantDomainInput = document.querySelector("#tenant-sip-domain");
  if (tenantDomainInput) tenantDomainInput.value = data.tenant.sipDomain || sipDomain;
}

export function syncPurchaseBillingAddress(tenantSnapshot) {
  const addressInput = document.querySelector("#purchase-billing-address");
  const editButton = document.querySelector("#edit-purchase-billing-address");
  const cancelButton = document.querySelector("#cancel-purchase-billing-address");
  if (!addressInput) return;
  addressInput.value = tenantSnapshot?.tenant?.billingAddress || "";
  addressInput.readOnly = true;
  if (editButton) editButton.textContent = "編輯";
  cancelButton?.classList.add("hidden");
}

export function getTenantPayload() {
  const form = document.querySelector("#tenant-settings-form");
  return {
    companyName: form.elements.companyName.value.trim(),
    enterpriseEmail: form.elements.enterpriseEmail.value.trim(),
    contactPerson: form.elements.contactPerson.value.trim(),
    contactPhone: form.elements.contactPhone.value.trim(),
    billingAddress: form.elements.billingAddress.value.trim(),
    postalCode: form.elements.postalCode.value.trim(),
    adminPhone: form.elements.adminPhone.value.trim(),
  };
}

export function validateTenantPayload(payload) {
  if (!payload.companyName) return "請輸入公司名稱";
  if (payload.enterpriseEmail && !isValidEmail(payload.enterpriseEmail)) return "請輸入正確的企業郵箱格式";
  return "";
}

export function openLoginEmailDialog(tenantSnapshot, hideInlineMessage) {
  const dialog = document.querySelector("#login-email-dialog");
  const form = document.querySelector("#login-email-change-form");
  form.reset();
  hideInlineMessage(document.querySelector("#login-email-message"));
  document.querySelector("#email-code-field").classList.add("hidden");
  document.querySelector("#confirm-login-email-change").classList.add("hidden");
  document.querySelector("#send-login-email-code").classList.remove("hidden");
  if (tenantSnapshot?.admin?.loginEmail) form.elements.newEmail.value = tenantSnapshot.admin.loginEmail;
  dialog.showModal();
}

export function getLoginEmailChangePayload(includeCode = false) {
  const form = document.querySelector("#login-email-change-form");
  const payload = {
    newEmail: form.elements.newEmail.value.trim(),
    oldPassword: form.elements.oldPassword.value,
    newPassword: form.elements.newPassword.value,
    confirmPassword: form.elements.confirmPassword.value,
  };
  if (includeCode) payload.code = form.elements.code.value.trim();
  return payload;
}

export function validateLoginEmailChangePayload(payload, includeCode = false) {
  if (!isValidEmail(payload.newEmail)) return "請輸入有效的新登入郵箱";
  if (!payload.oldPassword) return "請輸入原密碼";
  if (!payload.newPassword) return "請輸入新登入密碼";
  if (payload.newPassword.length < 8) return "新登入密碼至少需要 8 位";
  if (payload.newPassword !== payload.confirmPassword) return "兩次輸入的新密碼不一致";
  if (includeCode && !/^\d{6}$/.test(payload.code)) return "請輸入正確的 6 位驗證碼";
  return "";
}
