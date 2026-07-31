export function formatCouponDiscount(coupon) {
  if (coupon.discountType === "percent") return `${coupon.discountValue}% 折扣`;
  if (coupon.discountType === "fixed_amount") return `減免 USD ${Number(coupon.discountValue).toFixed(2)}`;
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
  if (status === "pending_review") return "待稽核";
  if (status === "review_approved") return "已生效";
  if (status === "cancelled") return "已取消";
  return "未生效";
}
export function packageStatus(order) {
  if (order.orderStatus !== "review_approved") return { label: "未生效", className: "pending" };
  const today = new Date();
  const end = order.expiresAt ? new Date(`${order.expiresAt}T23:59:59`) : null;
  if (end && today > end) return { label: "過期", className: "expired" };
  if (end && end.getTime() - today.getTime() <= 30 * 24 * 60 * 60 * 1000) return { label: "即將過期", className: "expiring" };
  return { label: "已生效", className: "online" };
}
export function paymentMethodLabel(order) {
  if (order.paymentMethod === "offline") return "線下支付";
  if (order.paymentMethod === "online") return order.paymentChannel ? `線上支付 / ${order.paymentChannel}` : "線上支付";
  return "-";
}

export function termLabel(months) {
  if (months === 12) return "一年";
  if (months === 6) return "半年";
  return months ? `${months} 個月` : "-";
}

export function statusLabel(status) {
  if (status === "online") return "線上";
  if (status === "failed") return "失敗";
  return "離線";
}
