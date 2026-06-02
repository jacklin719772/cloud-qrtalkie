import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

export default function ChangePasswordDialog({ onClose, identity }) {
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.password) { setMessage({ type: 'error', text: '请输入新密码。' }); return; }
    if (form.password.length < 6) { setMessage({ type: 'error', text: '密码至少需要 6 个字符。' }); return; }
    if (form.password !== form.confirmPassword) { setMessage({ type: 'error', text: '两次输入的密码不一致。' }); return; }
    setSaving(true);
    try {
      const endpoint = identity?.admin?.accountType === 'platform' ? `/platform/admins/${identity.admin.id}` : `/tenant/sip-accounts/${identity?.admin?.id}`;
      await apiClient.put(endpoint, { password: form.password, confirmPassword: form.confirmPassword, displayName: identity?.admin?.displayName || '' });
      setMessage({ type: 'success', text: '密码已修改。' });
      setTimeout(onClose, 800);
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '修改失败。' });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} style={{ width: 'min(380px, 100%)', background: '#fff', borderRadius: '12px', boxShadow: '0 24px 80px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>修改密码</h3>
          <button type="button" onClick={onClose} disabled={saving} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>&#10005;</button>
        </div>
        <div style={{ padding: '20px', display: 'grid', gap: '14px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
            新密码
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少 6 位字符" autoComplete="new-password" style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
            确认密码
            <input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="再次输入密码" autoComplete="new-password" style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
          </label>
          {message.text && <p style={{ margin: 0, fontSize: '13px', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>{message.text}</p>}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ padding: '8px 16px', border: '1px solid #d8e2ef', borderRadius: '8px', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '13px' }}>取消</button>
          <button type="submit" disabled={saving} style={{ padding: '8px 20px', border: '0', borderRadius: '8px', background: 'linear-gradient(90deg, #2563eb, #06b6d4)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>{saving ? '保存中...' : '确认修改'}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}
