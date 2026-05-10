import { createApiClient } from "./src/core/api.js";
import { formatSipUri } from "./src/core/formatters.js";
import { createMessageController } from "./src/core/messages.js";
import { createSessionStore } from "./src/core/session.js";
import { applySipDomain as applySipDomainView, showConsole, showLanding, switchConsoleView } from "./src/app/appShellView.js";
import { bindPrototypeEvents as bindPrototypeEventsView } from "./src/app/prototypeEvents.js";
import { pageTitles, prototypeRegistrations, prototypeUsers } from "./src/data/prototypeData.js";
import { createAuthApi } from "./src/features/auth/authApi.js";
import { createAuthController } from "./src/features/auth/authController.js";
import { createBillingApi } from "./src/features/billing/billingApi.js";
import { hideFloatingOrderMenu, showFloatingOrderMenu } from "./src/features/billing/billingOrdersView.js";
import { createBillingOrdersController } from "./src/features/billing/billingOrdersController.js";
import { createPurchaseController } from "./src/features/billing/purchaseController.js";
import { createTenantApi } from "./src/features/tenant/tenantApi.js";
import { renderRegistrations as renderRegistrationsView, renderUsers as renderUsersView } from "./src/features/prototype/prototypeListsView.js";
import { setTenantForm as setTenantFormView } from "./src/features/tenant/tenantView.js";
import { createTenantController } from "./src/features/tenant/tenantController.js";

