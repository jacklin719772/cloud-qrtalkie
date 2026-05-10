import { formatMoney, todayDateValue } from "../../core/formatters.js";
import { renderBillingOrdersView } from "./billingOrdersView.js";
import {
  clearPaymentProofImageDom,
  readProofFile,
  setPaymentProofPreviewDom,
  setPaymentProofProgress,
  setPaymentProofReadonly,
} from "./paymentProofView.js";

export function createBillingOrdersController({
  apiBaseUrl,
  billingApi,
  hideInlineMessage,
  pageSize = 10,
  showInlineMessage,
}) {
  let orders = [];
  let page = 1;
  let proofOrderId = null;
  let proofDataUrl = "";
  let proofFileName = "";
  let proofExistingUrl = "";
  let proofReadonly = false;
  let proofOrderStatus = "";

  function renderOrders() {
    page = renderBillingOrdersView({ orders, page, pageSize });
  }

  async function loadOrders() {
    try {
      const result = await billingApi.listOrders();
      orders = result.orders || [];
      page = 1;
      renderOrders();
    } catch {
      const tbody = document.querySelector("#billing-order-table");
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="empty-cell">读取订单列表失败</td></tr>`;
    }
  }

  function updatePage(delta) {
    page += delta;
    renderOrders();
  }

  async function deleteOrder(orderId) {
    const messageNode = document.querySelector("#billing-message") || document.querySelector("#tenant-message") || document.querySelector("#purchase-page-message");
    if (!window.confirm("确定要删除此未支付订单吗？")) return;
    try {
      const result = await billingApi.deleteOrder(orderId);
      showInlineMessage(messageNode, result.message || "订单已删除。", "success");
      await loadOrders();
    } catch (error) {
      showInlineMessage(messageNode, error.message || "删除订单失败。", "error");
    }
  }

  async function updateReviewSubmission(orderId, action) {
    const messageNode = document.querySelector("#billing-message") || document.querySelector("#purchase-page-message") || document.querySelector("#tenant-message");
    try {
      const result = await billingApi.updateReviewSubmission(orderId, action);
      showInlineMessage(messageNode, result.message || "订单状态已更新。", "success");
      await loadOrders();
    } catch (error) {
      showInlineMessage(messageNode, error.message || "订单状态更新失败。", "error");
    }
  }

  function setProofPreview(dataUrl, fileName = "payment-proof.png") {
    proofDataUrl = String(dataUrl || "").startsWith("data:") ? dataUrl : "";
    proofExistingUrl = proofDataUrl ? "" : dataUrl;
    proofFileName = fileName;
    setPaymentProofPreviewDom(dataUrl);
  }

  function clearProofImage() {
    proofDataUrl = "";
    proofExistingUrl = "";
    proofFileName = "";
    clearPaymentProofImageDom();
  }

  function setProofReadonly(readonly) {
    proofReadonly = readonly;
    setPaymentProofReadonly(readonly);
  }

  function clearProofFromEvent(event) {
    event?.stopPropagation();
    if (proofReadonly) return;
    clearProofImage();
    setPaymentProofProgress(0, false);
    hideInlineMessage(document.querySelector("#payment-proof-message"));
    document.querySelector("#proof-upload-area")?.focus();
  }

  async function openPaymentProofDialog(orderId) {
    const dialog = document.querySelector("#payment-proof-dialog");
    const form = document.querySelector("#payment-proof-form");
    const messageNode = document.querySelector("#payment-proof-message");
    if (!dialog || !form) return;

    proofOrderId = Number(orderId);
    proofDataUrl = "";
    proofFileName = "";
    proofExistingUrl = "";
    proofOrderStatus = "";
    form.reset();
    clearProofImage();
    setPaymentProofProgress(0, false);
    setProofReadonly(false);
    hideInlineMessage(messageNode);

    try {
      const result = await billingApi.getOrder(orderId);
      const order = result.order || {};
      const payment = order.payment || {};
      proofOrderStatus = order.orderStatus || "";
      setProofReadonly(["review_approved", "review_rejected"].includes(proofOrderStatus));
      form.elements.payableAmount.value = formatMoney(order.payableAmount, order.currency || "USD");
      form.elements.actualAmount.value = Number(payment.actualAmount || order.payableAmount || 0).toFixed(2);
      form.elements.paymentDate.value = payment.paymentDate || todayDateValue();
      if (payment.proofUrl) {
        const proofUrl = payment.proofUrl.startsWith("http") ? payment.proofUrl : `${apiBaseUrl}${payment.proofUrl}`;
        setProofPreview(proofUrl, payment.proofFileName || "payment-proof.png");
      }
      dialog.showModal();
      document.querySelector("#proof-upload-area")?.focus();
    } catch (error) {
      const listMessage = document.querySelector("#billing-message") || document.querySelector("#tenant-message");
      showInlineMessage(listMessage, error.message || "读取订单支付信息失败。", "error");
    }
  }

  async function handlePaymentProofFile(file) {
    if (proofReadonly) return;
    const messageNode = document.querySelector("#payment-proof-message");
    try {
      const dataUrl = await readProofFile(file);
      setProofPreview(dataUrl, file?.name || "payment-proof.png");
      hideInlineMessage(messageNode);
    } catch (error) {
      showInlineMessage(messageNode, error.message || "读取支付凭证失败。", "error");
    }
  }

  function handlePaymentProofPaste(event) {
    if (proofReadonly) return;
    const dialog = document.querySelector("#payment-proof-dialog");
    if (!dialog?.open) return;
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    event.preventDefault();
    handlePaymentProofFile(imageItem.getAsFile());
  }

  function handlePaymentProofDrag(event) {
    if (proofReadonly) return;
    const uploadArea = document.querySelector("#proof-upload-area");
    event.preventDefault();
    uploadArea?.classList.toggle("drag-over", event.type === "dragover" || event.type === "dragenter");
  }

  function handlePaymentProofDrop(event) {
    if (proofReadonly) return;
    const uploadArea = document.querySelector("#proof-upload-area");
    event.preventDefault();
    uploadArea?.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) handlePaymentProofFile(file);
  }

  async function submitPaymentProof(event) {
    event.preventDefault();
    if (proofReadonly) return;
    const form = event.currentTarget;
    const messageNode = document.querySelector("#payment-proof-message");
    const submitButton = form.querySelector(".primary-btn[type='submit']");
    if (!proofOrderId) return;
    const actualAmount = Number(form.elements.actualAmount.value);
    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      showInlineMessage(messageNode, "请输入有效的实付金额。", "error");
      form.elements.actualAmount.focus();
      return;
    }
    if (!form.elements.paymentDate.value) {
      showInlineMessage(messageNode, "请选择付款日期。", "error");
      form.elements.paymentDate.focus();
      return;
    }
    if (!proofDataUrl && proofExistingUrl) {
      showInlineMessage(messageNode, "当前支付凭证已保存，无需重复保存。如需更换，请先删除图片后重新上传。", "info");
      return;
    }
    if (!proofDataUrl) {
      showInlineMessage(messageNode, "请先上传或粘贴支付凭证截图。", "error");
      document.querySelector("#proof-upload-area")?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "上传中...";
    setPaymentProofProgress(0, true);
    try {
      const result = await billingApi.uploadPaymentProof(
        proofOrderId,
        {
          actualAmount: form.elements.actualAmount.value,
          paymentDate: form.elements.paymentDate.value,
          proofImageDataUrl: proofDataUrl,
          fileName: proofFileName,
        },
        (percent) => {
          setPaymentProofProgress(percent, true);
        },
      );
      setPaymentProofProgress(100, true);
      showInlineMessage(document.querySelector("#billing-message"), result.message || "支付凭证已保存。", "success");
      document.querySelector("#payment-proof-dialog")?.close();

      window.alert(
        proofOrderStatus === "pending_review"
          ? "支付凭证已更换，订单状态保持不变。"
          : "支付凭证保存成功，订单已变为已支付，请提交该订单，以便后台完成订单审核。",
      );
      await loadOrders();

      proofOrderId = null;
      clearProofImage();
    } catch (error) {
      showInlineMessage(messageNode, error.message || "支付凭证保存失败。", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "保存";
    }
  }

  return {
    clearProofFromEvent,
    deleteOrder,
    handlePaymentProofDrag,
    handlePaymentProofDrop,
    handlePaymentProofFile,
    handlePaymentProofPaste,
    loadOrders,
    openPaymentProofDialog,
    renderOrders,
    submitPaymentProof,
    updatePage,
    updateReviewSubmission,
  };
}
