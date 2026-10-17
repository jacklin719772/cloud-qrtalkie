import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

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

// 通訊錄配置彈窗（租戶端共用：訂閱帳號管理 / 試用帳號管理）
// onSave(contactBookIdOrNull) 由頁面注入（調用各自保存接口並更新本地行）；拋錯則彈窗內顯示錯誤
export default function ContactBookConfigDialog({
  open,
  accountLabel = '',
  initialContactBookId = '',
  tenantName = '',
  onClose,
  onSave,
}) {
  const [contactBooks, setContactBooks] = useState([]);
  const [selectedContactBookId, setSelectedContactBookId] = useState('');
  const [isLoadingContactBooks, setIsLoadingContactBooks] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [members, setMembers] = useState([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const membersRequestRef = useRef(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBookForm, setNewBookForm] = useState({ name: '', description: '' });
  const [newBookAccountIds, setNewBookAccountIds] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!open) return;
    setSelectedContactBookId(initialContactBookId == null ? '' : String(initialContactBookId));
    setMessage({ type: '', text: '' });
    setMembers([]);
    setIsCreateOpen(false);
    setNewBookForm({ name: '', description: '' });
    setNewBookAccountIds([]);
    setCreateMessage({ type: '', text: '' });
    loadContactBooks();
  }, [open, initialContactBookId]);

  useEffect(() => {
    if (!open) return;
    loadMembers(selectedContactBookId);
  }, [open, selectedContactBookId]);

  async function loadContactBooks() {
    setIsLoadingContactBooks(true);
    try {
      const data = await apiClient.get('/contact-books');
      setContactBooks(Array.isArray(data.contactBooks) ? data.contactBooks : []);
    } catch (error) {
      setContactBooks([]);
      setMessage({ type: 'error', text: error.message || '讀取通訊錄失敗' });
    } finally {
      setIsLoadingContactBooks(false);
    }
  }

  async function loadMembers(bookId) {
    const token = membersRequestRef.current + 1;
    membersRequestRef.current = token;
    if (!bookId) {
      setMembers([]);
      setIsLoadingMembers(false);
      return;
    }
    setIsLoadingMembers(true);
    try {
      const data = await apiClient.get(`/contact-books/${bookId}`);
      if (token !== membersRequestRef.current) return;
      setMembers(Array.isArray(data.contactBook?.includedAccounts) ? data.contactBook.includedAccounts : []);
    } catch {
      if (token === membersRequestRef.current) setMembers([]);
    } finally {
      if (token === membersRequestRef.current) setIsLoadingMembers(false);
    }
  }

  async function loadCandidates() {
    setIsLoadingCandidates(true);
    try {
      const [tenantRes, trialRes] = await Promise.allSettled([
        apiClient.get('/tenant/sip-accounts'),
        apiClient.get('/admin/trials?status=all&page=1&pageSize=500'),
      ]);
      const formal = tenantRes.status === 'fulfilled' && Array.isArray(tenantRes.value?.accounts)
        ? tenantRes.value.accounts
          .filter((account) => account.status === 'active')
          .map((account) => ({
            sipUserId: account.sipUserId,
            username: account.username || '',
            displayName: account.displayName || '',
            domain: account.domain || '',
            isTrial: false,
          }))
        : [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const trials = trialRes.status === 'fulfilled' && Array.isArray(trialRes.value?.trials)
        ? trialRes.value.trials
          .filter((trial) => {
            if (trial.status !== 'active') return false;
            const expiresAt = new Date(String(trial.expiresAt || '').slice(0, 10));
            if (Number.isNaN(expiresAt.getTime())) return false;
            expiresAt.setHours(0, 0, 0, 0);
            return expiresAt.getTime() >= today.getTime();
          })
          .map((trial) => ({
            sipUserId: trial.sipUserId,
            username: trial.username || '',
            displayName: trial.accountDisplayName || trial.username || '',
            domain: trial.sipDomain || '',
            isTrial: true,
          }))
        : [];
      const seen = new Set(formal.map((item) => item.sipUserId));
      setCandidates([...formal, ...trials.filter((item) => !seen.has(item.sipUserId))]);
    } catch {
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  }

  function openCreate() {
    setNewBookForm({ name: '', description: tenantName || '' });
    setNewBookAccountIds([]);
    setCreateMessage({ type: '', text: '' });
    setIsCreateOpen(true);
    loadCandidates();
  }

  function closeCreate() {
    if (isCreating) return;
    setIsCreateOpen(false);
    setNewBookForm({ name: '', description: '' });
    setNewBookAccountIds([]);
    setCreateMessage({ type: '', text: '' });
  }

  function toggleNewBookAccount(sipUserId) {
    setNewBookAccountIds((current) => (
      current.includes(sipUserId)
        ? current.filter((id) => id !== sipUserId)
        : [...current, sipUserId]
    ));
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (!newBookForm.name.trim()) {
      setCreateMessage({ type: 'error', text: '請輸入通訊錄名稱。' });
      return;
    }
    setIsCreating(true);
    setCreateMessage({ type: '', text: '' });
    try {
      await apiClient.post('/contact-books', {
        name: newBookForm.name.trim(),
        description: newBookForm.description.trim(),
        accountIds: newBookAccountIds,
        assignedAccountIds: [],
      });
      setIsCreateOpen(false);
      setNewBookForm({ name: '', description: '' });
      setNewBookAccountIds([]);
      await loadContactBooks();
      setMessage({ type: 'success', text: '通訊錄已建立，請在列表中選擇。' });
      window.setTimeout(() => {
        setMessage((current) => (
          current.type === 'success' && current.text === '通訊錄已建立，請在列表中選擇。'
            ? { type: '', text: '' }
            : current
        ));
      }, 5000);
    } catch (error) {
      setCreateMessage({ type: 'error', text: error.message || '新增通訊錄失敗。' });
    } finally {
      setIsCreating(false);
    }
  }

  async function submitSave(event) {
    event.preventDefault();
    if (!window.confirm(`確定要儲存${accountLabel}的通訊錄配置嗎？`)) return;
    setIsSaving(true);
    setMessage({ type: '', text: '' });
    try {
      await onSave?.(selectedContactBookId ? Number(selectedContactBookId) : null);
      onClose?.();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '通訊錄配置失敗。' });
    } finally {
      setIsSaving(false);
    }
  }

  function closeConfig() {
    if (isSaving || isCreating) return;
    onClose?.();
  }

  if (!open) return null;

  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftSelected = newBookAccountIds.includes(left.sipUserId);
    const rightSelected = newBookAccountIds.includes(right.sipUserId);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return String(left.username || '').localeCompare(String(right.username || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });

  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeConfig();
        }}
      >
        <form onSubmit={submitSave} style={{ width: 'min(560px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>通訊錄配置</h3>
            <button type="button" onClick={closeConfig} disabled={isSaving} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
          </div>
          <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>帳號</span>
              <input value={accountLabel} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊錄</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                <select
                  value={selectedContactBookId}
                  onChange={(event) => setSelectedContactBookId(event.target.value)}
                  disabled={isLoadingContactBooks || isSaving}
                  style={{ flex: '1 1 auto', minWidth: 0, padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#111827', color: '#d1d5db', outline: 'none' }}
                >
                  <option value="">未配置</option>
                  {contactBooks.map((book) => (
                    <option key={book.id} value={book.id}>{book.name}</option>
                  ))}
                </select>
                <button type="button" onClick={openCreate} disabled={isLoadingContactBooks || isSaving} style={{ flex: '0 0 auto', padding: '10px 16px', borderRadius: '6px', border: '1px solid #4b5563', background: '#374151', color: '#d1d5db', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>新建</button>
              </div>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊錄中包含的帳號 ({members.length})</span>
              <div style={{ border: '1px solid #1f2937', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ overflowY: 'auto', maxHeight: '200px', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                  {isLoadingMembers ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>載入帳號中...</div>
                  ) : members.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{selectedContactBookId ? '該通訊錄暫無帳號' : '未選擇通訊錄'}</div>
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
            {isLoadingContactBooks && <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>正在載入通訊錄...</p>}
            {!isLoadingContactBooks && contactBooks.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>暫無已創建的通訊錄。</p>}
            {message.text && <p style={{ margin: 0, fontSize: '14px', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>{message.text}</p>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
            <button type="button" onClick={closeConfig} disabled={isSaving} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
            <button className="primary-btn" type="submit" disabled={isLoadingContactBooks || isSaving}>{isSaving ? '儲存中...' : '儲存'}</button>
          </div>
        </form>
      </div>

      {isCreateOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2147483647, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreate();
          }}
        >
          <form onSubmit={submitCreate} style={{ width: 'min(680px, calc(100% - 32px))', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>新增通訊錄</h3>
              <button type="button" onClick={closeCreate} disabled={isCreating} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '18px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>名稱 <span style={{ color: '#ef4444' }}>*</span></span>
                  <input required autoComplete="off" value={newBookForm.name} onChange={(event) => setNewBookForm((form) => ({ ...form, name: event.target.value }))} placeholder="例如：開發部通訊錄" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <input type="text" autoComplete="off" value={newBookForm.description} onChange={(event) => setNewBookForm((form) => ({ ...form, description: event.target.value }))} placeholder="請輸入通訊錄描述..." style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊錄中包含的帳號 ({newBookAccountIds.length})</span>
                <div style={{ border: '1px solid #1f2937', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ overflowY: 'auto', maxHeight: '260px', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                    {isLoadingCandidates ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>載入帳號中...</div>
                    ) : sortedCandidates.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>暫無可用的 SIP 帳號</div>
                    ) : sortedCandidates.map((account) => (
                      <label key={account.sipUserId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #1f2937', cursor: 'pointer' }}>
                        <input type="checkbox" checked={newBookAccountIds.includes(account.sipUserId)} onChange={() => toggleNewBookAccount(account.sipUserId)} style={{ cursor: 'pointer' }} />
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 600, flex: '0 0 auto' }}>
                          {(account.displayName || account.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#e5e7eb', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {account.displayName || account.username || '-'}
                            {account.isTrial && <span style={{ color: '#fbbf24', border: '1px solid #fbbf24', borderRadius: '4px', padding: '0 4px', fontSize: '11px', fontWeight: 400, flex: '0 0 auto' }}>試用</span>}
                          </span>
                          <span style={{ fontSize: '12px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.username || '-'}{account.domain ? ` | ${account.domain}` : ''}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {createMessage.text && <p style={{ margin: 0, fontSize: '14px', color: createMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{createMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
              <button type="button" onClick={closeCreate} disabled={isCreating} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isCreating || !newBookForm.name.trim()}>{isCreating ? '儲存中...' : '儲存通訊錄'}</button>
            </div>
          </form>
        </div>
      )}
    </>,
    document.body,
  );
}