export function initPrototype() {
  if (window.__QRTALKIE_PROTOTYPE_INITIALIZED__) return;
  window.__QRTALKIE_PROTOTYPE_INITIALIZED__ = true;

  const appConfig = window.QRTALKIE_CONFIG || {};
  const sipDomain = appConfig.SIP_DOMAIN || "sip.qrtalkie.org";
  const apiBaseUrl = appConfig.API_BASE_URL || "http://127.0.0.1:3001";
  const sessionStorageKey = "qrtalkieAdminToken";
  const { getAuthToken, setAuthToken } = createSessionStore(sessionStorageKey);
  const { apiFetch } = createApiClient({ apiBaseUrl, getAuthToken });
  const { hideInlineMessage, showInlineMessage, showAuthMessage } = createMessageController();
  const authApi = createAuthApi({ apiBaseUrl, apiFetch });
  const billingApi = createBillingApi({ apiBaseUrl, apiFetch, getAuthToken });
  const tenantApi = createTenantApi(apiFetch);
  let tenantSnapshot = null;
  const billingPageSize = 10;
  const users = prototypeUsers;
  const registrations = prototypeRegistrations;
  const titles = pageTitles;
  const authController = createAuthController({
    authApi,
    enterConsole,
    returnToLogin,
    setAuthToken,
    showAuthMessage,
  });
  const tenantController = createTenantController({
    getTenantSnapshot: () => tenantSnapshot,
    hideInlineMessage,
    loadTenantSettings,
    setAuthToken,
    setTenantForm,
    showInlineMessage,
    tenantApi,
  });
  const billingOrdersController = createBillingOrdersController({
    apiBaseUrl,
    billingApi,
    hideInlineMessage,
    pageSize: billingPageSize,
    showInlineMessage,
  });
  const purchaseController = createPurchaseController({
    billingApi,
    getTenantSnapshot: () => tenantSnapshot,
    hideInlineMessage,
    loadBillingOrders,
    loadTenantSettings,
    showInlineMessage,
    tenantApi,
    titles,
  });

  function sipUri(username) {
    return formatSipUri(username, sipDomain);
  }

  function setAuthMode(mode) {
    authController.setAuthMode(mode);
  }
  async function enterConsole() {
    showConsole();
    await loadTenantSettings();
    await loadBillingOrders();
  }

  function returnToLogin() {
    showLanding();
    setAuthMode("login");
    tenantSnapshot = null;
  }

  function applySipDomain() {
    applySipDomainView(sipDomain);
  }
  async function handleSignup() {
    return authController.handleSignup();
  }
  async function handleLogin() {
    return authController.handleLogin();
  }
  function openLegalDialog(type) {
    authController.openLegalDialog(type);
  }
  async function verifyEmailFromUrl() {
    return authController.verifyEmailFromUrl();
  }
  function setTenantForm(data) {
    setTenantFormView(data, sipDomain);
    syncPurchaseBillingAddress();
  }

  function syncPurchaseBillingAddress() {
    purchaseController.syncPurchaseBillingAddress();
  }
  function toggleAddonService(button) {
    purchaseController.toggleAddonService(button);
  }

  function editPurchaseBillingAddress() {
    purchaseController.editPurchaseBillingAddress();
  }

  function cancelPurchaseBillingAddressEdit() {
    purchaseController.cancelPurchaseBillingAddressEdit();
  }

  async function confirmSyncBillingAddress() {
    return purchaseController.confirmSyncBillingAddress();
  }

  function getPurchaseFormValues() {
    return purchaseController.getFormValues();
  }

  function renderBillingDetail() {
    purchaseController.renderDetail();
  }

  function refreshAddonPricesForSelectedPlan() {
    purchaseController.refreshAddonPrices();
  }

  async function applyCouponCode() {
    return purchaseController.applyCouponCode();
  }

  function selectPaymentType(button) {
    purchaseController.selectPaymentType(button);
  }

  async function loadTenantSettings() {
    const messageNode = document.querySelector("#tenant-message");
    try {
      tenantSnapshot = await authApi.getCurrentUser();
      setTenantForm(tenantSnapshot);
      hideInlineMessage(messageNode);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "无法读取租户资料。", "error");
    }
  }

  async function loadBillingOrders() {
    return billingOrdersController.loadOrders();
  }

  async function deleteBillingOrder(orderId) {
    return billingOrdersController.deleteOrder(orderId);
  }

  async function openPaymentProofDialog(orderId) {
    return billingOrdersController.openPaymentProofDialog(orderId);
  }

  async function handlePaymentProofFile(file) {
    return billingOrdersController.handlePaymentProofFile(file);
  }

  function handlePaymentProofPaste(event) {
    billingOrdersController.handlePaymentProofPaste(event);
  }

  function handlePaymentProofDrag(event) {
    billingOrdersController.handlePaymentProofDrag(event);
  }

  function handlePaymentProofDrop(event) {
    billingOrdersController.handlePaymentProofDrop(event);
  }

  async function submitPaymentProof(event) {
    return billingOrdersController.submitPaymentProof(event);
  }

  async function updateOrderReviewSubmission(orderId, action) {
    return billingOrdersController.updateReviewSubmission(orderId, action);
  }

  async function saveTenantSettings(event) {
    return tenantController.saveTenantSettings(event);
  }

  function resetTenantSettings() {
    tenantController.resetTenantSettings();
  }

  function openLoginEmailDialog() {
    tenantController.showLoginEmailDialog();
  }
  async function sendLoginEmailCode() {
    return tenantController.sendLoginEmailCode();
  }

  async function confirmLoginEmailChange(event) {
    return tenantController.confirmLoginEmailChange(event);
  }

  async function handleLogout() {
    return authController.handleLogout();
  }

  async function openPurchasePlanDialog(orderId = null, mode = "create") {
    return purchaseController.openPurchasePlan(orderId, mode);
  }

  async function submitPurchasePlan(event) {
    return purchaseController.submitPurchasePlan(event);
  }

  function returnToBilling() {
    purchaseController.returnToBilling();
  }

  function scrollPurchasePlans(direction) {
    purchaseController.scrollPurchasePlans(direction);
  }

  function selectChoiceInGroup(target, selector) {
    return purchaseController.selectChoiceInGroup(target, selector);
  }

  function stepNumberInput(button) {
    purchaseController.stepNumberInput(button);
  }

  function renderUsers() {
    renderUsersView({ users, sipUri });
  }

  function renderRegistrations() {
    renderRegistrationsView({ registrations, sipDomain });
  }

  function handleOrderActionButton(button) {
    if (!button || button.disabled) return;
    hideFloatingOrderMenu();
    const action = button.dataset.orderAction;
    const orderId = button.dataset.orderId;
    if (action === "edit") {
      openPurchasePlanDialog(orderId, "edit");
      return;
    }
    if (action === "repurchase") {
      openPurchasePlanDialog(orderId, "repurchase");
      return;
    }
    if (action === "delete") {
      deleteBillingOrder(orderId);
      return;
    }
    if (action === "upload-proof") {
      openPaymentProofDialog(orderId);
      return;
    }
    if (action === "submit-review") {
      updateOrderReviewSubmission(orderId, "submit");
      return;
    }
    if (action === "revoke-review") {
      updateOrderReviewSubmission(orderId, "revoke");
      return;
    }
    const messageNode = document.querySelector("#billing-message") || document.querySelector("#purchase-page-message") || document.querySelector("#tenant-message");
    const actionLabels = {
      detail: "订单详情正在建设中.....",
      "upload-proof": "支付凭证正在建设中.....",
      "payment-info": "付款资讯正在建设中.....",
      renew: "续订正在建设中.....",
      repurchase: "重新购买正在建设中.....",
      delete: "订单删除正在建设中.....",
    };
    showInlineMessage(messageNode, actionLabels[action] || "正在建设中.....", "info");
  }

  function bindPrototypeEvents() {
    bindPrototypeEventsView({
      setAuthMode,
      handleLogin,
      handleSignup,
      saveTenantSettings,
      resetTenantSettings,
      openLoginEmailDialog,
      sendLoginEmailCode,
      confirmLoginEmailChange,
      handleLogout,
      openPurchasePlanDialog,
      submitPurchasePlan,
      returnToBilling,
      scrollPurchasePlans,
      selectChoiceInGroup,
      refreshAddonPricesForSelectedPlan,
      renderBillingDetail,
      toggleAddonService,
      selectPaymentType,
      stepNumberInput,
      resetCoupon: purchaseController.resetCoupon,
      editPurchaseBillingAddress,
      cancelPurchaseBillingAddressEdit,
      confirmSyncBillingAddress,
      applyCouponCode,
      showFloatingOrderMenu,
      handleOrderActionButton,
      hideFloatingOrderMenu,
      updateBillingPage: (delta) => {
        billingOrdersController.updatePage(delta);
      },
      openLegalDialog,
      handleConsoleNavigation: (button) => {
        const viewName = switchConsoleView({ button, titles });
        if (viewName === "domain") loadBillingOrders();
      },
      handleCreateUserDialog: () => document.querySelector("#create-user-dialog")?.showModal(),
      choosePaymentProofFile: () => document.querySelector("#payment-proof-file")?.click(),
      handlePaymentProofFile,
      clearPaymentProof: billingOrdersController.clearProofFromEvent,
      submitPaymentProof,
      handlePaymentProofPaste,
      handlePaymentProofDrag,
      handlePaymentProofDrop,
      updateSipUriPreview: (event) => {
        const clean = event.target.value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
        const sipUriInput = document.querySelector("#sip-uri");
        if (sipUriInput) sipUriInput.value = sipUri(clean || "alice");
      },
    });
  }

  bindPrototypeEvents();
  applySipDomain();
  renderUsers();
  renderRegistrations();
  verifyEmailFromUrl();
  if (getAuthToken()) enterConsole().catch(() => setAuthToken(""));
}
