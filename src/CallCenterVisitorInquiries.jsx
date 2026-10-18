import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Search, RefreshCw, MoreVertical, Mail, Forward } from 'lucide-react';
import apiClient from './apiClient';

const CallCenterVisitorInquiries = forwardRef(({ onReturn, context }, ref) => {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [centerName, setCenterName] = useState('');
  const [selectedInquiryIds, setSelectedInquiryIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [menuItem, setMenuItem] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [detailItem, setDetailItem] = useState(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyMessage, setReplyMessage] = useState({ type: '', text: '' });
  const [forwardEmail, setForwardEmail] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [forwardSending, setForwardSending] = useState(false);
  const [forwardMessage, setForwardMessage] = useState({ type: '', text: '' });
  const [processItem, setProcessItem] = useState(null);
  const [processStatus, setProcessStatus] = useState('processed');
  const [processNote, setProcessNote] = useState('');
  const [processSaving, setProcessSaving] = useState(false);
  const [processMessage, setProcessMessage] = useState({ type: '', text: '' });

  const fetchInquiries = async () => {
    if (!context?.id) return;
    setLoading(true);
    try {
      const limit = pageSize === 'all' ? 10000 : parseInt(pageSize, 10);
      const offset = (page - 1) * limit;
      const queryParams = new URLSearchParams({ limit, offset, keyword, startDate, endDate, status: statusFilter }).toString();

      const res = await apiClient.get(`/call-centers/${context.id}/visitor-inquiries?${queryParams}`);
      if (res && res.code === 0 && res.data) {
        setInquiries(res.data.list);
        setTotal(res.data.total || 0);
        setCenterName(res.data.centerName || '');
        setSelectedInquiryIds([]); // 清空选中
      }
    } catch (error) {
      console.error('獲取訪客記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInquiries();
  }, [page, pageSize, keyword, startDate, endDate, statusFilter, context?.id]);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedInquiryIds(inquiries.map(item => item.id));
    } else {
      setSelectedInquiryIds([]);
    }
  };

  const handleSelectOne = (id, e) => {
    if (e.target.checked) {
      setSelectedInquiryIds(prev => [...prev, id]);
    } else {
      setSelectedInquiryIds(prev => prev.filter(item => item !== id));
    }
  };

  const handleDeleteInquiry = async (idsToDelete) => {
    if (idsToDelete.length === 0) return;
    if (!window.confirm(`確定要刪除選中的 ${idsToDelete.length} 條訪客記錄嗎？此操作不可逆。`)) return;

    setLoading(true);
    try {
      const res = await apiClient.delete(`/call-centers/${context.id}/visitor-inquiries`, { data: { ids: idsToDelete } });
      if (res && res.code === 0) {
        setSelectedInquiryIds([]);
        fetchInquiries();
      } else {
        alert(res?.message || '刪除失敗');
      }
    } catch (error) {
      console.error('刪除訪客記錄失敗:', error);
      alert(error.response?.data?.message || error.message || '刪除訪客記錄失敗');
    } finally {
      setLoading(false);
    }
  };

  const openActionMenu = (event, item) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 168) });
    setMenuItem(item);
  };

  const openDetail = (item) => {
    const name = item.visitorName && item.visitorName !== '-' ? item.visitorName : '';
    setDetailItem(item);
    setReplySubject(`回覆：${centerName || '呼叫中心'} 諮詢${name ? `（${name}）` : ''}`);
    setReplyBody(`您好${name ? `，${name}` : ''}：\n\n\n\n—— 您原先的留言 ——\n${item.visitorMessage || ''}`);
    setReplyMessage({ type: '', text: '' });
    setReplySending(false);
    setForwardEmail('');
    setForwardNote('');
    setForwardMessage({ type: '', text: '' });
    setForwardSending(false);
  };

  const openProcess = (item) => {
    setMenuItem(null);
    setProcessItem(item);
    setProcessStatus(String(item.status || '').toLowerCase() === 'processed' ? 'processed' : 'submitted');
    setProcessNote(item.note || '');
    setProcessMessage({ type: '', text: '' });
    setProcessSaving(false);
  };

  const handleProcessSave = async () => {
    if (!processItem) return;
    setProcessSaving(true);
    setProcessMessage({ type: '', text: '' });
    try {
      const res = await apiClient.put(`/call-centers/${context.id}/visitor-inquiries/${processItem.id}/status`, {
        status: processStatus,
        note: processNote.trim(),
      });
      const nextStatus = res?.status || processStatus;
      const nextNote = typeof res?.note === 'string' ? res.note : processNote.trim();
      setDetailItem(prev => (prev && prev.id === processItem.id ? { ...prev, status: nextStatus, note: nextNote } : prev));
      setProcessItem(null);
      await fetchInquiries();
    } catch (error) {
      setProcessMessage({ type: 'error', text: error.message || '保存辦理狀態失敗。' });
      window.setTimeout(() => setProcessMessage(prev => (prev.type === 'error' ? { type: '', text: '' } : prev)), 5000);
    } finally {
      setProcessSaving(false);
    }
  };

  const handleReplySend = async () => {
    if (!detailItem) return;
    if (!replyBody.trim()) {
      setReplyMessage({ type: 'error', text: '請輸入回覆內容。' });
      window.setTimeout(() => setReplyMessage(prev => (prev.type === 'error' ? { type: '', text: '' } : prev)), 5000);
      return;
    }
    setReplySending(true);
    setReplyMessage({ type: '', text: '' });
    try {
      const res = await apiClient.post(`/call-centers/${context.id}/visitor-inquiries/${detailItem.id}/reply`, {
        subject: replySubject.trim(),
        body: replyBody,
      });
      setReplyMessage({ type: 'success', text: res?.message || '回覆郵件已發送。' });
      window.setTimeout(() => setReplyMessage(prev => (prev.type === 'success' ? { type: '', text: '' } : prev)), 5000);
    } catch (error) {
      setReplyMessage({ type: 'error', text: error.message || '回覆郵件發送失敗。' });
      window.setTimeout(() => setReplyMessage(prev => (prev.type === 'error' ? { type: '', text: '' } : prev)), 5000);
    } finally {
      setReplySending(false);
    }
  };

  const handleForwardSend = async () => {
    if (!detailItem) return;
    const email = forwardEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForwardMessage({ type: 'error', text: '請輸入有效的收件郵箱。' });
      window.setTimeout(() => setForwardMessage(prev => (prev.type === 'error' ? { type: '', text: '' } : prev)), 5000);
      return;
    }
    setForwardSending(true);
    setForwardMessage({ type: '', text: '' });
    try {
      const res = await apiClient.post(`/call-centers/${context.id}/visitor-inquiries/${detailItem.id}/forward`, {
        email,
        note: forwardNote.trim(),
      });
      setForwardMessage({ type: 'success', text: res?.message || '已轉發該訪客留言。' });
      window.setTimeout(() => setForwardMessage(prev => (prev.type === 'success' ? { type: '', text: '' } : prev)), 5000);
    } catch (error) {
      setForwardMessage({ type: 'error', text: error.message || '轉發郵件發送失敗。' });
      window.setTimeout(() => setForwardMessage(prev => (prev.type === 'error' ? { type: '', text: '' } : prev)), 5000);
    } finally {
      setForwardSending(false);
    }
  };

  useImperativeHandle(ref, () => ({
    handleBatchDelete() {
      if (selectedInquiryIds.length === 0) {
        alert('請先選擇要刪除的訪客記錄');
        return;
      }
      handleDeleteInquiry(selectedInquiryIds);
    },
  }), [selectedInquiryIds]);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  const isVisitorEmail = Boolean(
    detailItem && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(detailItem.visitorEmail || '')),
  );

  return (
    <section className="cc-inquiries-page">
      <style>{`
        .cc-inquiries-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          padding: 0;
          box-sizing: border-box;
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .cc-page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .cc-page-header h2 {
          margin: 0;
          font-size: 20px;
          color: #f3f4f6;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cc-btn-outline {
          background: #1f2937;
          border: 1px solid #374151;
          color: #d1d5db;
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .cc-btn-outline:hover {
          background: #374151;
          color: #f3f4f6;
        }

        .cc-panel {
          background: #111827;
          border-radius: 16px;
          border: 1px solid #1f2937;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }

        .cc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 12px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
          flex-shrink: 0;
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .cc-toolbar::-webkit-scrollbar { height: 0; }
        .cc-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        .cc-search {
          position: relative;
          width: 220px;
          flex: 0 0 220px;
        }
        .cc-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #6b7280;
          pointer-events: none;
        }
        .cc-search input, .cc-date-input {
          height: 46px;
          border: 1px solid #374151;
          border-radius: 9px;
          font-size: 13px;
          outline: none;
          background: #1a2332;
          color: #e5e7eb;
          box-sizing: border-box;
          color-scheme: dark;
        }
        .cc-search input { width: 100%; padding: 0 16px 0 44px; }
        .cc-date-input { padding: 0 12px; width: 140px; cursor: pointer; }
        .cc-search input::placeholder { color: #6b7280; }
        .cc-search input:focus, .cc-date-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
        }

        .cc-table-wrap {
          flex: 1;
          overflow: auto;
        }
        .cc-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1000px;
          text-align: left;
        }
        .cc-table th {
          position: sticky;
          top: 0;
          background: #0f172a;
          color: #9ca3af;
          font-weight: 600;
          font-size: 13px;
          padding: 14px 20px;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
          z-index: 1;
          letter-spacing: 0.02em;
        }
        .cc-table td {
          padding: 14px 20px;
          border-bottom: 1px solid #1f2937;
          color: #d1d5db;
          font-size: 14px;
          vertical-align: middle;
          letter-spacing: 0.01em;
        }
        .cc-table tr:hover td { background: #1a2332; transition: background 0.15s ease; }
        .cc-table tr:hover .cc-action-cell { background: #1a2332; }
        .cc-table input[type="checkbox"] { accent-color: #3b82f6; }

        .cc-action-head, .cc-action-cell {
          position: sticky;
          right: 0;
          box-shadow: -1px 0 0 #1f2937;
          width: 100px;
          min-width: 100px;
          padding-left: 8px !important;
          padding-right: 8px !important;
          text-align: center;
          background: #111827;
        }
        .cc-action-head { z-index: 3 !important; background: #0f172a; }

        .cc-cell-name {
          font-weight: 600;
          color: #f3f4f6;
          font-size: 14px;
          max-width: 140px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-block;
          vertical-align: middle;
        }
        .cc-cell-text {
          font-size: 14px;
          color: #d1d5db;
          max-width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-block;
          vertical-align: middle;
        }
        .cc-cell-message {
          max-width: 300px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #9ca3af;
          font-size: 13px;
          line-height: 1.5;
        }
        .cc-cell-time {
          color: #9ca3af;
          font-size: 13px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .cc-cell-empty {
          color: #6b7280;
          font-size: 14px;
        }

        .cc-pagination {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #111827;
          border-top: 1px solid #1f2937;
        }
        .cc-page-controls { display: flex; align-items: center; gap: 12px; }
        .cc-page-size { height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid #374151; background: #1a2332; color: #d1d5db; font-size: 11px; display: inline-flex; align-items: center; outline: none; color-scheme: dark; }
        .cc-page-btn, .cc-page-current { width: 38px; height: 38px; border-radius: 8px; border: 1px solid #374151; background: #1a2332; color: #d1d5db; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
        .cc-page-current { border-color: #3b82f6; color: #60a5fa; background: #1e3a5f; font-weight: 600; }
        .cc-page-btn { cursor: pointer; font-size: 18px; line-height: 1; }
        .cc-page-btn:disabled { color: #4b5563; cursor: not-allowed; background: #111827; }
        .cc-page-jump { display: flex; align-items: center; gap: 8px; color: #9ca3af; font-size: 11px; }
        .cc-page-input { width: 56px; height: 36px; border-radius: 8px; border: 1px solid #374151; text-align: center; outline: none; color: #e5e7eb; font-size: 11px; background: #1a2332; }
        .cc-refresh-btn { width: 46px; height: 46px; padding: 0; justify-content: center; }
        .cc-refresh-spin { animation: cc-spin 1s linear infinite; }
        @keyframes cc-spin { to { transform: rotate(360deg); } }
        .cc-more-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #374151; background: #1a2332; color: #9ca3af; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .cc-more-btn:hover { background: #374151; color: #f3f4f6; }
        .cc-action-menu { position: fixed; width: 160px; background: #111827; border: 1px solid #1f2937; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.45); padding: 4px; z-index: 1001; }
        .cc-action-menu button { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: transparent; color: #d1d5db; font-size: 13px; border-radius: 6px; cursor: pointer; }
        .cc-action-menu button:hover { background: #1f2937; color: #f3f4f6; }
        .cc-action-menu button.danger { color: #f87171; }
        .cc-action-menu button.danger:hover { background: #3b1111; }
        .cc-status-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 500; white-space: nowrap; }
        .cc-status-badge.processed { background: rgba(22,163,74,0.18); color: #86efac; }
        .cc-status-badge.pending { background: rgba(245,158,11,0.16); color: #fbbf24; }
        .cc-detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.62); display: flex; align-items: center; justify-content: center; z-index: 1200; padding: 20px; }
        .cc-detail-modal { width: 720px; max-width: 94vw; max-height: 90vh; background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); display: flex; flex-direction: column; overflow: hidden; }
        .cc-detail-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #1f2937; background: #1a2332; }
        .cc-detail-body { overflow-y: auto; padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; scrollbar-color: #4b5563 #1b2432; }
        .cc-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; font-size: 13px; color: #d1d5db; }
        .cc-detail-label { color: #9ca3af; font-size: 12px; margin-bottom: 2px; }
        .cc-detail-message { background: #0f172a; border: 1px solid #1f2937; border-radius: 8px; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; color: #d1d5db; font-size: 13px; line-height: 1.7; }
        .cc-detail-section { border-top: 1px solid #1f2937; padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
        .cc-detail-section h4 { margin: 0; font-size: 14px; color: #f3f4f6; }
        .cc-detail-input, .cc-detail-textarea { width: 100%; border: 1px solid #374151; border-radius: 8px; padding: 9px 12px; font-size: 13px; color: #e5e7eb; outline: none; box-sizing: border-box; background: #1a2332; }
        .cc-detail-input::placeholder, .cc-detail-textarea::placeholder { color: #6b7280; }
        .cc-detail-input:focus, .cc-detail-textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }
        .cc-detail-textarea { min-height: 110px; resize: vertical; font-family: inherit; line-height: 1.6; }
        .cc-detail-primary { height: 36px; padding: 0 16px; border: none; border-radius: 8px; background: #2563eb; color: #fff; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .cc-detail-primary:disabled { opacity: .6; cursor: not-allowed; }
        .cc-detail-hint { font-size: 12px; color: #9ca3af; }
`}</style>

<div className="cc-toolbar">
        <div className="cc-filter-left">
          <label className="cc-search">
            <Search size={18} />
            <input
              type="search"
              placeholder="搜尋姓名、電話、郵箱、內容"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>時間範圍：</span>
            <input
              type="date"
              className="cc-date-input"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            />
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>至</span>
            <input
              type="date"
              className="cc-date-input"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#9ca3af' }}>狀態：</span>
            <select
              className="cc-date-input"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="all">全部</option>
              <option value="pending">未處理</option>
              <option value="processed">已處理</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <button type="button" className="cc-btn-outline cc-refresh-btn" onClick={fetchInquiries} disabled={loading} title="刷新最新訪客留言">
            <RefreshCw size={17} className={loading ? 'cc-refresh-spin' : ''} />
          </button>
          <div style={{ fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
            總訪問次數：<span style={{ color: '#60a5fa', fontWeight: 600 }}>{total}</span>
          </div>
        </div>
      </div>

      <div className="cc-panel">
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th style={{ width: '48px', textAlign: 'center' }}>
                  <input 
                    type="checkbox" 
                    style={{ cursor: 'pointer' }}
                    checked={inquiries.length > 0 && inquiries.every(item => selectedInquiryIds.includes(item.id))}
                    onChange={handleSelectAll}
                  />
                </th>
                <th>訪客姓名</th>
                <th>電話</th>
                <th>郵箱</th>
                <th>公司</th>
                <th>留言對象</th>
                <th style={{ maxWidth: '300px' }}>諮詢內容</th>
                <th>登記時間</th>
                <th>狀態</th>
                <th className="cc-action-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>數據加載中...</td></tr>
              ) : inquiries.length === 0 ? (
                <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>暫無訪客諮詢記錄</td></tr>
              ) : inquiries.map(item => (
                <tr key={item.id}>
                  <td style={{ width: '48px', textAlign: 'center' }}>
                    <input 
                      type="checkbox" 
                      style={{ cursor: 'pointer' }}
                      checked={selectedInquiryIds.includes(item.id)}
                      onChange={(e) => handleSelectOne(item.id, e)}
                    />
                  </td>
                  <td><span className="cc-cell-name" title={item.visitorName}>{item.visitorName || '-'}</span></td>
                  <td><span className="cc-cell-text" title={item.visitorPhone}>{item.visitorPhone || '-'}</span></td>
                  <td><span className="cc-cell-text" title={item.visitorEmail}>{item.visitorEmail || '-'}</span></td>
                  <td><span className="cc-cell-text" title={item.visitorCompany}>{item.visitorCompany || '-'}</span></td>
                  <td>
                    {item.agentName ? (
                      <span className="cc-cell-text" title={`${item.categoryName || ''} / ${item.agentName}`}>
                        {item.categoryName ? `${item.categoryName} / ` : ''}{item.agentName}
                      </span>
                    ) : (
                      <span className="cc-cell-empty">-</span>
                    )}
                  </td>
                  <td><span className="cc-cell-message" title={item.visitorMessage}>{item.visitorMessage || '-'}</span></td>
                  <td><span className="cc-cell-time">{formatDate(item.createdAt)}</span></td>
                  <td>
                    <span className={`cc-status-badge ${item.status === 'processed' ? 'processed' : 'pending'}`}>
                      {item.status === 'processed' ? '已處理' : '未處理'}
                    </span>
                  </td>
                  <td className="cc-action-cell">
                    <button type="button" className="cc-more-btn" title="更多操作" onClick={(e) => openActionMenu(e, item)}>
                      <MoreVertical size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cc-pagination">
          <div style={{ color: '#9ca3af', fontSize: '12px' }}>共 {total} 條</div>
          <div className="cc-page-controls">
            <select 
              className="cc-page-size" 
              value={pageSize}
              onChange={(e) => { setPageSize(e.target.value); setPage(1); }}
            >
              <option value="10">10 條/頁</option>
              <option value="20">20 條/頁</option>
              <option value="50">50 條/頁</option>
              <option value="all">全部</option>
            </select>
            <button type="button" className="cc-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span className="cc-page-current">{page}</span>
            <button type="button" className="cc-page-btn" disabled={pageSize === 'all' || page * parseInt(pageSize, 10) >= total} onClick={() => setPage(p => p + 1)}>›</button>
            <span className="cc-page-jump">
              前往
              <input 
                className="cc-page-input" 
                defaultValue={page} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val) && val > 0) setPage(val);
                  }
                }} 
              />
              頁
            </span>
          </div>
        </div>
      </div>

      {menuItem && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={() => setMenuItem(null)}>
          <div className="cc-action-menu" style={{ top: menuPosition.top, left: menuPosition.left }} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => { const item = menuItem; setMenuItem(null); openDetail(item); }}>詳情</button>
            <button type="button" onClick={() => openProcess(menuItem)}>辦理</button>
            <button type="button" className="danger" onClick={() => { const item = menuItem; setMenuItem(null); handleDeleteInquiry([item.id]); }}>刪除</button>
          </div>
        </div>,
        document.body
      )}

      {processItem && createPortal(
        <div className="cc-detail-overlay" onClick={() => { if (!processSaving) setProcessItem(null); }}>
          <div className="cc-detail-modal" style={{ width: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="cc-detail-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#f3f4f6' }}>辦理訪客留言</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>{processItem.visitorName || '-'} · {formatDate(processItem.createdAt)}</p>
              </div>
              <button type="button" onClick={() => { if (!processSaving) setProcessItem(null); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px' }}>×</button>
            </div>
            <div className="cc-detail-body">
              <div>
                <div className="cc-detail-label">辦理狀態</div>
                <select className="cc-detail-input" value={processStatus} onChange={(e) => setProcessStatus(e.target.value)}>
                  <option value="processed">已辦理</option>
                  <option value="submitted">未辦理</option>
                </select>
              </div>
              <div>
                <div className="cc-detail-label">辦理過程描述</div>
                <textarea
                  className="cc-detail-textarea"
                  value={processNote}
                  onChange={(e) => setProcessNote(e.target.value)}
                  placeholder="記錄本次辦理過程、結果或後續安排"
                  maxLength={2000}
                />
              </div>
              {processMessage.text && (
                <div className="cc-detail-hint" style={{ color: processMessage.type === 'error' ? '#f87171' : '#86efac' }}>{processMessage.text}</div>
              )}
              <div className="cc-detail-actions">
                <button type="button" className="cc-btn-outline" onClick={() => setProcessItem(null)} disabled={processSaving}>取消</button>
                <button type="button" className="cc-detail-primary" onClick={handleProcessSave} disabled={processSaving}>{processSaving ? '儲存中...' : '儲存'}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {detailItem && createPortal(
        <div className="cc-detail-overlay" onClick={() => setDetailItem(null)}>
          <div className="cc-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cc-detail-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#f3f4f6' }}>訪客留言詳情</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>{centerName}</p>
              </div>
              <button type="button" onClick={() => setDetailItem(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '20px' }}>×</button>
            </div>
            <div className="cc-detail-body">
              <div className="cc-detail-grid">
                <div><div className="cc-detail-label">訪客姓名</div>{detailItem.visitorName || '-'}</div>
                <div><div className="cc-detail-label">電話</div>{detailItem.visitorPhone || '-'}</div>
                <div><div className="cc-detail-label">郵箱</div>{detailItem.visitorEmail || '-'}</div>
                <div><div className="cc-detail-label">公司</div>{detailItem.visitorCompany || '-'}</div>
                <div>
                  <div className="cc-detail-label">留言對象</div>
                  {detailItem.agentName ? `${detailItem.categoryName ? `${detailItem.categoryName} / ` : ''}${detailItem.agentName}` : '-'}
                </div>
                <div><div className="cc-detail-label">登記時間</div>{formatDate(detailItem.createdAt)}</div>
                <div>
                  <div className="cc-detail-label">處理狀態</div>
                  <span className={`cc-status-badge ${detailItem.status === 'processed' ? 'processed' : 'pending'}`}>
                    {detailItem.status === 'processed' ? '已處理' : '未處理'}
                  </span>
                </div>
              </div>
              <div>
                <div className="cc-detail-label">留言內容</div>
                <div className="cc-detail-message">{detailItem.visitorMessage || '-'}</div>
              </div>

              {detailItem.note && (
                <div>
                  <div className="cc-detail-label">辦理過程描述</div>
                  <div className="cc-detail-message">{detailItem.note}</div>
                </div>
              )}

              {isVisitorEmail && (
                <div className="cc-detail-section">
                  <h4><Mail size={15} style={{ verticalAlign: '-2px', marginRight: '6px' }} />回覆訪客</h4>
                  <input className="cc-detail-input" value={replySubject} onChange={(e) => setReplySubject(e.target.value)} placeholder="郵件主旨" autoComplete="off" />
                  <textarea className="cc-detail-textarea" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="輸入回覆內容" />
                  {replyMessage.text && (
                    <div className="cc-detail-hint" style={{ color: replyMessage.type === 'error' ? '#dc2626' : '#15803d' }}>{replyMessage.text}</div>
                  )}
                  <div className="cc-detail-actions">
                    <button type="button" className="cc-detail-primary" onClick={handleReplySend} disabled={replySending}>
                      <Mail size={14} />{replySending ? '發送中...' : '發送回覆郵件'}
                    </button>
                  </div>
                </div>
              )}

              <div className="cc-detail-section">
                <h4><Forward size={15} style={{ verticalAlign: '-2px', marginRight: '6px' }} />轉發處理</h4>
                <input className="cc-detail-input" type="email" value={forwardEmail} onChange={(e) => setForwardEmail(e.target.value)} placeholder="收件人郵箱" autoComplete="off" />
                <textarea className="cc-detail-textarea" style={{ minHeight: '80px' }} value={forwardNote} onChange={(e) => setForwardNote(e.target.value)} placeholder="備註（選填）" />
                {forwardMessage.text && (
                  <div className="cc-detail-hint" style={{ color: forwardMessage.type === 'error' ? '#dc2626' : '#15803d' }}>{forwardMessage.text}</div>
                )}
                <div className="cc-detail-actions">
                  <button type="button" className="cc-detail-primary" onClick={handleForwardSend} disabled={forwardSending}>
                    <Forward size={14} />{forwardSending ? '發送中...' : '轉發郵件'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
});

export default CallCenterVisitorInquiries;