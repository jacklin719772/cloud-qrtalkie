export function bindPrototypeEvents({
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
  resetCoupon,
  editPurchaseBillingAddress,
  cancelPurchaseBillingAddressEdit,
  confirmSyncBillingAddress,
  applyCouponCode,
  showFloatingOrderMenu,
  handleOrderActionButton,
  hideFloatingOrderMenu,
  updateBillingPage,
  openLegalDialog,
  handleConsoleNavigation,
  handleCreateUserDialog,
  choosePaymentProofFile,
  handlePaymentProofFile,
  clearPaymentProof,
  submitPaymentProof,
  handlePaymentProofPaste,
  handlePaymentProofDrag,
  handlePaymentProofDrop,
  updateSipUriPreview,
}) {
  document.querySelectorAll("[data-auth]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.auth));
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.mode));
  });

  document.querySelector("#enter-console")?.addEventListener("click", handleLogin);
  document.querySelector("#signup-enter")?.addEventListener("click", handleSignup);
  document.querySelector("#tenant-settings-form")?.addEventListener("submit", saveTenantSettings);
  document.querySelector("#cancel-tenant-settings")?.addEventListener("click", resetTenantSettings);
  document.querySelector("#open-login-email-dialog")?.addEventListener("click", openLoginEmailDialog);
  document.querySelector("#send-login-email-code")?.addEventListener("click", sendLoginEmailCode);
  document.querySelector("#login-email-change-form")?.addEventListener("submit", confirmLoginEmailChange);
  document.querySelector("#logout-system")?.addEventListener("click", handleLogout);
  document.querySelector("#open-purchase-plan")?.addEventListener("click", () => openPurchasePlanDialog());
  document.querySelector("#purchase-page-form")?.addEventListener("submit", submitPurchasePlan);
  document.querySelector("#back-to-billing-top")?.addEventListener("click", returnToBilling);
  document.querySelector("#cancel-purchase-page")?.addEventListener("click", returnToBilling);

  document.querySelectorAll("[data-plan-scroll]").forEach((button) => {
    button.addEventListener("click", () => scrollPurchasePlans(Number(button.dataset.planScroll)));
  });
  document.querySelector("#purchase-plan-options")?.addEventListener("click", (event) => {
    const choice = event.target.closest(".plan-choice");
    if (!choice) return;
    selectChoiceInGroup(choice, ".plan-choice");
    refreshAddonPricesForSelectedPlan();
    renderBillingDetail();
  });
  document.querySelector(".addon-service-list")?.addEventListener("click", (event) => {
    const button = event.target.closest(".addon-service-row");
    if (button) toggleAddonService(button);
  });
  document.querySelectorAll(".option-pill").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.currentTarget.dataset.paymentType) {
        selectPaymentType(event.currentTarget);
        return;
      }
      selectChoiceInGroup(event.currentTarget, ".option-pill");
    });
  });
  document.querySelectorAll("[data-step-target]").forEach((button) => {
    button.addEventListener("click", (event) => stepNumberInput(event.currentTarget));
  });
  document.querySelectorAll("input[name='purchaseQuantity'], input[name='purchaseMonths']").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = String(Math.max(1, Number(input.value || 1)));
      renderBillingDetail();
    });
  });
  document.querySelector("input[name='couponCode']")?.addEventListener("input", () => {
    resetCoupon();
    renderBillingDetail();
  });

  document.querySelector("#edit-purchase-billing-address")?.addEventListener("click", editPurchaseBillingAddress);
  document.querySelector("#cancel-purchase-billing-address")?.addEventListener("click", cancelPurchaseBillingAddressEdit);
  document.querySelector("#confirm-sync-billing-address")?.addEventListener("click", confirmSyncBillingAddress);
  document.querySelector("#apply-coupon-code")?.addEventListener("click", applyCouponCode);

  document.querySelector("#billing-order-table")?.addEventListener("click", (event) => {
    const moreButton = event.target.closest("[data-order-more]");
    if (moreButton) {
      event.stopPropagation();
      showFloatingOrderMenu(moreButton);
      return;
    }
    const button = event.target.closest("[data-order-action]");
    if (button) handleOrderActionButton(button);
  });
  document.querySelector("#floating-order-menu")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-order-action]");
    if (button) handleOrderActionButton(button);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#floating-order-menu") || event.target.closest("[data-order-more]")) return;
    hideFloatingOrderMenu();
  });
  window.addEventListener("scroll", hideFloatingOrderMenu, true);
  document.querySelector("#billing-prev-page")?.addEventListener("click", () => updateBillingPage(-1));
  document.querySelector("#billing-next-page")?.addEventListener("click", () => updateBillingPage(1));

  document.querySelectorAll("[data-legal]").forEach((button) => {
    button.addEventListener("click", () => openLegalDialog(button.dataset.legal));
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => handleConsoleNavigation(button));
  });

  document.querySelectorAll("#open-create-user, #open-create-user-2").forEach((button) => {
    button.addEventListener("click", handleCreateUserDialog);
  });
  document.querySelectorAll(".dialog-close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  document.querySelector("#choose-payment-proof")?.addEventListener("click", choosePaymentProofFile);
  document.querySelector("#payment-proof-file")?.addEventListener("change", (event) => {
    handlePaymentProofFile(event.target.files?.[0]);
  });
  document.querySelector("#clear-payment-proof")?.addEventListener("click", clearPaymentProof);
  document.querySelector("#payment-proof-form")?.addEventListener("submit", submitPaymentProof);
  const proofUploadArea = document.querySelector("#proof-upload-area");
  proofUploadArea?.addEventListener("paste", handlePaymentProofPaste);
  proofUploadArea?.addEventListener("dragenter", handlePaymentProofDrag);
  proofUploadArea?.addEventListener("dragover", handlePaymentProofDrag);
  proofUploadArea?.addEventListener("dragleave", handlePaymentProofDrag);
  proofUploadArea?.addEventListener("drop", handlePaymentProofDrop);
  document.addEventListener("paste", handlePaymentProofPaste);
  document.querySelector("#new-username")?.addEventListener("input", updateSipUriPreview);
}
