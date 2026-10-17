import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function getStatusBadge(status) {
  const map = {
    active: { label: '啟用中', bg: '#0d2818', color: '#4ade80' },
    inactive: { label: '未啟用', bg: '#1f2937', color: '#9ca3af' },
    disabled: { label: '已停用', bg: '#3b1111', color: '#fca5a5' },
    expired: { label: '已過期', bg: '#3b1111', color: '#fbbf24' },
    pending: { label: '待啟用', bg: '#1e3a5f', color: '#93c5fd' },
  };
  const item = map[status] || { label: status || '未知', bg: '#1f2937', color: '#9ca3af' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px', fontSize: '12px', lineHeight: 1.4, backgroundColor: item.bg, color: item.color }}>
      {item.label}
    </span>
  );
}

// 通訊錄詳情彈窗（只讀）：名稱/描述 + 包含帳號列表（含狀態）
export default function ContactBookViewDialog({ open, bookId, onClose }) {
  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open || !bookId) {
      if (!open) setBook(null);
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    setBook(null);
    setIsLoading(true);
    apiClient.get(`/contact-books/${bookId}`)
      .then((data) => {
        if (token === requestRef.current) setBook(data?.contactBook || null);
      })
      .catch(() => {
        if (token === requestRef.current) setBook(null);
      })
      .finally(() => {
        if (token === requestRef.current) setIsLoading(false);
      });
  }, [open, bookId]);

  if (!open) return null;

  const members = Array.isArray(book?.includedAccounts) ? book.includedAccounts : [];

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div id="contact-book-view-dialog" style={{ width: 'min(600px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <style>{`
          #contact-book-view-dialog ::-webkit-scrollbar { width: 8px; height: 8px; }
          #contact-book-view-dialog ::-webkit-scrollbar-track { background: #111827; }
          #contact-book-view-dialog ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
          #contact-book-view-dialog ::-webkit-scrollbar-corner { background: #111827; }
        `}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>通訊錄詳情</h3>
          <button type="button" onClick={onClose} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        <div style={{ overflow: 'auto', flex: 1, padding: '18px', scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}>
          {isLoading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入中...</div>
          ) : !book ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>無法讀取通訊錄詳情</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>名稱</span>
                  <input value={book.name || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <input value={book.description || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊錄中包含的帳號 ({members.length})</span>
                <div style={{ border: '1px solid #1f2937', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ overflowY: 'auto', maxHeight: '280px', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                    {members.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>該通訊錄暫無帳號</div>
                    ) : members.map((member) => (
                      <div key={member.sipUserId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 600, flex: '0 0 auto' }}>
                          {(member.displayName || member.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '14px', color: '#e5e7eb', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.displayName || member.username || '-'}</span>
                          <span style={{ fontSize: '12px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.username || '-'}{member.domain ? ` | ${member.domain}` : ''}</span>
                        </div>
                        {getStatusBadge(member.status)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>關閉</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
