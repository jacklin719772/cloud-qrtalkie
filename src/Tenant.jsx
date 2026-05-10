import React, { useEffect, useRef, useState } from 'react';
import apiClient from './apiClient';

const emptyForm = {
  tenantNumber: '',
  companyName: '',
  enterpriseEmail: '',
  contactPerson: '',
  contactPhone: '',
  postalCode: '',
  billingAddress: '',
  loginEmail: '',
  adminNickname: '',
  adminPhone: '',
};

function toFormData(data) {
  const tenant = data?.tenant || {};
  const admin = data?.admin || {};
  return {
    tenantNumber: tenant.tenantNumber || '',
    companyName: tenant.companyName || '',
    enterpriseEmail: tenant.enterpriseEmail || '',
    contactPerson: tenant.contactPerson || '',
    contactPhone: tenant.contactPhone || '',
    postalCode: tenant.postalCode || '',
    billingAddress: tenant.billingAddress || '',
    loginEmail: admin.loginEmail || '',
    adminNickname: admin.nickname || '',
    adminPhone: admin.phoneNumber || '',
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function RequiredMark() {
  return <b className="required-mark" aria-label="必填">*</b>;
}

export default function Tenant({ onOpenLoginEmail }) {
  const [formData, setFormData] = useState(emptyForm);
  const [snapshot, setSnapshot] = useState(emptyForm);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlatformAccount, setIsPlatformAccount] = useState(false);
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

  async function loadTenantSettings({ silent = false } = {}) {
    setIsLoading(true);
    if (!silent) showMessage('', '');
    try {
      const data = await apiClient.get('/me');
      if (data?.admin?.accountType === 'platform') {
        setIsPlatformAccount(true);
        showMessage('error', '平台管理員沒有租戶設定資料。');
        return;
      }
      const nextFormData = toFormData(data);
      setIsPlatformAccount(false);
      setFormData(nextFormData);
      setSnapshot(nextFormData);
    } catch (error) {
      showMessage('error', error.message || '無法載入租戶設定。');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTenantSettings();
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  const updateField = (field) => (event) => {
    setFormData((current) => ({ ...current, [field]: event.target.value }));
  };

  const validateForm = () => {
    if (!formData.companyName.trim()) return '請輸入公司名稱。';
    if (formData.enterpriseEmail.trim() && !isValidEmail(formData.enterpriseEmail)) return '請輸入有效的企業信箱。';
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
      const result = await apiClient.put('/tenant/settings', {
        companyName: formData.companyName.trim(),
        enterpriseEmail: formData.enterpriseEmail.trim(),
        contactPerson: formData.contactPerson.trim(),
        contactPhone: formData.contactPhone.trim(),
        billingAddress: formData.billingAddress.trim(),
        postalCode: formData.postalCode.trim(),
        adminNickname: formData.adminNickname.trim(),
        adminPhone: formData.adminPhone.trim(),
      });
      await loadTenantSettings({ silent: true });
      showMessage('success', result.message || '租戶設定已儲存。');
    } catch (error) {
      showMessage('error', error.message || '無法儲存租戶設定。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setFormData(snapshot);
    showMessage('', '');
  };

  return (
    <section className="view active" id="tenant">
      <form className="tenant-settings-form" id="tenant-settings-form" onSubmit={handleSubmit}>
        <div className="tenant-scroll-area">
          {isLoading && <p className="form-message">載入租戶設定中...</p>}
          {!isLoading && isPlatformAccount && <p className="form-message error">平台管理員沒有租戶設定資料。</p>}

          {!isLoading && !isPlatformAccount && (
            <>
              <section className="settings-block">
                <div className="settings-block-head">
                  <h3>租戶基本資訊</h3>
                </div>
                <div className="tenant-field-grid">
                  <label>租戶編號<input name="tenantNumber" value={formData.tenantNumber} readOnly /></label>
                  <label><span className="field-label">公司名稱 <RequiredMark /></span><input name="companyName" value={formData.companyName} onChange={updateField('companyName')} required /></label>
                  <label>企業信箱<input name="enterpriseEmail" type="email" value={formData.enterpriseEmail} onChange={updateField('enterpriseEmail')} /></label>
                  <label>企業聯絡人<input name="contactPerson" value={formData.contactPerson} onChange={updateField('contactPerson')} /></label>
                  <label>聯絡電話<input name="contactPhone" type="tel" value={formData.contactPhone} onChange={updateField('contactPhone')} /></label>
                  <label>郵遞區號<input name="postalCode" inputMode="numeric" value={formData.postalCode} onChange={updateField('postalCode')} /></label>
                  <label className="span-2">帳單郵寄地址<textarea name="billingAddress" rows="3" value={formData.billingAddress} onChange={updateField('billingAddress')}></textarea></label>
                </div>
              </section>

              <hr className="settings-divider" />

              <section className="settings-block">
                <div className="settings-block-head">
                  <h3>管理員登入資訊</h3>
                </div>
                <div className="tenant-field-grid admin-login-grid">
                  <label className="login-email-field">
                    <span className="field-label">登入信箱 <RequiredMark /></span>
                    <span className="input-action">
                      <input name="loginEmail" type="email" value={formData.loginEmail} readOnly />
                      <button className="ghost-btn" type="button" onClick={() => onOpenLoginEmail(formData.loginEmail)}>修改</button>
                    </span>
                  </label>
                  <label>暱稱<input name="adminNickname" value={formData.adminNickname} onChange={updateField('adminNickname')} placeholder="顯示在右上角的名稱" /></label>
                  <label>聯絡電話<input name="adminPhone" type="tel" value={formData.adminPhone} onChange={updateField('adminPhone')} /></label>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="tenant-fixed-actions">
          {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
          <menu className="form-actions">
            <button className="ghost-btn" id="cancel-tenant-settings" type="button" onClick={handleReset} disabled={isSaving || isLoading || isPlatformAccount}>取消</button>
            <button className="primary-btn" id="save-tenant-settings" type="submit" disabled={isSaving || isLoading || isPlatformAccount}>{isSaving ? '儲存中...' : '儲存修改'}</button>
          </menu>
        </div>
      </form>
    </section>
  );
}
