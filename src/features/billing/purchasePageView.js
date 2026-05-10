export function showPurchasePlanView(title) {
  document.querySelector(".main")?.classList.add("purchase-mode");
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector("#purchase-plan")?.classList.add("active");
  const pageTitle = document.querySelector("#page-title");
  if (pageTitle) pageTitle.textContent = title;
  document.querySelector("#open-create-user")?.classList.add("hidden");
  document.querySelector("#open-purchase-plan")?.classList.add("hidden");
  document.querySelector("#back-to-billing-top")?.classList.remove("hidden");
}

export function showBillingView(title) {
  document.querySelector(".main")?.classList.remove("purchase-mode");
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector("#domain")?.classList.add("active");
  const pageTitle = document.querySelector("#page-title");
  if (pageTitle) pageTitle.textContent = title;
  document.querySelector("#open-create-user")?.classList.add("hidden");
  document.querySelector("#open-purchase-plan")?.classList.remove("hidden");
  document.querySelector("#back-to-billing-top")?.classList.add("hidden");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.querySelector('.nav-item[data-view="domain"]')?.classList.add("active");
}

export function scrollPurchasePlans(direction) {
  const rail = document.querySelector("#purchase-plan-options");
  if (!rail) return;
  rail.scrollBy({ left: direction * 244, behavior: "smooth" });
}

export function selectChoiceInGroup(target, selector) {
  const group = target.closest(selector);
  if (!group) return false;
  group.parentElement.querySelectorAll(selector).forEach((item) => item.classList.remove("selected"));
  group.classList.add("selected");
  const input = group.querySelector("input");
  if (input) input.checked = true;
  return true;
}

export function stepPurchaseNumberInput(button) {
  const form = document.querySelector("#purchase-page-form");
  const input = form?.elements[button.dataset.stepTarget];
  if (!input) return false;
  const step = Number(button.dataset.step || 0);
  const min = Number(input.min || 1);
  const nextValue = Math.max(min, Number(input.value || min) + step);
  input.value = String(nextValue);
  return true;
}
