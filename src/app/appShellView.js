import { formatSipUri } from "../core/formatters.js";

export function showConsole() {
  document.querySelector("#landing").classList.add("hidden");
  document.querySelector("#console").classList.remove("hidden");
}

export function showLanding() {
  document.querySelector("#console").classList.add("hidden");
  document.querySelector("#landing").classList.remove("hidden");
}

export function applySipDomain(sipDomain) {
  document.querySelectorAll("[data-sip-domain]").forEach((node) => {
    node.textContent = sipDomain;
  });
  const tenantDomainInput = document.querySelector("#tenant-sip-domain");
  if (tenantDomainInput) tenantDomainInput.value = sipDomain;
  const sipUriInput = document.querySelector("#sip-uri");
  if (sipUriInput) sipUriInput.value = formatSipUri("alice", sipDomain);
  const sipDomainSelect = document.querySelector("#sip-domain-select");
  if (sipDomainSelect) sipDomainSelect.innerHTML = `<option>${sipDomain}</option>`;
}

export function switchConsoleView({ button, titles }) {
  const viewName = button.dataset.view;
  if (!viewName) return "";

  document.querySelector(".main")?.classList.remove("purchase-mode");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  button.classList.add("active");
  document.querySelector(`#${viewName}`).classList.add("active");
  document.querySelector("#page-title").textContent = titles[viewName];
  document.querySelector("#open-create-user").classList.toggle("hidden", viewName === "tenant" || viewName === "domain");
  document.querySelector("#open-purchase-plan").classList.toggle("hidden", viewName !== "domain");
  document.querySelector("#back-to-billing-top").classList.add("hidden");

  return viewName;
}
