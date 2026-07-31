export function getBillingOrderMenuActions(order) {
  const showPaymentProof =
    order.paymentMethod === "offline" &&
    (order.orderStatus === "pending_payment" ||
      ["payment_submitted", "pending_review", "review_approved", "review_rejected"].includes(order.orderStatus) ||
      Boolean(order.paymentDate));
  const canModify = !["review_approved", "review_rejected"].includes(order.orderStatus);
  const canDelete = order.orderStatus === "pending_payment" && order.paymentStatus === "unpaid";
  const reviewAction = order.orderStatus === "pending_review"
    ? { action: "revoke-review", label: "撤銷提交" }
    : {
        action: "submit-review",
        label: order.orderStatus === "review_rejected" ? "重新提交" : "提交稽核",
        disabled: order.orderStatus === "review_approved",
      };

  return [
    { action: "detail", label: "檢視詳情" },
    showPaymentProof ? { action: "upload-proof", label: "支付憑證" } : null,
    { action: "repurchase", label: "重新購買" },
    { action: "edit", label: "訂單修改", disabled: !canModify },
    { action: "delete", label: "訂單刪除", disabled: !canDelete },
    reviewAction,
  ].filter(Boolean);
}
