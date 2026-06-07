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
    <section className="view active" id="tenant" style={{ backgroundColor: '#0f172a', minHeight: '100%', padding: '24px' }}>
      <form className="tenant-settings-form" id="tenant-settings-form" onSubmit={handleSubmit} style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div className="tenant-scroll-area" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {isLoading && <p style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>載入租戶設定中...</p>}
          {!isLoading && isPlatformAccount && <p style={{ color: '#ef4444', textAlign: 'center', padding: '40px 0' }}>平台管理員沒有租戶設定資料。</p>}

          {!isLoading && !isPlatformAccount && (
            <>
              <div style={{ backgroundColor: '#111827', borderRadius: '10px', border: '1px solid #1f2937', padding: '24px', marginBottom: '20px' }}>
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>租戶基本資訊</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>租戶編號</span>
                    <input name="tenantNumber" value={formData.tenantNumber} readOnly
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: '#6b7280', fontSize: '13px', outline: 'none' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>公司名稱 <RequiredMark /></span>
                    <input name="companyName" value={formData.companyName} onChange={updateField('companyName')} required
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>企業信箱</span>
                    <input name="enterpriseEmail" type="email" value={formData.enterpriseEmail} onChange={updateField('enterpriseEmail')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>企業聯絡人</span>
                    <input name="contactPerson" value={formData.contactPerson} onChange={updateField('contactPerson')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>聯絡電話</span>
                    <input name="contactPhone" type="tel" value={formData.contactPhone} onChange={updateField('contactPhone')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>郵遞區號</span>
                    <input name="postalCode" inputMode="numeric" value={formData.postalCode} onChange={updateField('postalCode')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>帳單郵寄地址</span>
                    <textarea name="billingAddress" rows="3" value={formData.billingAddress} onChange={updateField('billingAddress')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', resize: 'vertical' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                </div>
              </div>

              <div style={{ backgroundColor: '#111827', borderRadius: '10px', border: '1px solid #1f2937', padding: '24px', marginBottom: '20px' }}>
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>管理員登入資訊</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>登入信箱 <RequiredMark /></span>
                    <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input name="loginEmail" type="email" value={formData.loginEmail} readOnly
                        style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: '#6b7280', fontSize: '13px', outline: 'none' }} />
                      <button type="button"
                        onClick={() => onOpenLoginEmail(formData.loginEmail)}
                        style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        修改
                      </button>
                    </span>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>暱稱</span>
                    <input name="adminNickname" value={formData.adminNickname} onChange={updateField('adminNickname')} placeholder="顯示在右上角的名稱"
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>聯絡電話</span>
                    <input name="adminPhone" type="tel" value={formData.adminPhone} onChange={updateField('adminPhone')}
                      style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
          {message.text && <p style={{ margin: 0, fontSize: '13px', color: message.type === 'error' ? '#ef4444' : '#22c55e' }}>{message.text}</p>}
          <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
            <button type="button" onClick={handleReset} disabled={isSaving || isLoading || isPlatformAccount}
              style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: 'pointer' }}>
              取消
            </button>
            <button type="submit" disabled={isSaving || isLoading || isPlatformAccount}
              style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}>
              {isSaving ? '儲存中...' : '儲存修改'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
