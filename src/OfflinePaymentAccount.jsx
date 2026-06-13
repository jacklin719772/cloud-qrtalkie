import React, { useEffect, useRef, useState } from 'react';
import apiClient from './apiClient';

const emptyForm = {
  accountCode: 'default-usd-bank',
  displayName: '',
  payeeName: '',
  bankName: 'HSBC TaiWan',
  bankAccountNo: '',
  bankBranch: '',
  swiftCode: '',
  currency: 'TWD',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  paymentNotice: '',
};

function RequiredMark() {
  return <b className="required-mark" aria-label="必填">*</b>;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function toFormData(data) {
  const account = data?.account || {};
  return {
    accountCode: account.accountCode || 'default-usd-bank',
    displayName: account.displayName || '',
    payeeName: account.payeeName || '',
    bankName: account.bankName || 'HSBC TaiWan',
    bankAccountNo: account.bankAccountNo || '',
    bankBranch: account.bankBranch || '',
    swiftCode: account.swiftCode || '',
    currency: account.currency || 'TWD',
    contactName: account.contactName || '',
    contactPhone: account.contactPhone || '',
    contactEmail: account.contactEmail || '',
    paymentNotice: account.paymentNotice || '',
  };
}

export default function OfflinePaymentAccount() {
  const [formData, setFormData] = useState(emptyForm);
  const [snapshot, setSnapshot] = useState(emptyForm);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const messageTimerRef = useRef(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (text) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage({ type: '', text: '' });
        messageTimerRef.current = null;
      }, 5000);
    }
  };

  async function loadAccount({ silent = false } = {}) {
    setIsLoading(true);
    if (!silent) showMessage('', '');
    try {
      const data = await apiClient.get('/billing/offline-payment-account');
      const nextFormData = toFormData(data);
      setFormData(nextFormData);
      setSnapshot(nextFormData);
    } catch (error) {
      showMessage('error', error.message || '無法載入收款帳戶。');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector('.main');
    if (mainElement) {
      mainElement.classList.add('offline-account-mode');
    }
    return () => {
      if (mainElement) mainElement.classList.remove('offline-account-mode');
    };
  }, []);

  const updateField = (field) => (event) => {
    setFormData((current) => ({ ...current, [field]: event.target.value }));
  };

  const validateForm = () => {
    if (!formData.displayName.trim()) return '請輸入帳戶名稱。';
    if (!formData.payeeName.trim()) return '請輸入收款單位。';
    if (!formData.bankName.trim()) return '請輸入開戶銀行。';
    if (!formData.bankAccountNo.trim()) return '請輸入銀行帳號。';
    if (!/^[A-Z]{3}$/.test(formData.currency.trim().toUpperCase())) return '幣別需為 3 位英文代碼。';
    if (formData.contactEmail.trim() && !isValidEmail(formData.contactEmail)) return '請輸入有效的聯絡信箱。';
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationMessage = validateForm();
    if (validationMessage) {
      showMessage('error', validationMessage);
      return;
    }

    setIsSaving(true);
    showMessage('', '');
    try {
      const result = await apiClient.put('/billing/offline-payment-account', {
        ...formData,
        accountCode: formData.accountCode.trim() || 'default-usd-bank',
        displayName: formData.displayName.trim(),
        payeeName: formData.payeeName.trim(),
        bankName: formData.bankName.trim(),
        bankAccountNo: formData.bankAccountNo.trim(),
        bankBranch: formData.bankBranch.trim(),
        swiftCode: formData.swiftCode.trim(),
        currency: formData.currency.trim().toUpperCase(),
        contactName: formData.contactName.trim(),
        contactPhone: formData.contactPhone.trim(),
        contactEmail: formData.contactEmail.trim(),
        paymentNotice: formData.paymentNotice.trim(),
      });
      await loadAccount({ silent: true });
      showMessage('success', result.message || '收款帳戶已儲存。');
    } catch (error) {
      showMessage('error', error.message || '無法儲存收款帳戶。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setFormData(snapshot);
    showMessage('', '');
  };

  return (
    <section className="view active settings-form-page" id="offline-account">
      <style>{`
        #offline-account .tenant-settings-form,
        #console #offline-account .tenant-settings-form { background: #111827; border-color: #1f2937; }
        #offline-account .tenant-scroll-area,
        #console #offline-account .tenant-scroll-area { background: #111827; }
        #offline-account .tenant-fixed-actions,
        #console #offline-account .tenant-fixed-actions { background: #111827; border-top-color: #1f2937; }
        #offline-account .settings-block { background: #111827; border: 1px solid #1f2937; }
        #offline-account .settings-block-head h3 { color: #f3f4f6; }
        #offline-account .settings-block-head { border-bottom-color: #1f2937; }
        #offline-account .field-label,
        #console #offline-account .tenant-field-grid label,
        #console #offline-account .field-label { color: #d1d5db; }
        #offline-account .tenant-field-grid label { color: #d1d5db; }
        #offline-account .tenant-field-grid input,
        #offline-account .tenant-field-grid textarea,
        #console #offline-account .tenant-field-grid input,
        #console #offline-account .tenant-field-grid textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #offline-account .tenant-field-grid input:focus,
        #offline-account .tenant-field-grid textarea:focus,
        #console #offline-account .tenant-field-grid input:focus,
        #console #offline-account .tenant-field-grid textarea:focus { border-color: #3b82f6; }
        #offline-account .tenant-field-grid input::placeholder,
        #offline-account .tenant-field-grid textarea::placeholder,
        #console #offline-account .tenant-field-grid input::placeholder,
        #console #offline-account .tenant-field-grid textarea::placeholder { color: #6b7280; }
        #offline-account .settings-divider { border-color: #1f2937; }
        #offline-account .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #offline-account .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #console #offline-account .form-message.error { background: #3b1111; color: #ef4444; }
        #console #offline-account .form-message.success { background: #0d2818; color: #22c55e; }
        #offline-account .form-message { color: #d1d5db; }
      `}</style>
      <form className="tenant-settings-form" onSubmit={handleSubmit} style={{ background: '#111827', borderColor: '#1f2937' }}>
        <div className="tenant-scroll-area" style={{ background: '#111827' }}>
          {isLoading && <p className="form-message">載入收款帳戶中...</p>}

          {!isLoading && (
            <>
              <section className="settings-block">
                <div className="settings-block-head">
                  <h3>收款账号资讯</h3>
                </div>
                <div className="tenant-field-grid">
                  <label>帳戶代碼<input value={formData.accountCode} onChange={updateField('accountCode')} /></label>
                  <label><span className="field-label">帳戶名稱 <RequiredMark /></span><input value={formData.displayName} onChange={updateField('displayName')} required /></label>
                  <label><span className="field-label">收款單位 <RequiredMark /></span><input value={formData.payeeName} onChange={updateField('payeeName')} required /></label>
                  <label><span className="field-label">開戶銀行 <RequiredMark /></span><input value={formData.bankName} onChange={updateField('bankName')} required /></label>
                  <label><span className="field-label">銀行帳號 <RequiredMark /></span><input value={formData.bankAccountNo} onChange={updateField('bankAccountNo')} required /></label>
                  <label>銀行分行<input value={formData.bankBranch} onChange={updateField('bankBranch')} /></label>
                  <label>SWIFT<input value={formData.swiftCode} onChange={updateField('swiftCode')} /></label>
                  <label><span className="field-label">幣別 <RequiredMark /></span><input maxLength={3} value={formData.currency} onChange={updateField('currency')} required /></label>
                </div>
              </section>

              <hr className="settings-divider" />

              <section className="settings-block">
                <div className="settings-block-head">
                  <h3>聯絡資訊</h3>
                </div>
                <div className="tenant-field-grid">
                  <label>聯絡人<input value={formData.contactName} onChange={updateField('contactName')} /></label>
                  <label>聯絡電話<input value={formData.contactPhone} onChange={updateField('contactPhone')} /></label>
                  <label>聯絡信箱<input type="email" value={formData.contactEmail} onChange={updateField('contactEmail')} /></label>
                  <label className="span-2">付款提示<textarea rows="3" value={formData.paymentNotice} onChange={updateField('paymentNotice')}></textarea></label>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="tenant-fixed-actions" style={{ background: '#111827', borderTopColor: '#1f2937' }}>
          {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
          <menu className="form-actions">
            <button className="ghost-btn" type="button" onClick={handleReset} disabled={isSaving || isLoading}>取消</button>
            <button className="primary-btn" type="submit" disabled={isSaving || isLoading}>{isSaving ? '儲存中...' : '儲存修改'}</button>
          </menu>
        </div>
      </form>
    </section>
  );
}
