import { formatCouponDiscount } from "../../core/formatters.js";
import {
  getPurchaseFormValues,
  refreshAddonPricesForSelectedPlan,
  renderBillingDetail,
  renderPurchaseCatalog,
} from "./purchasePlanView.js";
import {
  scrollPurchasePlans,
  selectChoiceInGroup,
  showBillingView,
  showPurchasePlanView,
  stepPurchaseNumberInput,
} from "./purchasePageView.js";

export function createPurchaseController({
  billingApi,
  getTenantSnapshot,
  hideInlineMessage,
  loadBillingOrders,
  loadTenantSettings,
  showInlineMessage,
  tenantApi,
  titles,
}) {
  let catalog = { plans: [], addons: [] };
  let paymentMethods = [];
  let editingOrderId = null;
  let mode = "create";
  let sourceOrderId = null;
  let appliedCoupon = null;

  function currentBillingAddress() {
    return getTenantSnapshot()?.tenant?.billingAddress || "";
  }

  function syncPurchaseBillingAddress() {
    const addressInput = document.querySelector("#purchase-billing-address");
    const editButton = document.querySelector("#edit-purchase-billing-address");
    const cancelButton = document.querySelector("#cancel-purchase-billing-address");
    if (!addressInput) return;
    addressInput.value = currentBillingAddress();
    addressInput.readOnly = true;
    if (editButton) editButton.textContent = "編輯";
    cancelButton?.classList.add("hidden");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function editPurchaseBillingAddress() {
    const addressInput = document.querySelector("#purchase-billing-address");
    const editButton = document.querySelector("#edit-purchase-billing-address");
    const cancelButton = document.querySelector("#cancel-purchase-billing-address");
    if (!addressInput || !editButton) return;

    if (addressInput.readOnly) {
      addressInput.readOnly = false;
      editButton.textContent = "保存";
      cancelButton?.classList.remove("hidden");
      addressInput.focus();
      return;
    }

    document.querySelector("#billing-address-sync-dialog")?.showModal();
  }

  function cancelPurchaseBillingAddressEdit() {
    const addressInput = document.querySelector("#purchase-billing-address");
    const editButton = document.querySelector("#edit-purchase-billing-address");
    const cancelButton = document.querySelector("#cancel-purchase-billing-address");
    if (!addressInput) return;
    addressInput.value = currentBillingAddress();
    addressInput.readOnly = true;
    if (editButton) editButton.textContent = "编辑";
    cancelButton?.classList.add("hidden");
  }

  async function confirmSyncBillingAddress() {
    const dialog = document.querySelector("#billing-address-sync-dialog");
    const addressInput = document.querySelector("#purchase-billing-address");
    const confirmButton = document.querySelector("#confirm-sync-billing-address");
    const messageNode = document.querySelector("#purchase-page-message");
    const snapshot = getTenantSnapshot();
    if (!addressInput || !snapshot) return;

    confirmButton.disabled = true;
    confirmButton.textContent = "同步中...";

    const tenant = snapshot.tenant || {};
    const admin = snapshot.admin || {};
    const payload = {
      companyName: tenant.companyName || "",
      enterpriseEmail: tenant.enterpriseEmail || "",
      contactPerson: tenant.contactPerson || "",
      contactPhone: tenant.contactPhone || "",
      billingAddress: addressInput.value.trim(),
      postalCode: tenant.postalCode || "",
      adminPhone: admin.phoneNumber || "",
    };

    try {
      const result = await tenantApi.updateSettings(payload);
      await loadTenantSettings();
      cancelPurchaseBillingAddressEdit();
      dialog?.close();
      showInlineMessage(messageNode, result.message || "账单地址已同步更新。", "success");
    } catch (error) {
      showInlineMessage(messageNode, error.message || "同步失败，请稍后重试。", "error");
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = "确认";
    }
  }

  function getFormValues() {
    return getPurchaseFormValues(catalog);
  }

  function renderDetail() {
    renderBillingDetail(catalog, appliedCoupon);
  }

  function refreshAddonPrices() {
    refreshAddonPricesForSelectedPlan(catalog, appliedCoupon);
  }

  function renderCatalog() {
    renderPurchaseCatalog(catalog, appliedCoupon);
  }

  async function loadPurchaseOptions() {
    try {
      catalog = await billingApi.getPurchaseOptions();
      renderCatalog();
    } catch (error) {
      showInlineMessage(document.querySelector("#purchase-page-message"), error.message || "读取套餐资料失败。", "error");
    }
  }

  async function applyCouponCode() {
    const form = document.querySelector("#purchase-page-form");
    const summary = document.querySelector("#coupon-summary");
    const code = form?.elements.couponCode.value.trim().toUpperCase() || "";
    if (!summary) return;

    summary.classList.remove("hidden");
    summary.dataset.type = "";

    if (!code) {
      summary.dataset.type = "error";
      summary.textContent = "请输入优惠代码";
      appliedCoupon = null;
      renderDetail();
      return;
    }

    try {
      const result = await billingApi.validateCoupon(code);
      appliedCoupon = result.coupon;
      summary.innerHTML = `
        <strong>${formatCouponDiscount(appliedCoupon)}</strong>
        <span>有效期 ${appliedCoupon.validUntil}</span>
      `;
      renderDetail();
    } catch (error) {
      appliedCoupon = null;
      summary.dataset.type = "error";
      summary.textContent = error.message || "优惠码无效或不存在。";
      renderDetail();
    }
  }

  function selectPaymentType(button) {
    selectChoiceInGroup(button, ".option-pill");
    const logos = document.querySelector("#online-payment-logos");
    const offlineInfo = document.querySelector("#offline-payment-info");
    const submitButton = document.querySelector("#purchase-page-form .primary-btn[type='submit']");
    if (!logos) return;
    const isOnline = button.dataset.paymentType === "online";
    logos.classList.toggle("hidden", !isOnline);
    offlineInfo?.classList.toggle("hidden", isOnline);
    if (submitButton) submitButton.textContent = isOnline ? "在线支付" : "保存";
  }

  function selectPaymentMode(paymentMethod) {
    const button = document.querySelector(`[data-payment-type="${paymentMethod}"]`) || document.querySelector('[data-payment-type="online"]');
    if (button) selectPaymentType(button);
  }

  function resetForm() {
    const form = document.querySelector("#purchase-page-form");
    if (!form) return;
    form.elements.purchaseQuantity.value = "1";
    form.elements.purchaseMonths.value = "1";
    form.elements.couponCode.value = "";
    form.elements.purchaseBillingAddress.value = currentBillingAddress();
    form.elements.purchaseBillingAddress.readOnly = true;
    document.querySelector("#edit-purchase-billing-address").textContent = "编辑";
    document.querySelector("#cancel-purchase-billing-address")?.classList.add("hidden");
    document.querySelector("#coupon-summary")?.classList.add("hidden");
    document.querySelectorAll(".addon-service-row.selected").forEach((row) => row.classList.remove("selected"));
    appliedCoupon = null;
    selectPaymentMode("online");
    hideInlineMessage(document.querySelector("#purchase-page-message"));
  }

  function prefillOrder(order) {
    const form = document.querySelector("#purchase-page-form");
    if (!form) return;
    form.elements.purchaseQuantity.value = String(Math.max(1, Number(order.quantity || 1)));
    form.elements.purchaseMonths.value = String(Math.max(1, Number(order.months || 1)));
    form.elements.purchaseBillingAddress.value = order.billingAddress || currentBillingAddress();
    form.elements.purchaseBillingAddress.readOnly = true;

    document.querySelectorAll(".plan-choice").forEach((choice) => {
      const input = choice.querySelector("input");
      const selected = input?.value === order.planCode;
      choice.classList.toggle("selected", selected);
      if (input) input.checked = selected;
    });
    refreshAddonPrices();
    document.querySelectorAll(".addon-service-row").forEach((row) => {
      row.classList.toggle("selected", (order.addonCodes || []).includes(row.dataset.addonCode));
    });

    appliedCoupon = order.coupon || null;
    form.elements.couponCode.value = appliedCoupon?.couponCode || "";
    const summary = document.querySelector("#coupon-summary");
    if (summary) {
      if (appliedCoupon) {
        summary.classList.remove("hidden");
        summary.dataset.type = "";
        summary.innerHTML = `
          <strong>${formatCouponDiscount(appliedCoupon)}</strong>
          <span>有效期 ${appliedCoupon.validUntil || "-"}</span>
        `;
      } else {
        summary.classList.add("hidden");
      }
    }

    selectPaymentMode(order.paymentMethod || "offline");
    renderDetail();
  }

  async function loadOrderForEdit(orderId, options = {}) {
    const requireEditable = options.requireEditable ?? true;
    const messageNode = document.querySelector("#purchase-page-message");
    try {
      const result = await billingApi.getOrder(orderId);
      if (requireEditable && !result.order?.editable) {
        showInlineMessage(messageNode, "当前订单状态不允许修改。", "error");
        returnToBilling();
        return;
      }
      prefillOrder(result.order);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "读取订单详情失败。", "error");
      returnToBilling();
    }
  }

  async function loadOfflinePaymentAccount() {
    try {
      const result = await billingApi.getOfflinePaymentAccount();
      const account = result.account || {};
      document.querySelectorAll("[data-offline-payment]").forEach((node) => {
        const key = node.dataset.offlinePayment;
        node.textContent = account[key] || "-";
      });
    } catch (error) {
      console.warn("Failed to load offline payment account:", error.message);
    }
  }

  async function loadPaymentMethods() {
    try {
      const result = await billingApi.getPaymentMethods();
      paymentMethods = result.methods || [];
      const logos = document.querySelector("#online-payment-logos");
      if (!logos) return;
      logos.innerHTML = paymentMethods
        .filter((method) => method.methodType === "online")
        .map((method) => {
          const displayName = escapeHtml(method.displayName);
          const logoClass = escapeHtml(method.logoClass);
          if (method.iconUrl) {
            return `<span class="payment-logo with-icon ${logoClass}"><img src="${escapeHtml(method.iconUrl)}" alt="${displayName}" /></span>`;
          }
          return `<span class="payment-logo ${logoClass}">${displayName.replace(" ", "<br />")}</span>`;
        })
        .join("");
    } catch (error) {
      console.warn("Failed to load payment methods:", error.message);
    }
  }

  async function openPurchasePlan(orderId = null, nextMode = "create") {
    mode = nextMode;
    editingOrderId = mode === "edit" && orderId ? Number(orderId) : null;
    sourceOrderId = mode === "repurchase" && orderId ? Number(orderId) : null;
    const title = mode === "edit" ? "修改订单" : mode === "repurchase" ? "重新购买" : titles["purchase-plan"];
    showPurchasePlanView(title);
    resetForm();
    await Promise.all([loadOfflinePaymentAccount(), loadPaymentMethods(), loadPurchaseOptions()]);
    if (mode === "edit" && editingOrderId) await loadOrderForEdit(editingOrderId, { requireEditable: true });
    if (mode === "repurchase" && sourceOrderId) await loadOrderForEdit(sourceOrderId, { requireEditable: false });
  }

  async function submitPurchasePlan(event) {
    event.preventDefault();
    const messageNode = document.querySelector("#purchase-page-message");
    const selectedPayment = document.querySelector("[data-payment-type].selected")?.dataset.paymentType || "online";
    const { selectedPlanCode, quantity, months, selectedAddonCodes, form } = getFormValues();
    try {
      const endpoint =
        mode === "repurchase" && sourceOrderId
          ? `/api/billing/orders/${encodeURIComponent(sourceOrderId)}/repurchase`
          : editingOrderId
            ? `/api/billing/orders/${encodeURIComponent(editingOrderId)}`
            : "/api/billing/orders";
      const result = await billingApi.saveOrder({
        endpoint,
        method: editingOrderId ? "PUT" : "POST",
        payload: {
          planCode: selectedPlanCode,
          quantity,
          months,
          addonCodes: selectedAddonCodes,
          couponCode: form?.elements.couponCode.value.trim().toUpperCase() || "",
          paymentMethod: selectedPayment,
          paymentChannel: selectedPayment === "offline" ? "bank_transfer" : "",
          billingAddress: form?.elements.purchaseBillingAddress.value.trim() || "",
        },
      });
      showInlineMessage(messageNode, result.message || (editingOrderId ? "订单已更新。" : "订单已保存。"), "success");
      if (selectedPayment === "offline") {
        window.alert("订单保存成功，请在付款后及时完成支付凭证上传和提交审核操作！");
        returnToBilling();
        return;
      }
      window.alert("订单已支付，请提交该订单，以便后台完成订单审核。");
      returnToBilling();
    } catch (error) {
      showInlineMessage(messageNode, error.message || (editingOrderId ? "修改订单失败。" : "建立订单失败。"), "error");
    }
  }

  function returnToBilling() {
    editingOrderId = null;
    mode = "create";
    sourceOrderId = null;
    showBillingView(titles.domain);
    loadBillingOrders();
  }

  function toggleAddonService(button) {
    button.classList.toggle("selected");
    renderDetail();
  }

  function stepNumberInput(button) {
    if (stepPurchaseNumberInput(button)) renderDetail();
  }

  function resetCoupon() {
    appliedCoupon = null;
    document.querySelector("#coupon-summary")?.classList.add("hidden");
  }

  return {
    applyCouponCode,
    cancelPurchaseBillingAddressEdit,
    confirmSyncBillingAddress,
    editPurchaseBillingAddress,
    getFormValues,
    openPurchasePlan,
    refreshAddonPrices,
    renderDetail,
    resetCoupon,
    returnToBilling,
    scrollPurchasePlans,
    selectChoiceInGroup,
    selectPaymentType,
    stepNumberInput,
    submitPurchasePlan,
    syncPurchaseBillingAddress,
    toggleAddonService,
  };
}
