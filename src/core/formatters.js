export function formatCouponDiscount(coupon) {
  if (coupon.discountType === "percent") return `${coupon.discountValue}% 折扣`;
  if (coupon.discountType === "fixed_amount") return `减免 USD ${Number(coupon.discountValue).toFixed(2)}`;
  return String(coupon.discountValue);
}

export function formatMoney(amount, currency = "USD") {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

export function todayDateValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function formatSipUri(username, sipDomain) {
  return `sip:${username}@${sipDomain}`;
}

export function orderStatusLabel(status) {
  const labels = {
    draft: "草稿",
    pending_payment: "未支付",
    payment_submitted: "已支付",
    pending_review: "已提交",
    review_approved: "通过审核",
    review_rejected: "未通过审核",
    cancelled: "已取消",
  };
  return labels[status] || status || "-";
}

export function packageStatus(order) {
  if (order.orderStatus !== "review_approved") return { label: "未生效", className: "pending" };
  const today = new Date();
  const start = order.effectiveAt ? new Date(`${order.effectiveAt}T00:00:00`) : null;
  const end = order.expiresAt ? new Date(`${order.expiresAt}T23:59:59`) : null;
  if (start && today < start) return { label: "未生效", className: "pending" };
  if (end && today > end) return { label: "已过期", className: "expired" };
  if (end && end.getTime() - today.getTime() <= 30 * 24 * 60 * 60 * 1000) return { label: "即将过期", className: "expiring" };
  return { label: "生效中", className: "online" };
}

export function paymentMethodLabel(order) {
  if (order.paymentMethod === "offline") return "线下支付";
  if (order.paymentMethod === "online") return order.paymentChannel ? `线上支付 / ${order.paymentChannel}` : "线上支付";
  return "-";
}

export function termLabel(months) {
  if (months === 12) return "一年";
  if (months === 6) return "半年";
  return months ? `${months} 个月` : "-";
}

export function statusLabel(status) {
  if (status === "online") return "在线";
  if (status === "failed") return "失败";
  return "离线";
}
