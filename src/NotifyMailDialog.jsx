import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

// 發送通知郵件彈窗：收件人默認登記郵箱（可改），正文取 getBody() 的當前內容
export default function NotifyMailDialog({ open, defaultEmail = '', sendPath, getBody, onClose }) {
  const [form, setForm] = useState({ email: '' });
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const getBodyRef = useRef(getBody);
  getBodyRef.current = getBody;

  useEffect(() => {
    if (!open) return;
    setForm({ email: defaultEmail || '' });
    setMessage({ type: '', text: '' });
  }, [open, defaultEmail]);

  function close() {
    if (isSending) return;
    onClose?.();
    setMessage({ type: '', text: '' });
  }

  async function submit(event) {
    event.preventDefault();
    const email = form.email.trim();
    if (!email) {
      setMessage({ type: 'error', text: '請輸入收件人郵箱。' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ type: 'error', text: '請輸入有效的電子郵件地址。' });
      return;
    }
    const body = String(getBodyRef.current?.() || '');
    if (!body.trim()) {
      setMessage({ type: 'error', text: '郵件內容不能為空。' });
      return;
    }
    setIsSending(true);
    setMessage({ type: '', text: '' });
    try {
      await apiClient.post(sendPath, { email, body });
      setMessage({ type: 'success', text: '郵件已發送。' });
      window.setTimeout(() => {
        onClose?.();
        setMessage({ type: '', text: '' });
      }, 1200);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '郵件發送失敗，請稍後重試。' });
    } finally {
      setIsSending(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form onSubmit={submit} style={{ width: 'min(520px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>發送電子郵件</h3>
          <button type="button" onClick={close} disabled={isSending} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>收件人郵箱</span>
            <input
              type="email"
              autoComplete="off"
              autoFocus
              value={form.email}
              onChange={(event) => setForm({ email: event.target.value })}
              placeholder="請輸入收件人郵箱"
              style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
            />
          </label>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>郵件內容為「通知文案」的當前內容（含手動編輯）。</p>
          {message.text && (
            <p style={{ margin: 0, fontSize: '14px', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>{message.text}</p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
          <button type="button" onClick={close} disabled={isSending} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
          <button className="primary-btn" type="submit" disabled={isSending}>{isSending ? '發送中...' : '發送'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
