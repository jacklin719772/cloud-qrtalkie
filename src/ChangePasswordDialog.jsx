import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

export default function ChangePasswordDialog({ onClose, identity }) {
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.password) { setMessage({ type: 'error', text: '請輸入新密碼。' }); return; }
    if (form.password.length < 6) { setMessage({ type: 'error', text: '密碼至少需要 6 個字元。' }); return; }
    if (form.password !== form.confirmPassword) { setMessage({ type: 'error', text: '兩次輸入的密碼不一致。' }); return; }
    setSaving(true);
    try {
      const endpoint = identity?.admin?.accountType === 'platform' ? `/platform/admins/${identity.admin.id}` : `/tenant/sip-accounts/${identity?.admin?.id}`;
      await apiClient.put(endpoint, { password: form.password, confirmPassword: form.confirmPassword, displayName: identity?.admin?.displayName || '' });
      setMessage({ type: 'success', text: '密碼已修改。' });
      setTimeout(onClose, 800);
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '修改失敗。' });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} style={{ width: 'min(380px, 90vw)', background: '#111827', borderRadius: '10px', boxShadow: '0 24px 80px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#f3f4f6', fontWeight: 600 }}>修改密碼</h3>
          <button type="button" onClick={onClose} disabled={saving} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9ca3af' }}>&#10005;</button>
        </div>
        <div style={{ padding: '20px', display: 'grid', gap: '14px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>
            新密碼
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少 6 位字元" autoComplete="new-password"
              style={{ padding: '10px', border: '1px solid #374151', borderRadius: '6px', fontSize: '14px', outline: 'none', background: '#1a2332', color: '#e5e7eb' }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>
            確認密碼
            <input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="再次輸入密碼" autoComplete="new-password"
              style={{ padding: '10px', border: '1px solid #374151', borderRadius: '6px', fontSize: '14px', outline: 'none', background: '#1a2332', color: '#e5e7eb' }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
          </label>
          {message.text && <p style={{ margin: 0, fontSize: '13px', color: message.type === 'error' ? '#ef4444' : '#22c55e' }}>{message.text}</p>}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid #1f2937', background: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ padding: '8px 20px', borderRadius: '6px', background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', cursor: 'pointer', fontSize: '13px' }}>取消</button>
          <button type="submit" disabled={saving} style={{ padding: '8px 20px', borderRadius: '6px', background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>{saving ? '儲存中...' : '確認修改'}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}
