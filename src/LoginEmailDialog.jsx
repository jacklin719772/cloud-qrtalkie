import React, { forwardRef, useEffect, useState } from 'react';
import apiClient from './apiClient';

const initialForm = {
  newEmail: '',
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
  code: '',
};

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const LoginEmailDialog = forwardRef(({ initialEmail = '' }, ref) => {
  const [formData, setFormData] = useState({ ...initialForm, newEmail: initialEmail });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    setFormData({ ...initialForm, newEmail: initialEmail || '' });
    setMessage({ type: '', text: '' });
    setCodeSent(false);
  }, [initialEmail]);

  const closeDialog = () => {
    ref?.current?.close();
  };

  const updateField = (field) => (event) => {
    setFormData((current) => ({ ...current, [field]: event.target.value }));
  };

  const validateBaseFields = () => {
    if (!isValidEmail(formData.newEmail)) return '請輸入有效的新登入信箱。';
    if (!formData.oldPassword) return '請輸入舊密碼。';
    if (formData.newPassword.length < 8) return '新登入密碼至少需要 8 位。';
    if (formData.newPassword !== formData.confirmPassword) return '兩次輸入的新密碼不一致。';
    return '';
  };

  const requestCode = async () => {
    const validationMessage = validateBaseFields();
    if (validationMessage) {
      setMessage({ type: 'error', text: validationMessage });
      return;
    }

    setIsSending(true);
    setMessage({ type: '', text: '' });
    try {
      const result = await apiClient.post('/admin/login-email-change/request-code', {
        newEmail: formData.newEmail.trim(),
        oldPassword: formData.oldPassword,
        newPassword: formData.newPassword,
        confirmPassword: formData.confirmPassword,
      });
      setCodeSent(true);
      setMessage({ type: 'success', text: result.message || '驗證碼已傳送。' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '驗證碼傳送失敗。' });
    } finally {
      setIsSending(false);
    }
  };

  const confirmChange = async (event) => {
    event.preventDefault();
    const validationMessage = validateBaseFields();
    if (validationMessage) {
      setMessage({ type: 'error', text: validationMessage });
      return;
    }
    if (!/^\d{6}$/.test(formData.code.trim())) {
      setMessage({ type: 'error', text: '請輸入 6 位驗證碼。' });
      return;
    }

    setIsConfirming(true);
    setMessage({ type: '', text: '' });
    try {
      const result = await apiClient.post('/admin/login-email-change/confirm', {
        newEmail: formData.newEmail.trim(),
        code: formData.code.trim(),
      });
      localStorage.removeItem('qrtalkieAdminToken');
      sessionStorage.removeItem('qrtalkieAdminToken');
      setMessage({ type: 'success', text: result.message || '登入信箱已更新，請重新登入。' });
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '修改失敗，請稍後再試。' });
      setIsConfirming(false);
    }
  };

  return (
    <dialog id="login-email-dialog" ref={ref}>
      <form className="dialog-card login-email-card" id="login-email-change-form" onSubmit={confirmChange}>
        <div className="panel-head">
          <h2>修改登入信箱</h2>
          <button className="icon-btn dialog-close" type="button" title="關閉" onClick={closeDialog}>x</button>
        </div>
        <div className="dialog-grid">
          <label><span className="field-label">新登入信箱 <b className="required-mark">*</b></span><input name="newEmail" type="email" value={formData.newEmail} onChange={updateField('newEmail')} required /></label>
          <label><span className="field-label">舊密碼 <b className="required-mark">*</b></span><input name="oldPassword" type="password" value={formData.oldPassword} onChange={updateField('oldPassword')} required /></label>
          <label><span className="field-label">新登入密碼 <b className="required-mark">*</b></span><input name="newPassword" type="password" minLength={8} value={formData.newPassword} onChange={updateField('newPassword')} required /></label>
          <label><span className="field-label">確認新密碼 <b className="required-mark">*</b></span><input name="confirmPassword" type="password" minLength={8} value={formData.confirmPassword} onChange={updateField('confirmPassword')} required /></label>
          {codeSent && (
            <label className="code-field"><span className="field-label">驗證碼 <b className="required-mark">*</b></span><input name="code" inputMode="numeric" maxLength={6} value={formData.code} onChange={updateField('code')} placeholder="6 位數字驗證碼" /></label>
          )}
        </div>
        {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
        <menu className="form-actions">
          <button className="ghost-btn dialog-close" type="button" onClick={closeDialog}>取消</button>
          <button className="ghost-btn" type="button" onClick={requestCode} disabled={isSending || isConfirming}>{isSending ? '傳送中...' : '傳送驗證碼'}</button>
          {codeSent && <button className="primary-btn" type="submit" disabled={isConfirming}>{isConfirming ? '確認中...' : '確認修改'}</button>}
        </menu>
      </form>
    </dialog>
  );
});

export default LoginEmailDialog;
