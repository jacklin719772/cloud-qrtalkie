import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Camera, Eye } from 'lucide-react';
import apiClient from './apiClient';

function todayDateValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatMoney(amount, currency = 'USD') {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取付款憑證失敗。'));
    reader.readAsDataURL(file);
  });
}

function isAcceptedProofImage(file) {
  const acceptedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const acceptedExtensions = /\.(png|jpe?g|webp)$/i;
  return acceptedTypes.includes(file.type) || acceptedExtensions.test(file.name || '');
}

function getFullImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  // 尝试读取环境变量中的 API_URL
  const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '';
  if (apiUrl && apiUrl.startsWith('http')) {
    return apiUrl.replace(/\/api\/?$/, '') + (url.startsWith('/') ? url : `/${url}`);
  }
  // 本地开发环境的安全降级兜底 (默认后端为 3001)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (window.location.port === '5173' || window.location.port === '3000') {
      return `http://127.0.0.1:3001${url.startsWith('/') ? url : `/${url}`}`;
    }
  }
  return url;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PaymentProofDialog = forwardRef(({ onSuccess }, ref) => {
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [order, setOrder] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [formData, setFormData] = useState({
    actualAmount: '',
    paymentDate: '',
    proofFile: null,
    proofFileName: '',
    previewUrl: '',
    existingProofUrl: '',
  });

  useImperativeHandle(ref, () => ({
    show: async (orderToPay) => {
      const orderId = orderToPay?.id;
      if (!orderId) return;
      setOrder({ ...orderToPay, payableAmount: orderToPay.payableAmount || orderToPay.totalAmount || 0 });
      setFormData((prev) => {
        if (prev.previewUrl && prev.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prev.previewUrl);
        }
        return {
          actualAmount: Number(orderToPay.payableAmount || orderToPay.totalAmount || 0).toFixed(2),
          paymentDate: todayDateValue(),
          proofFile: null,
          proofFileName: '',
          previewUrl: '',
          existingProofUrl: '',
        };
      });
      setMessage({ type: '', text: '' });
      setIsSubmitting(false);
      setPreviewProgress(0);
      setIsPreviewLoading(false);
      setIsDragOver(false);
      setIsReadonly(false);
      dialogRef.current?.showModal();

      try {
        const result = await apiClient.get(`/billing/orders/${orderId}`);
        const detail = result.order || {};
        const payment = detail.payment || {};
        const proofUrl = payment.proofUrl || '';
        setOrder(detail);
        setIsReadonly(['review_approved', 'review_rejected'].includes(detail.orderStatus));
        setFormData((prev) => ({
          ...prev,
          actualAmount: Number(payment.actualAmount || detail.payableAmount || 0).toFixed(2),
          paymentDate: payment.paymentDate || todayDateValue(),
          previewUrl: proofUrl,
          existingProofUrl: proofUrl,
          proofFileName: payment.proofFileName || '',
        }));
      } catch (error) {
        setMessage({ type: 'error', text: error.message || '讀取訂單支付資訊失敗。' });
      }
    },
  }));

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const loadProofFile = (file) => {
    if (isReadonly) return;
    if (!file) return;
    if (!isAcceptedProofImage(file)) {
      setMessage({ type: 'error', text: '請上傳 PNG、JPG 或 WEBP 格式的付款憑證圖片。' });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage({ type: 'error', text: '付款憑證圖片不能超過 8MB。' });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setFormData((prev) => {
      if (prev.previewUrl && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        ...prev,
        proofFile: file,
        proofFileName: file.name || 'payment-proof.png',
        previewUrl: previewUrl,
        existingProofUrl: '',
      };
    });
    setPreviewProgress(100);
    setIsPreviewLoading(false);
    setMessage({ type: '', text: '' });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    loadProofFile(file);
    event.target.value = '';
  };

  const resetFileInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isReadonly) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isReadonly) {
      event.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (isReadonly) return;
    const file = event.dataTransfer.files?.[0];
    loadProofFile(file);
  };

  const clearFile = () => {
    if (isReadonly) return;
    setFormData((prev) => {
      if (prev.previewUrl && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return { ...prev, proofFile: null, proofFileName: '', previewUrl: '', existingProofUrl: '' };
    });
    setPreviewProgress(0);
    setIsPreviewLoading(false);
    setIsDragOver(false);
    resetFileInputs();
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isReadonly) return;
    if (!order?.id || !formData.actualAmount || !formData.paymentDate) {
      setMessage({ type: 'error', text: '請填寫實付金額和付款日期。' });
      return;
    }
    if (!formData.proofFile && formData.existingProofUrl) {
      setMessage({ type: 'info', text: '當前付款憑證已保存，如需更換請先刪除圖片後重新上傳。' });
      return;
    }
    if (!formData.proofFile) {
      setMessage({ type: 'error', text: '請先上傳付款憑證截圖。' });
      return;
    }

    setIsSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const proofImageDataUrl = await readFileAsDataUrl(formData.proofFile);
      const result = await apiClient.post(`/billing/orders/${order.id}/payment-proof`, {
        actualAmount: formData.actualAmount,
        paymentDate: formData.paymentDate,
        proofImageDataUrl,
        fileName: formData.proofFileName || formData.proofFile.name || 'payment-proof.png',
      });
      const canSubmitReview = order.orderStatus !== 'pending_review';
      if (canSubmitReview && window.confirm('支付憑證保存成功，訂單已完成支付。是否立即提交審核？')) {
        const submitResult = await apiClient.post(`/billing/orders/${order.id}/review-submission`, { action: 'submit' });
        setMessage({ type: 'success', text: submitResult.message || '订单已提交审核。' });
      } else {
        setMessage({ type: 'success', text: result.message || '支付憑證已保存。' });
      }
      closeDialog();
      onSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '支付憑證保存失敗。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openFilePicker = () => {
    if (!isReadonly && fileInputRef.current) {
      resetFileInputs();
      fileInputRef.current.click();
    }
  };

  const openCameraPicker = () => {
    if (!isReadonly && cameraInputRef.current) {
      resetFileInputs();
      cameraInputRef.current.click();
    }
  };

  const handlePreviewImage = (event) => {
    event.stopPropagation();
    if (!previewSrc) return;
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setMessage({ type: 'error', text: '瀏覽器阻止了新標籤頁，請允許彈出視窗後重試。' });
      return;
    }
    previewWindow.opener = null;
    const imageSrc = previewSrc;
    const title = escapeHtml(formData.proofFileName || '付款憑證預覽');
    previewWindow.document.write(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #111827;
      }
      body {
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      img {
        max-width: 100%;
        max-height: calc(100vh - 48px);
        object-fit: contain;
        background: #fff;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }
    </style>
  </head>
  <body>
            <img id="payment-proof-full-image" src="${escapeHtml(imageSrc)}" alt="付款凭证完整图像">
  </body>
</html>`);
    previewWindow.document.close();
  };

  const previewSrc = getFullImageUrl(formData.previewUrl);
  const isReviewApproved = order?.orderStatus === 'review_approved';

  return (
    <dialog id="payment-proof-dialog" ref={dialogRef}>
      <style>{`
        #payment-proof-dialog { background: transparent; border: none; padding: 0; max-width: none; max-height: none; }
        #payment-proof-dialog::backdrop { background: rgba(0,0,0,0.5); }
        #payment-proof-form.payment-proof-card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; color: #d1d5db; }
        #payment-proof-form .panel-head { background: #1a2332; border-bottom: 1px solid #1f2937; padding: 16px 20px; }
        #payment-proof-form .panel-head h2 { color: #f3f4f6; margin: 0; font-size: 16px; font-weight: 600; }
        #payment-proof-form .icon-btn { background: transparent; border: none; color: #9ca3af; cursor: pointer; font-size: 18px; }
        #payment-proof-form .proof-upload-area { background: #1a2332; border: 2px dashed #374151; border-radius: 8px; }
        #payment-proof-form .proof-upload-area.has-image { border-style: solid; border-color: #1f2937; }
        #payment-proof-form .proof-upload-empty { color: #9ca3af; }
        #payment-proof-form .proof-upload-empty svg { color: #6b7280; }
        #payment-proof-form .proof-upload-empty small { color: #6b7280; }
        #payment-proof-form .link-btn { color: #60a5fa; background: transparent; border: none; cursor: pointer; }
        #payment-proof-form .proof-preview { background: #1a2332 !important; }
        #payment-proof-form .proof-image-action { background: #1f2937; border: 1px solid #374151; color: #d1d5db; }
        #payment-proof-form .proof-image-remove { color: #fca5a5; }
        #payment-proof-form .payment-proof-fields label { color: #9ca3af; }
        #payment-proof-form .payment-proof-fields input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; border-radius: 6px; padding: 10px; }
        #payment-proof-form .payment-proof-fields input[readonly] { background: #0f172a; color: #6b7280; }
        #payment-proof-form .payment-proof-fields input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
        #payment-proof-form .form-message.error { color: #ef4444; }
        #payment-proof-form .form-message.success { color: #22c55e; }
        #payment-proof-form .form-message.info { color: #60a5fa; }
        #payment-proof-form .form-actions { background: #1a2332; border-top: 1px solid #1f2937; padding: 14px 20px; }
        #payment-proof-form .ghost-btn { background: #1f2937; color: #d1d5db; border: 1px solid #374151; border-radius: 6px; padding: 8px 20px; cursor: pointer; }
        #payment-proof-form .primary-btn { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 8px 20px; cursor: pointer; }
        #payment-proof-form .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
      <form className="dialog-card payment-proof-card" id="payment-proof-form" onSubmit={handleSubmit}>
        <div className="panel-head">
          <h2>支付憑證</h2>
          <button className="icon-btn dialog-close" type="button" title="關閉" onClick={closeDialog}>x</button>
        </div>
        <div className="payment-proof-body">
          <div className="payment-proof-layout">
            <section className="proof-upload-panel">
              <div
                className={`proof-upload-area ${isReadonly ? 'readonly' : ''} ${isDragOver ? 'drag-over' : ''} ${previewSrc ? 'has-image' : ''}`}
                tabIndex="0"
                role="button"
                onClick={openFilePicker}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openFilePicker();
                  }
                }}
              >
                <input ref={fileInputRef} name="proofFile" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden onChange={handleFileChange} />
                <input ref={cameraInputRef} name="proofCameraFile" type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
                {!previewSrc && !isPreviewLoading && (
                  <div className="proof-upload-empty">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 16V8m0 0-3 3m3-3 3 3M5 17.5a4 4 0 0 1 .8-7.92 6 6 0 0 1 11.64 1.57A3.5 3.5 0 0 1 17.5 18H16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p>
                      拖放截圖到這裡，或
                      <button className="link-btn" onClick={(event) => { event.stopPropagation(); openFilePicker(); }} type="button">從相冊選擇</button>
                      <button className="link-btn proof-camera-btn" onClick={(event) => { event.stopPropagation(); openCameraPicker(); }} type="button">
                        <Camera size={16} strokeWidth={2} />
                        拍照上傳
                      </button>
                    </p>
                    <small>支援 PNG、JPG、WEBP，最大 8MB</small>
                  </div>
                )}
                {isPreviewLoading && (
                  <div className="proof-upload-progress">
                    <span>讀取預覽</span>
                    <progress value={previewProgress} max="100"></progress>
                    <b>{previewProgress}%</b>
                  </div>
                )}
                {previewSrc && (
                  <div className="proof-preview">
                    <button
                      className={`proof-image-action proof-image-open ${isReadonly ? 'solo' : ''}`}
                      onClick={handlePreviewImage}
                      type="button"
                      title="查看完整圖像"
                      aria-label="查看完整圖像"
                    >
                      <Eye size={18} strokeWidth={2} />
                    </button>
                    {!isReadonly && (
                      <button
                        className="proof-image-action proof-image-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearFile();
                        }}
                        type="button"
                        title="刪除圖片"
                      >
                        x
                      </button>
                    )}
                    <img src={previewSrc} alt="付款憑證預覽" />
                  </div>
                )}
              </div>
            </section>

            <aside className="payment-proof-fields">
              <label><span>應付金額</span><input name="payableAmount" readOnly value={formatMoney(order?.payableAmount, order?.currency || 'USD')} /></label>
              <label><span>實付金額 <b>*</b></span><input name="actualAmount" type="number" min="0.01" step="0.01" inputMode="decimal" required readOnly={isReadonly} value={formData.actualAmount} onChange={handleFormChange} /></label>
              <label><span>付款日期 <b>*</b></span><input name="paymentDate" type="date" required readOnly={isReadonly} value={formData.paymentDate} onChange={handleFormChange} /></label>
            </aside>
          </div>
          {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
        </div>
        {!isReviewApproved && (
          <menu className="form-actions">
            <button className="ghost-btn dialog-close" type="button" onClick={closeDialog}>取消</button>
            <button className="primary-btn" type="submit" disabled={isSubmitting || isReadonly}>
              {isSubmitting ? '上傳中...' : '保存'}
            </button>
          </menu>
        )}
      </form>
    </dialog>
  );
});

export default PaymentProofDialog;
