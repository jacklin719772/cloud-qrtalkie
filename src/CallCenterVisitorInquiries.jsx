import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Search, Trash2 } from 'lucide-react';
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

  const fetchInquiries = async () => {
    if (!context?.id) return;
    setLoading(true);
    try {
      const limit = pageSize === 'all' ? 10000 : parseInt(pageSize, 10);
      const offset = (page - 1) * limit;
      const queryParams = new URLSearchParams({ limit, offset, keyword, startDate, endDate }).toString();

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
  }, [page, pageSize, keyword, startDate, endDate, context?.id]);

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
          color: #0f172a;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cc-btn-outline {
          background: #fff;
          border: 1px solid #cbd5e1;
          color: #475569;
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
          background: #f8fafc;
          color: #0f172a;
        }

        .cc-panel {
          background: #fff;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
          overflow: hidden;
        }

        .cc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 12px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e6eef8;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
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
          color: #94a3b8;
          pointer-events: none;
        }
        .cc-search input, .cc-date-input {
          height: 46px;
          border: 1px solid #d8e2ef;
          border-radius: 9px;
          font-size: 13px;
          outline: none;
          background: #fff;
          color: #334155;
          box-sizing: border-box;
        }
        .cc-search input { width: 100%; padding: 0 16px 0 44px; }
        .cc-date-input { padding: 0 12px; width: 140px; cursor: pointer; }
        .cc-search input:focus, .cc-date-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
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
          background: #f8fafc;
          color: #64748b;
          font-weight: 600;
          font-size: 13px;
          padding: 14px 20px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
          z-index: 1;
          letter-spacing: 0.02em;
        }
        .cc-table td {
          padding: 14px 20px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          vertical-align: middle;
          letter-spacing: 0.01em;
        }
        .cc-table tr:hover td { background: #f8fafc; transition: background 0.15s ease; }
        .cc-table tr:hover .cc-action-cell { background: #f8fafc; }

        .cc-action-head, .cc-action-cell {
          position: sticky;
          right: 0;
          box-shadow: -1px 0 0 #e2e8f0;
          width: 100px;
          min-width: 100px;
          padding-left: 8px !important;
          padding-right: 8px !important;
          text-align: center;
          background: #ffffff;
        }
        .cc-action-head { z-index: 3 !important; background: #f8fafc; }

        .cc-cell-name {
          font-weight: 600;
          color: #0f172a;
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
          color: #334155;
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
          color: #475569;
          font-size: 13px;
          line-height: 1.5;
        }
        .cc-cell-time {
          color: #64748b;
          font-size: 13px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .cc-cell-empty {
          color: #cbd5e1;
          font-size: 14px;
        }
        
        .cc-pagination {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
          border-top: 1px solid #e2e8f0;
        }
        .cc-page-controls { display: flex; align-items: center; gap: 12px; }
        .cc-page-size { height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid #d8e2ef; background: #fff; color: #475569; font-size: 11px; display: inline-flex; align-items: center; outline: none; }
        .cc-page-btn, .cc-page-current { width: 38px; height: 38px; border-radius: 8px; border: 1px solid #d8e2ef; background: #fff; color: #475569; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
        .cc-page-current { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; font-weight: 600; }
        .cc-page-btn { cursor: pointer; font-size: 18px; line-height: 1; }
        .cc-page-btn:disabled { color: #cbd5e1; cursor: not-allowed; background: #f8fafc; }
        .cc-page-jump { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 11px; }
        .cc-page-input { width: 56px; height: 36px; border-radius: 8px; border: 1px solid #d8e2ef; text-align: center; outline: none; color: #334155; font-size: 11px; }
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
            <span style={{ fontSize: '13px', color: '#64748b' }}>時間範圍：</span>
            <input
              type="date"
              className="cc-date-input"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            />
            <span style={{ fontSize: '13px', color: '#64748b' }}>至</span>
            <input
              type="date"
              className="cc-date-input"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            />
          </div>
        </div>
        <div style={{ fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
          總訪問次數：<span style={{ color: '#2563eb', fontWeight: 600 }}>{total}</span>
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
                <th className="cc-action-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>數據加載中...</td></tr>
              ) : inquiries.length === 0 ? (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>暫無訪客諮詢記錄</td></tr>
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
                  <td className="cc-action-cell">
                    <button type="button" className="cc-btn-outline" style={{ height: '30px', padding: '0 12px', fontSize: '12px', whiteSpace: 'nowrap' }} onClick={() => handleDeleteInquiry([item.id])}>
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cc-pagination">
          <div style={{ color: '#64748b', fontSize: '12px' }}>共 {total} 條</div>
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
    </section>
  );
});

export default CallCenterVisitorInquiries;