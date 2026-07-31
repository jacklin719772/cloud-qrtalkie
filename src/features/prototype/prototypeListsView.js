import { statusLabel } from "../../core/formatters.js";

export function renderUsers({ users, sipUri }) {
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

export function renderRegistrations({ registrations, sipDomain }) {
  const list = document.querySelector("#registration-list");
  list.innerHTML = registrations
    .map(
      (item) => `
        <article class="registration-card">
          <div><strong>${item.username}@${sipDomain}</strong><span>${item.contact}</span></div>
          <div><strong>${item.agent}</strong><span>${item.transport}</span></div>
          <div><small>到期/狀態</small><strong>${item.expires}</strong></div>
          <button class="ghost-btn">${item.state === "online" ? "立即登出" : "查看日志"}</button>
        </article>
      `,
    )
    .join("");
}
