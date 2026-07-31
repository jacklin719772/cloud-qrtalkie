import { formatCouponDiscount, formatMoney } from "../../core/formatters.js";
import { planFeatureLabels } from "../../data/prototypeData.js";

export function getPurchaseFormValues(catalog) {
  const form = document.querySelector("#purchase-page-form");
  const selectedPlanCode = form?.elements.planCode?.value || catalog.plans[0]?.planCode || "";
  const quantity = Math.max(1, Number(form?.elements.purchaseQuantity?.value || 1));
  const months = Math.max(1, Number(form?.elements.purchaseMonths?.value || 1));
  const selectedAddonCodes = Array.from(document.querySelectorAll(".addon-service-row.selected")).map((node) => node.dataset.addonCode);
  return { form, selectedPlanCode, quantity, months, selectedAddonCodes };
}

export function calculateBillingDetail(catalog, appliedCoupon) {
  const { selectedPlanCode, quantity, months, selectedAddonCodes } = getPurchaseFormValues(catalog);
  const plan = catalog.plans.find((item) => item.planCode === selectedPlanCode) || catalog.plans[0];
  const currency = plan?.currency || "USD";
  const rows = [];
  let subtotal = 0;

  if (plan) {
    const amount = Number(plan.unitPrice) * quantity * months;
    subtotal += amount;
    rows.push({
      no: rows.length + 1,
      name: `${plan.name} 套餐`,
      formula: `${formatMoney(plan.unitPrice, currency)} x ${quantity}份 x ${months}月`,
      amount,
      currency,
    });
  }

  selectedAddonCodes.forEach((addonCode) => {
    const addon = catalog.addons.find((item) => item.addonCode === addonCode && (!plan || item.planId === plan.id));
    if (!addon) return;
    const amount = Number(addon.unitPrice) * quantity * months;
    subtotal += amount;
    rows.push({
      no: rows.length + 1,
      name: addon.name,
      formula: `${formatMoney(addon.unitPrice, addon.currency || currency)} x ${quantity}份 x ${months}月`,
      amount,
      currency: addon.currency || currency,
    });
  });

  let discountAmount = 0;
  if (appliedCoupon) {
    if (appliedCoupon.discountType === "percent") discountAmount = subtotal * (Number(appliedCoupon.discountValue || 0) / 100);
    if (appliedCoupon.discountType === "fixed_amount") discountAmount = Math.min(subtotal, Number(appliedCoupon.discountValue || 0));
  }

  return { rows, subtotal, discountAmount, payableAmount: Math.max(0, subtotal - discountAmount), currency };
}

export function renderBillingDetail(catalog, appliedCoupon) {
  const table = document.querySelector(".billing-detail-table");
  const total = document.querySelector(".billing-detail-total strong");
  const currencyNode = document.querySelector(".billing-detail-head span");
  if (!table || !total) return;

  const detail = calculateBillingDetail(catalog, appliedCoupon);
  if (currencyNode) currencyNode.textContent = detail.currency;

  const header = `
    <div class="billing-detail-row billing-detail-header">
      <span>序號</span><span>專案</span><span>計算公式</span><span>金額</span>
    </div>
  `;
  const rows = detail.rows
    .map(
      (row) => `
        <div class="billing-detail-row">
          <span>${row.no}</span>
          <strong>${row.name}</strong>
          <span>${row.formula}</span>
          <b>${formatMoney(row.amount, row.currency)}</b>
        </div>
      `,
    )
    .join("");
  const discountRow = appliedCoupon
    ? `
      <div class="billing-detail-row discount">
        <span>-</span>
        <strong>優惠折扣</strong>
        <span>${appliedCoupon.couponCode}：${formatCouponDiscount(appliedCoupon)}</span>
        <b>- ${formatMoney(detail.discountAmount, detail.currency)}</b>
      </div>
    `
    : "";

  table.innerHTML = `${header}${rows}${discountRow}`;
  total.textContent = formatMoney(detail.payableAmount, detail.currency);
}

export function refreshAddonPricesForSelectedPlan(catalog, appliedCoupon) {
  const addonsNode = document.querySelector(".addon-service-list");
  if (!addonsNode) return;

  const { selectedPlanCode, selectedAddonCodes } = getPurchaseFormValues(catalog);
  const plan = catalog.plans.find((item) => item.planCode === selectedPlanCode) || catalog.plans[0];
  const addonCodes = [...new Set(catalog.addons.map((addon) => addon.addonCode))];

  addonsNode.innerHTML = addonCodes
    .map((addonCode) => {
      const addon = catalog.addons.find((item) => item.addonCode === addonCode && (!plan || item.planId === plan.id));
      if (!addon) return "";
      return `
        <button class="addon-service-row${selectedAddonCodes.includes(addonCode) ? " selected" : ""}" type="button" data-addon-code="${addon.addonCode}">
          <span>${addon.name}</span>
          <strong>${formatMoney(addon.unitPrice, addon.currency)} / 服務 / 月</strong>
        </button>
      `;
    })
    .join("");

  renderBillingDetail(catalog, appliedCoupon);
}

export function renderPurchaseCatalog(catalog, appliedCoupon) {
  const plansNode = document.querySelector("#purchase-plan-options");
  if (!plansNode) return;

  plansNode.innerHTML = catalog.plans
    .map(
      (plan, index) => `
        <label class="plan-choice${index === 0 ? " selected" : ""}">
          <input type="radio" name="planCode" value="${plan.planCode}" ${index === 0 ? "checked" : ""} />
          <strong>${plan.name}</strong>
          <span><i>$</i>${Number(plan.unitPrice).toFixed(2)}</span>
          <small>每月</small>
          <em>${plan.accountQuantity} 個賬號</em>
          <b>${planFeatureLabels[plan.planCode] || plan.featureSummary || ""}</b>
        </label>
      `,
    )
    .join("");

  refreshAddonPricesForSelectedPlan(catalog, appliedCoupon);
}
