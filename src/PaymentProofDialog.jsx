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
    reader.onerror = () => reject(new Error('读取付款凭证失败。'));
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
        setMessage({ type: 'error', text: error.message || '读取订单支付信息失败。' });
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
      setMessage({ type: 'error', text: '请上传 PNG、JPG 或 WEBP 格式的付款凭证图片。' });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage({ type: 'error', text: '付款凭证图片不能超过 8MB。' });
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
      setMessage({ type: 'error', text: '请填写实付金额和付款日期。' });
      return;
    }
    if (!formData.proofFile && formData.existingProofUrl) {
      setMessage({ type: 'info', text: '当前付款凭证已保存，如需更换请先删除图片后重新上传。' });
      return;
    }
    if (!formData.proofFile) {
      setMessage({ type: 'error', text: '请先上传付款凭证截图。' });
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
      if (canSubmitReview && window.confirm('支付凭证保存成功，订单已完成支付。是否立即提交审核？')) {
        const submitResult = await apiClient.post(`/billing/orders/${order.id}/review-submission`, { action: 'submit' });
        setMessage({ type: 'success', text: submitResult.message || '订单已提交审核。' });
      } else {
        setMessage({ type: 'success', text: result.message || '支付凭证已保存。' });
      }
      closeDialog();
      onSuccess?.();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '支付凭证保存失败。' });
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
      setMessage({ type: 'error', text: '浏览器阻止了新标签页，请允许弹出窗口后重试。' });
      return;
    }
    previewWindow.opener = null;
    const imageSrc = previewSrc;
    const title = escapeHtml(formData.proofFileName || '付款凭证预览');
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
      <form className="dialog-card payment-proof-card" id="payment-proof-form" onSubmit={handleSubmit}>
        <div className="panel-head">
          <h2>支付凭证</h2>
          <button className="icon-btn dialog-close" type="button" title="关闭" onClick={closeDialog}>x</button>
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
                      拖放截图到这里，或
                      <button className="link-btn" onClick={(event) => { event.stopPropagation(); openFilePicker(); }} type="button">从相册选择</button>
                      <button className="link-btn proof-camera-btn" onClick={(event) => { event.stopPropagation(); openCameraPicker(); }} type="button">
                        <Camera size={16} strokeWidth={2} />
                        拍照上传
                      </button>
                    </p>
                    <small>支持 PNG、JPG、WEBP，最大 8MB</small>
                  </div>
                )}
                {isPreviewLoading && (
                  <div className="proof-upload-progress">
                    <span>读取预览</span>
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
                      title="查看完整图像"
                      aria-label="查看完整图像"
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
                        title="删除图片"
                      >
                        x
                      </button>
                    )}
                    <img src={previewSrc} alt="付款凭证预览" />
                  </div>
                )}
              </div>
            </section>

            <aside className="payment-proof-fields">
              <label><span>应付金额</span><input name="payableAmount" readOnly value={formatMoney(order?.payableAmount, order?.currency || 'USD')} /></label>
              <label><span>实付金额 <b>*</b></span><input name="actualAmount" type="number" min="0.01" step="0.01" inputMode="decimal" required readOnly={isReadonly} value={formData.actualAmount} onChange={handleFormChange} /></label>
              <label><span>付款日期 <b>*</b></span><input name="paymentDate" type="date" required readOnly={isReadonly} value={formData.paymentDate} onChange={handleFormChange} /></label>
            </aside>
          </div>
          {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
        </div>
        {!isReviewApproved && (
          <menu className="form-actions">
            <button className="ghost-btn dialog-close" type="button" onClick={closeDialog}>取消</button>
            <button className="primary-btn" type="submit" disabled={isSubmitting || isReadonly}>
              {isSubmitting ? '上传中...' : '保存'}
            </button>
          </menu>
        )}
      </form>
    </dialog>
  );
});

export default PaymentProofDialog;
