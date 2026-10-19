import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, RefreshCw, Trash2 } from 'lucide-react';
import apiClient from './apiClient';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '-';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

function formatTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusLabels = { success: '成功', running: '備份中', failed: '失敗' };

export default function BackupManagement() {
  const [backups, setBackups] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });
  const pollRef = useRef(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiClient.get('/platform/backups');
      const payload = res?.data || res || {};
      setBackups(Array.isArray(payload.backups) ? payload.backups : []);
      setSettings(payload.settings || {});
      return Array.isArray(payload.backups) ? payload.backups : [];
    } catch (err) {
      showMessage('error', err?.data?.message || err?.message || '讀取備份列表失敗。');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadData]);

  const pollUntilDone = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const list = await loadData({ silent: true });
      if (!list.some((item) => item.status === 'running')) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setCreating(false);
      }
    }, 3000);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await apiClient.post('/platform/backups');
      const record = res?.data || {};
      showMessage('success', `備份已開始：${record.filename || record.version || ''}`);
      await loadData({ silent: true });
      pollUntilDone();
    } catch (err) {
      setCreating(false);
      showMessage('error', err?.data?.message || err?.message || '建立備份失敗。');
    }
  };

  const handleDownload = async (row) => {
    if (row.status !== 'success') return;
    setDownloadingId(row.id);
    try {
      const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
      const response = await fetch(`/api/platform/backups/${row.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        let text = '';
        try { text = await response.text(); } catch {}
        throw new Error(text || `下載失敗（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = row.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMessage('success', '備份已開始下載。');
    } catch (err) {
      showMessage('error', err?.message || '下載備份失敗。');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`確定刪除備份 ${row.filename}？此操作不可恢復。`)) return;
    setDeletingId(row.id);
    try {
      await apiClient.delete(`/platform/backups/${row.id}`);
      showMessage('success', '備份已刪除。');
      await loadData({ silent: true });
    } catch (err) {
      showMessage('error', err?.data?.message || err?.message || '刪除備份失敗。');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="view active" id="backup-management">
      <style>{`
        .bkm-panel { background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 10px 26px rgba(0,0,0,0.2); overflow: hidden; }
        .bkm-table-wrap { overflow: auto; max-height: calc(100dvh - 250px); }
        .bkm-table-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
        .bkm-table-wrap::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
        .bkm-table-wrap::-webkit-scrollbar-track { background: #111827; }
        .bkm-table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 13px; }
        .bkm-table th { height: 52px; padding: 0 14px; text-align: left; font-weight: 600; font-size: 12px; color: #e5e7eb; background: #1a2332; border-bottom: 1px solid #1f2937; white-space: nowrap; position: sticky; top: 0; z-index: 2; }
        .bkm-table td { height: 60px; padding: 0 14px; color: #e5e7eb; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .bkm-table tr:hover td { background: #1e293b; }
        .bkm-file { font-family: monospace; font-size: 12px; }
        .bkm-badge { display: inline-flex; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .bkm-badge.success { background: #dcfce7; color: #15803d; }
        .bkm-badge.running { background: #fef3c7; color: #b45309; }
        .bkm-badge.failed { background: #fee2e2; color: #dc2626; }
        .bkm-action-btn { padding: 5px 12px; border-radius: 8px; border: 1px solid #4b5563; background: #374151; color: #d1d5db; font-size: 12px; cursor: pointer; margin-right: 6px; display: inline-flex; align-items: center; gap: 4px; }
        .bkm-action-btn:hover { background: #4b5563; color: #f3f4f6; }
        .bkm-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .bkm-action-btn.danger { color: #fca5a5; border-color: #7f1d1d; }
        .bkm-action-btn.danger:hover { background: #3b1111; }
        .bkm-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .bkm-note { font-size: 12px; color: #9ca3af; line-height: 1.7; }
        .bkm-primary { height: 38px; padding: 0 16px; border: 0; border-radius: 8px; background: linear-gradient(90deg,#2563eb,#4f46e5); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .bkm-primary:disabled { opacity: 0.6; cursor: wait; }
        .bkm-secondary { height: 38px; padding: 0 14px; border: 1px solid #374151; border-radius: 8px; background: #1f2937; color: #93c5fd; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .bkm-empty { padding: 40px 20px; text-align: center; color: #9ca3af; font-size: 13px; }
      `}</style>

      {message.text && (
        <div style={{ padding: '9px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', background: message.type === 'error' ? '#7f1d1d' : '#065f46', color: message.type === 'error' ? '#fecaca' : '#a7f3d0' }}>
          {message.text}
        </div>
      )}

      <div className="bkm-toolbar">
        <div className="bkm-note">
          每日 {settings.scheduleHour ?? 3}:00（{settings.timezone || 'Asia/Hong_Kong'}）自動備份，保留 {settings.retentionDays ?? 7} 天。<br />
          備份包已加密，下載後需輸入密碼。
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="bkm-secondary" onClick={() => loadData()} disabled={loading}>
            <RefreshCw size={15} />{loading ? '載入中...' : '刷新'}
          </button>
          <button type="button" className="bkm-primary" onClick={handleCreate} disabled={creating || loading}>
            <Archive size={15} />{creating ? '備份中...' : '立即備份'}
          </button>
        </div>
      </div>

      <div className="bkm-panel">
        <div className="bkm-table-wrap">
          <table className="bkm-table">
            <thead>
              <tr>
                <th>備份檔案</th>
                <th>建立時間</th>
                <th>大小</th>
                <th>類型</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 ? (
                <tr><td colSpan="6"><div className="bkm-empty">暫無備份記錄</div></td></tr>
              ) : backups.map((row) => (
                <tr key={row.id}>
                  <td className="bkm-file">{row.filename}</td>
                  <td>{formatTime(row.createdAt || row.startedAt)}</td>
                  <td>{formatBytes(row.sizeBytes)}</td>
                  <td>{row.type === 'scheduled' ? '定時' : '手動'}</td>
                  <td>
                    <span className={`bkm-badge ${row.status}`}>{statusLabels[row.status] || row.status}</span>
                    {row.status === 'failed' && row.errorMessage && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#fca5a5' }} title={row.errorMessage}>查看錯誤</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="bkm-action-btn" disabled={row.status !== 'success' || downloadingId === row.id} onClick={() => handleDownload(row)}>
                      <Download size={13} />{downloadingId === row.id ? '下載中...' : '下載'}
                    </button>
                    <button type="button" className="bkm-action-btn danger" disabled={deletingId === row.id} onClick={() => handleDelete(row)}>
                      <Trash2 size={13} />{deletingId === row.id ? '刪除中...' : '刪除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
