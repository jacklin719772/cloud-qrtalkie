import React, { useState, useEffect } from 'react';
import apiClient from './apiClient';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部狀態' },
  { value: 'new', label: '待處理' },
  { value: 'reviewing', label: '處理中' },
  { value: 'handled', label: '已處理' },
  { value: 'rejected', label: '已駁回' },
];

const REASON_LABELS = {
  harassment: '騷擾',
  spam: '垃圾訊息',
  other: '其他',
};

const STATUS_TONES = {
  new: { background: '#3b2f13', color: '#fbbf24', border: '1px solid #8a6116' },
  reviewing: { background: '#12303f', color: '#67e8f9', border: '1px solid #155e75' },
  handled: { background: '#132e1f', color: '#34d399', border: '1px solid #166534' },
  rejected: { background: '#331a1a', color: '#f87171', border: '1px solid #7f1d1d' },
};

const STATUS_LABELS = {
  new: '待處理',
  reviewing: '處理中',
  handled: '已處理',
  rejected: '已駁回',
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function StatusBadge({ status }) {
  const tone = STATUS_TONES[status] || STATUS_TONES.new;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '22px',
        padding: '0 10px',
        borderRadius: '999px',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        ...tone,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function ReportManagement() {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const fetchReports = async (status) => {
    setIsLoading(true);
    setError('');
    try {
      const query = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
      const data = await apiClient.get(`/platform/reports${query}`);
      const list = data?.reports || data;
      setReports(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load user reports:', err);
      setError(err?.message || '無法載入舉報列表');
      setReports([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const updateStatus = async (id, status, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(id);
    try {
      await apiClient.put(`/platform/reports/${id}`, { status });
      await fetchReports(statusFilter);
    } catch (err) {
      console.error('Failed to update user report:', err);
      window.alert(err?.response?.data?.message || '更新失敗，請稍後重試。');
    } finally {
      setBusyId(null);
    }
  };

  const actionButtonStyle = (tone) => ({
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    ...tone,
  });

  return (
    <div className="view active" id="report-management">
      <style>{`
        #report-management { padding: 0; }
        #report-management .report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        #report-management .report-note { color: #8a94a6; font-size: 12px; }
      `}</style>

      <div className="report-toolbar">
        <div>
          <div style={{ fontSize: '15px', fontWeight: 500, color: '#f3f4f6' }}>舉報管理</div>
          <div className="report-note">App 內「檢舉」提交的用戶舉報；處理狀態會即時保存。</div>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', color: '#e5e7eb', fontSize: '13px' }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {error ? (
        <div style={{ marginBottom: '10px', color: '#f87171', fontSize: '13px' }}>{error}</div>
      ) : null}

      <div className="tenant-table-wrapper">
        <table className="tenant-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
            <tr>
              <th style={{ width: '140px', background: '#1a2332' }}>提交時間</th>
              <th style={{ width: '150px', background: '#1a2332' }}>舉報人</th>
              <th style={{ width: '150px', background: '#1a2332' }}>所屬租戶</th>
              <th style={{ width: '220px', background: '#1a2332' }}>被舉報帳號</th>
              <th style={{ width: '90px', background: '#1a2332' }}>原因</th>
              <th style={{ background: '#1a2332' }}>說明</th>
              <th style={{ width: '70px', background: '#1a2332' }}>同時屏蔽</th>
              <th style={{ width: '90px', background: '#1a2332' }}>App 版本</th>
              <th style={{ width: '90px', background: '#1a2332' }}>狀態</th>
              <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '190px', textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af', fontSize: '14px' }}>載入舉報列表中...</td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af', fontSize: '14px' }}>
                  {statusFilter === 'all' ? '目前尚無舉報記錄' : '沒有符合篩選條件的舉報'}
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id}>
                  <td>{formatDateTime(report.createdAt)}</td>
                  <td style={{ color: '#f3f4f6', fontWeight: 500 }}>{report.reporterUsername || '-'}</td>
                  <td>{report.tenantName || (report.reporterTenantId != null ? `#${report.reporterTenantId}` : '-')}</td>
                  <td style={{ color: '#f3f4f6' }}>{report.targetAddress || '-'}</td>
                  <td>{REASON_LABELS[report.reason] || report.reason || '-'}</td>
                  <td title={report.detail || ''} style={{ maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {report.detail || '-'}
                  </td>
                  <td style={{ textAlign: 'center' }}>{report.blocked ? '是' : '否'}</td>
                  <td>{report.appVersion || '-'}</td>
                  <td>
                    <StatusBadge status={report.status} />
                    {report.handledAt ? (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8a94a6' }}>{formatDateTime(report.handledAt)}</div>
                    ) : null}
                  </td>
                  <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '190px', textAlign: 'center', padding: '0 12px' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                      {report.status !== 'reviewing' && report.status !== 'handled' && report.status !== 'rejected' ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={busyId === report.id}
                          style={actionButtonStyle({ background: '#12303f', color: '#67e8f9', border: '1px solid #155e75' })}
                          onClick={() => updateStatus(report.id, 'reviewing')}
                        >
                          標記處理中
                        </button>
                      ) : null}
                      {report.status !== 'handled' ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={busyId === report.id}
                          style={actionButtonStyle({ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb' })}
                          onClick={() => updateStatus(report.id, 'handled', '確認將此舉報標記為已處理？')}
                        >
                          已處理
                        </button>
                      ) : null}
                      {report.status !== 'rejected' ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={busyId === report.id}
                          style={actionButtonStyle({ background: '#3a2020', color: '#fca5a5', border: '1px solid #7f1d1d' })}
                          onClick={() => updateStatus(report.id, 'rejected', '確認駁回此舉報？')}
                        >
                          駁回
                        </button>
                      ) : null}
                      {report.status === 'handled' || report.status === 'rejected' ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={busyId === report.id}
                          style={actionButtonStyle({ background: '#374151', color: '#d1d5db', border: '1px solid #4b5563' })}
                          onClick={() => updateStatus(report.id, 'new', '確認將此舉報重新置為待處理？')}
                        >
                          重新開啟
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
