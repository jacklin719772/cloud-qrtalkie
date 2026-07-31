export function createBillingApi({ apiBaseUrl, apiFetch, getAuthToken }) {
  function uploadPaymentProof(orderId, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBaseUrl}/api/billing/orders/${encodeURIComponent(orderId)}/payment-proof`);
      xhr.setRequestHeader("Content-Type", "application/json");
      const token = getAuthToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      });
      xhr.addEventListener("load", () => {
        const result = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else reject(new Error(result.message || "支付憑證儲存失敗。"));
      });
      xhr.addEventListener("error", () => reject(new Error("上傳失敗，請檢查網路連線。")));
      xhr.send(JSON.stringify(payload));
    });
  }

  return {
    getPurchaseOptions() {
      return apiFetch("/api/billing/purchase-options");
    },
    validateCoupon(code) {
      return apiFetch(`/api/billing/coupons/validate?code=${encodeURIComponent(code)}`);
    },
    getOfflinePaymentAccount() {
      return apiFetch("/api/billing/offline-payment-account");
    },
    getPaymentMethods() {
      return apiFetch("/api/billing/payment-methods");
    },
    listOrders() {
      return apiFetch("/api/billing/orders");
    },
    getOrder(orderId) {
      return apiFetch(`/api/billing/orders/${encodeURIComponent(orderId)}`);
    },
    saveOrder({ endpoint, method, payload }) {
      return apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload),
      });
    },
    deleteOrder(orderId) {
      return apiFetch(`/api/billing/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
    },
    updateReviewSubmission(orderId, action) {
      return apiFetch(`/api/billing/orders/${encodeURIComponent(orderId)}/review-submission`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
    },
    uploadPaymentProof,
  };
}
