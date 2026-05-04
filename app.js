export function initPrototype() {
const appConfig = window.QRTALKIE_CONFIG || {};
const sipDomain = appConfig.SIP_DOMAIN || "sip.qrtalkie.org";

const users = [
  { name: "Alice Chen", username: "alice", status: "online", devices: "2 台", lastSeen: "1 分鐘前" },
  { name: "Bob Li", username: "bob", status: "online", devices: "1 台", lastSeen: "4 分鐘前" },
  { name: "Support Desk", username: "support", status: "failed", devices: "0 台", lastSeen: "密碼錯誤" },
  { name: "Nina Wang", username: "nina", status: "offline", devices: "0 台", lastSeen: "昨天 18:42" },
];

const registrations = [
  { username: "alice", contact: "sip:alice@10.10.2.14:5060", agent: "Linphone iOS 5.3", transport: "TLS", expires: "3580 秒", state: "online" },
  { username: "bob", contact: "sip:bob@198.51.100.18:7443", agent: "WebRTC Client", transport: "WSS", expires: "1210 秒", state: "online" },
  { username: "support", contact: "203.0.113.42", agent: "Zoiper 5", transport: "TCP", expires: "403 Forbidden", state: "failed" },
];

const titles = {
  dashboard: "控制台",
  users: "SIP 使用者",
  registrations: "註冊狀態",
  domain: "域名設定",
  tenant: "租戶設定",
};

function sipUri(username) {
  return `sip:${username}@${sipDomain}`;
}

function applySipDomain() {
  document.querySelectorAll("[data-sip-domain]").forEach((node) => {
    node.textContent = sipDomain;
  });

  const tenantDomainInput = document.querySelector("#tenant-sip-domain");
  if (tenantDomainInput) tenantDomainInput.value = sipDomain;

  const sipUriInput = document.querySelector("#sip-uri");
  if (sipUriInput) sipUriInput.value = sipUri("alice");

  const sipDomainSelect = document.querySelector("#sip-domain-select");
  if (sipDomainSelect) {
    sipDomainSelect.innerHTML = `<option>${sipDomain}</option>`;
  }
}

function setAuthMode(mode) {
  document.querySelectorAll(".auth-tabs button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.mode === mode);
  });
  document.querySelectorAll(".auth-form").forEach((form) => form.classList.remove("active"));
  document.querySelector(`#${mode}-form`).classList.add("active");
}

function enterConsole() {
  document.querySelector("#landing").classList.add("hidden");
  document.querySelector("#console").classList.remove("hidden");
}

function statusLabel(status) {
  if (status === "online") return "線上";
  if (status === "failed") return "失敗";
  return "離線";
}

function renderUsers() {
  const tbody = document.querySelector("#user-table");
  tbody.innerHTML = users
    .map(
      (user) => `
        <tr>
          <td>
            <div class="user-cell">
              <span class="avatar">${user.name.slice(0, 1)}</span>
              <div><strong>${user.name}</strong><br><small>${user.username}</small></div>
            </div>
          </td>
          <td>${sipUri(user.username)}</td>
          <td><span class="status ${user.status}">${statusLabel(user.status)}</span></td>
          <td>${user.devices}</td>
          <td>${user.lastSeen}</td>
          <td><button class="ghost-btn">詳情</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderRegistrations() {
  const list = document.querySelector("#registration-list");
  list.innerHTML = registrations
    .map(
      (item) => `
        <article class="registration-card">
          <div><strong>${item.username}@${sipDomain}</strong><span>${item.contact}</span></div>
          <div><strong>${item.agent}</strong><span>${item.transport}</span></div>
          <div><small>到期/結果</small><strong>${item.expires}</strong></div>
          <button class="ghost-btn">${item.state === "online" ? "強制登出" : "查看日誌"}</button>
        </article>
      `,
    )
    .join("");
}

document.querySelectorAll("[data-auth]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.auth));
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.mode));
});

document.querySelectorAll("#enter-console, #signup-enter").forEach((button) => {
  button.addEventListener("click", enterConsole);
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    const viewName = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${viewName}`).classList.add("active");
    document.querySelector("#page-title").textContent = titles[viewName];
  });
});

const createDialog = document.querySelector("#create-user-dialog");
document.querySelectorAll("#open-create-user, #open-create-user-2").forEach((button) => {
  button.addEventListener("click", () => createDialog.showModal());
});

document.querySelectorAll(".dialog-close").forEach((button) => {
  button.addEventListener("click", () => {
    button.closest("dialog").close();
  });
});

document.querySelector("#new-username").addEventListener("input", (event) => {
  const clean = event.target.value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  document.querySelector("#sip-uri").value = sipUri(clean || "alice");
});

applySipDomain();
renderUsers();
renderRegistrations();
}
