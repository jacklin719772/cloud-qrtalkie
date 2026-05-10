import { orderStatusLabel, packageStatus, paymentMethodLabel, termLabel } from "../../core/formatters.js";
import { getBillingOrderMenuActions } from "./billingOrderActions.js";

export function renderBillingOrdersView({ orders, page, pageSize }) {
  const tbody = document.querySelector("#billing-order-table");
  if (!tbody) return page;

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const normalizedPage = Math.min(Math.max(1, page), totalPages);
  const start = (normalizedPage - 1) * pageSize;
  const pageOrders = orders.slice(start, start + pageSize);
  const info = document.querySelector("#billing-pagination-info");
  const pageNumber = document.querySelector("#billing-page-number");
  const prevButton = document.querySelector("#billing-prev-page");
  const nextButton = document.querySelector("#billing-next-page");

  if (info) info.textContent = `共 ${orders.length} 笔`;
  if (pageNumber) pageNumber.textContent = `${normalizedPage} / ${totalPages}`;
  if (prevButton) prevButton.disabled = normalizedPage <= 1;
  if (nextButton) nextButton.disabled = normalizedPage >= totalPages;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-cell">暂无订单</td></tr>`;
    hideFloatingOrderMenu();
    return normalizedPage;
  }

  tbody.innerHTML = pageOrders
    .map((order) => {
      const pkgStatus = packageStatus(order);
      const menuActions = getBillingOrderMenuActions(order);

      return `
        <tr>
          <td><strong>${order.planName}</strong><small>${order.orderNo}</small></td>
          <td><span class="status ${order.orderStatus === "review_rejected" || order.orderStatus === "cancelled" ? "failed" : "pending"}">${orderStatusLabel(order.orderStatus)}</span></td>
          <td>${order.accountQuantity || "-"}</td>
          <td>${order.addonNames || "-"}</td>
          <td>${termLabel(order.months)}</td>
          <td>${order.effectiveAt || "-"}</td>
          <td>${order.expiresAt || "-"}</td>
          <td><span class="status ${pkgStatus.className}">${pkgStatus.label}</span></td>
          <td>${paymentMethodLabel(order)}</td>
          <td>${order.paymentDate || "-"}</td>
          <td>
            <div class="row-actions">
              <button class="ghost-btn" type="button" data-order-action="detail" data-order-id="${order.id}">查看详情</button>
              <button class="ghost-btn more-trigger" type="button" data-order-more data-order-id="${order.id}" data-menu-actions='${JSON.stringify(menuActions)}'>更多</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  hideFloatingOrderMenu();
  return normalizedPage;
}

export function hideFloatingOrderMenu() {
  const menu = document.querySelector("#floating-order-menu");
  if (!menu) return;
  menu.classList.add("hidden");
  menu.innerHTML = "";
}

export function showFloatingOrderMenu(trigger) {
  const menu = document.querySelector("#floating-order-menu");
  if (!menu) return;
  const actions = JSON.parse(trigger.dataset.menuActions || "[]");
  const orderId = trigger.dataset.orderId;
  const rect = trigger.getBoundingClientRect();

  menu.innerHTML = actions
    .map((item) => `<button type="button" data-order-action="${item.action}" data-order-id="${orderId}" ${item.disabled ? "disabled" : ""}>${item.label}</button>`)
    .join("");
  menu.style.left = `${Math.max(8, rect.right - 150)}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.classList.remove("hidden");
}
