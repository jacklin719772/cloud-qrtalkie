export function getBillingOrderMenuActions(order) {
  const showPaymentProof =
    order.paymentMethod === "offline" &&
    (order.orderStatus === "pending_payment" ||
      ["payment_submitted", "pending_review", "review_approved", "review_rejected"].includes(order.orderStatus) ||
      Boolean(order.paymentDate));
  const canModify = !["review_approved", "review_rejected"].includes(order.orderStatus);
  const isSubmittedUnreviewed = order.orderStatus === "pending_review";
  const reviewAction = isSubmittedUnreviewed
    ? { action: "revoke-review", label: "撤销提交" }
    : { action: "submit-review", label: "提交审核", disabled: order.orderStatus !== "payment_submitted" };

  return [
    { action: "detail", label: "查看详情" },
    showPaymentProof ? { action: "upload-proof", label: "支付凭证" } : null,
    { action: "repurchase", label: "重新购买" },
    { action: "edit", label: "订单修改", disabled: !canModify },
    { action: "delete", label: "订单删除", disabled: !canModify },
    reviewAction,
  ].filter(Boolean);
}
