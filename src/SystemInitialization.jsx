import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import apiClient from './apiClient';

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0 B';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function groupPreviewRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!Number(row.count)) continue;
    const key = row.group || 'other';
    if (!groups.has(key)) groups.set(key, { key, label: row.groupLabel || key, items: [] });
    groups.get(key).items.push(row);
  }
  return [...groups.values()];
}

const steps = [
  { key: 'verify', label: '驗證管理員' },
  { key: 'warning', label: '確認警告' },
  { key: 'backup', label: '建立備份' },
  { key: 'execute', label: '確認執行' },
];

export default function SystemInitialization({ onLogout }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('verify');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [backupJob, setBackupJob] = useState(null);
  const [backupStarting, setBackupStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ received: 0, total: 0 });
  const [downloadMode, setDownloadMode] = useState('');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [backupChecked, setBackupChecked] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [executing, setExecuting] = useState(false);
  const [run, setRun] = useState(null);
  const [backupDeleted, setBackupDeleted] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const backupPollRef = useRef(null);
  const runPollRef = useRef(null);
  const downloadAbortRef = useRef(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 6000);
  };

  useEffect(() => {
    return () => {
      if (backupPollRef.current) clearInterval(backupPollRef.current);
      if (runPollRef.current) clearInterval(runPollRef.current);
    };
  }, []);

  const resetFlow = () => {
    if (backupPollRef.current) clearInterval(backupPollRef.current);
    if (runPollRef.current) clearInterval(runPollRef.current);
    if (downloadAbortRef.current) {
      try { downloadAbortRef.current.abort(); } catch {}
      downloadAbortRef.current = null;
    }
    setStep('verify');
    setEmail('');
    setPassword('');
    setVerification(null);
    setWarningAccepted(false);
    setBackupJob(null);
    setBackupStarting(false);
    setDownloading(false);
    setDownloadProgress({ received: 0, total: 0 });
    setDownloadMode('');
    setBackupDownloaded(false);
    setBackupChecked(false);
    setPhrase('');
    setExecuting(false);
    setRun(null);
    setBackupDeleted(false);
    setDeletingBackup(false);
    setMessage({ type: '', text: '' });
  };

  const openDialog = () => {
    resetFlow();
    setOpen(true);
  };

  const closeDialog = () => {
    if (executing) return;
    setOpen(false);
  };

  const handleVerify = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      showMessage('error', '請輸入超級管理員帳號與密碼。');
      return;
    }
    setVerifying(true);
    try {
      const res = await apiClient.post('/platform/system-initialization/verify', {
        email: email.trim(),
        password,
      }, { timeoutMs: 60000 });
      const data = res?.data || {};
      setVerification(data);
      setPassword('');
      setStep('warning');
      showMessage('success', '管理員驗證通過，請閱讀警告並確認。');
    } catch (error) {
      showMessage('error', error?.data?.message || error?.message || '驗證失敗。');
    } finally {
      setVerifying(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!verification?.token) return;
    setBackupStarting(true);
    try {
      const res = await apiClient.post('/platform/system-initialization/backups', {
        token: verification.token,
      });
      const job = res?.data || {};
      setBackupJob(job);
      setStep('backup');
      showMessage('success', '初始化備份已開始，完成後請下載並校驗。');
      if (backupPollRef.current) clearInterval(backupPollRef.current);
      backupPollRef.current = setInterval(async () => {
        try {
          const statusRes = await apiClient.get(`/platform/system-initialization/backups/${job.id}`);
          const status = statusRes?.data || {};
          setBackupJob(status);
          if (status.status !== 'running') {
            clearInterval(backupPollRef.current);
            backupPollRef.current = null;
            if (status.status === 'failed') {
              showMessage('error', status.error || '初始化備份失敗。');
            }
          }
        } catch (error) {
          clearInterval(backupPollRef.current);
          backupPollRef.current = null;
          showMessage('error', error?.data?.message || error?.message || '讀取備份狀態失敗。');
        }
      }, 2500);
    } catch (error) {
      setBackupStarting(false);
      showMessage('error', error?.data?.message || error?.message || '建立初始化備份失敗。');
    }
  };

  useEffect(() => {
    if (backupJob && backupJob.status !== 'running') setBackupStarting(false);
  }, [backupJob]);

  const waitForBackupDownloaded = async (jobId, { attempts = 20, intervalMs = 1000 } = {}) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const statusRes = await apiClient.get(`/platform/system-initialization/backups/${jobId}`);
      const status = statusRes?.data || {};
      setBackupJob(status);
      if (status.downloaded) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  };

  const handleDownloadBackup = async () => {
    if (!backupJob || backupJob.status !== 'success' || !backupJob.downloadUrl) {
      showMessage('error', '備份下載連結不可用，請重新建立備份。');
      return;
    }

    // 不支援儲存位置對話框的瀏覽器：交給瀏覽器原生下載管理器。
    if (typeof window.showSaveFilePicker !== 'function') {
      setDownloadMode('native');
      setDownloading(true);
      setDownloadProgress({ received: 0, total: Number(backupJob.sizeBytes || 0) });
      try {
        const link = document.createElement('a');
        link.href = backupJob.downloadUrl;
        link.download = backupJob.filename;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        showMessage('success', '已開始下載，完成後請核對 SHA256。');
        const confirmed = await waitForBackupDownloaded(backupJob.id, { attempts: 200, intervalMs: 3000 });
        if (!confirmed) {
          showMessage('error', '尚未確認下載完成，請確認瀏覽器下載完成後再繼續。');
          return;
        }
        setBackupDownloaded(true);
        setStep('execute');
      } catch (error) {
        showMessage('error', error?.message || '下載初始化備份失敗。');
      } finally {
        setDownloading(false);
        setDownloadMode('');
      }
      return;
    }

    let fileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: backupJob.filename,
        types: [{ description: 'ZIP 備份', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      showMessage('error', '無法開啟儲存位置對話框，請重試。');
      return;
    }

    setDownloadMode('picker');
    setDownloading(true);
    const declaredTotal = Number(backupJob.sizeBytes || 0);
    setDownloadProgress({ received: 0, total: declaredTotal });
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    let stallTimer = null;
    let writer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), 60000);
    };

    try {
      resetStallTimer();
      const response = await fetch(backupJob.downloadUrl, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）`);
      const contentLength = Number(response.headers.get('Content-Length') || 0);
      const total = contentLength > 0 ? contentLength : declaredTotal;
      setDownloadProgress({ received: 0, total });

      if (response.body?.getReader) {
        const reader = response.body.getReader();
        writer = await fileHandle.createWritable();
        let received = 0;
        let lastRender = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetStallTimer();
          await writer.write(value);
          received += value.byteLength;
          const now = Date.now();
          if (now - lastRender > 300) {
            lastRender = now;
            setDownloadProgress({ received, total });
          }
        }
        await writer.close();
        writer = null;
        setDownloadProgress({ received, total });
      } else {
        const blob = await response.blob();
        writer = await fileHandle.createWritable();
        await writer.write(blob);
        await writer.close();
        writer = null;
        setDownloadProgress({ received: blob.size, total: blob.size });
      }

      const confirmed = await waitForBackupDownloaded(backupJob.id);
      if (!confirmed) {
        showMessage('error', '下載完成，但伺服器尚未確認，請稍候再試。');
        return;
      }
      setBackupDownloaded(true);
      setStep('execute');
      showMessage('success', '備份已下載，請核對 SHA256 後繼續。');
    } catch (error) {
      if (writer) {
        try { await writer.abort(); } catch {}
      }
      if (error?.name === 'AbortError') {
        showMessage('error', '下載停滯超過 60 秒或已取消，請重試。');
      } else {
        showMessage('error', error?.message || '下載初始化備份失敗。');
      }
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      downloadAbortRef.current = null;
      setDownloading(false);
      setDownloadMode('');
    }
  };

  const cancelDownload = () => {
    if (downloadAbortRef.current) {
      try { downloadAbortRef.current.abort(); } catch {}
    }
  };

  const handleExecute = async () => {
    if (!verification?.token || !backupJob?.id) return;
    if (phrase.trim() !== '初始化') {
      showMessage('error', '請輸入「初始化」以確認執行。');
      return;
    }
    if (!backupChecked || !backupDownloaded) {
      showMessage('error', '請先下載並確認已校驗初始化備份。');
      return;
    }
    setExecuting(true);
    try {
      const res = await apiClient.post('/platform/system-initialization/execute', {
        token: verification.token,
        backupId: backupJob.id,
        confirmationText: phrase.trim(),
        backupConfirmed: true,
      });
      const data = res?.data || {};
      setRun({ runId: data.runId, statusToken: data.statusToken, status: 'running', backup: data.backup });
      setStep('running');
      showMessage('success', '初始化已開始，請勿關閉視窗。');
      if (runPollRef.current) clearInterval(runPollRef.current);
      runPollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(
            `/api/platform/system-initialization/runs/${encodeURIComponent(data.runId)}?token=${encodeURIComponent(data.statusToken)}`
          );
          const payload = await statusRes.json();
          const status = payload?.data;
          if (!status) return;
          setRun((previous) => ({ ...previous, ...status }));
          if (status.status === 'success' || status.status === 'failed') {
            clearInterval(runPollRef.current);
            runPollRef.current = null;
            setExecuting(false);
            if (status.status === 'success') {
              setStep('done');
              showMessage('success', '數據初始化完成，請使用初始化超級管理員重新登入。');
            } else {
              showMessage('error', status.error || '數據初始化失敗。');
              setStep('execute');
            }
          }
        } catch (error) {
          clearInterval(runPollRef.current);
          runPollRef.current = null;
          setExecuting(false);
          showMessage('error', '讀取初始化狀態失敗，請重新登入後檢查。');
        }
      }, 2500);
    } catch (error) {
      setExecuting(false);
      showMessage('error', error?.data?.message || error?.message || '啟動初始化失敗。');
    }
  };

  const handleDeleteBackup = async () => {
    if (!run?.runId || !run?.statusToken) return;
    setDeletingBackup(true);
    try {
      const response = await fetch(
        `/api/platform/system-initialization/runs/${encodeURIComponent(run.runId)}/backup?token=${encodeURIComponent(run.statusToken)}`,
        { method: 'DELETE' }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || '刪除失敗。');
      setBackupDeleted(true);
      showMessage('success', '伺服器上的初始化備份已刪除，本機下載檔即為回滾副本。');
    } catch (error) {
      showMessage('error', error?.message || '刪除初始化備份失敗。');
    } finally {
      setDeletingBackup(false);
    }
  };

  const handleDeletePreparedBackup = async () => {
    if (!backupJob?.id) return;
    if (!window.confirm('確定刪除伺服器上的初始化備份？刪除後需重新建立備份才能執行初始化。')) return;
    try {
      await apiClient.delete(`/platform/system-initialization/backups/${backupJob.id}`);
      setBackupJob(null);
      setBackupDownloaded(false);
      setBackupChecked(false);
      setStep('warning');
      showMessage('success', '伺服器上的初始化備份已刪除。');
    } catch (error) {
      showMessage('error', error?.data?.message || error?.message || '刪除初始化備份失敗。');
    }
  };

  const copyPassword = async () => {
    if (!backupJob?.password) return;
    try {
      await navigator.clipboard.writeText(backupJob.password);
      showMessage('success', '備份密碼已複製。');
    } catch {
      showMessage('error', '複製失敗，請手動選取密碼。');
    }
  };

  const preview = verification?.preview;
  const tableGroups = groupPreviewRows(preview?.tables);
  const previewPartials = (preview?.partials || []).filter((row) => Number(row.count) > 0);
  const canExecute = backupDownloaded && backupChecked && phrase.trim() === '初始化' && !executing;
  const downloadPercent = downloadProgress.total > 0
    ? Math.min(100, Math.round((downloadProgress.received / downloadProgress.total) * 100))
    : 0;
  const downloadLabel = downloading
    ? (downloadProgress.total > 0
      ? `下載中 ${downloadPercent}% (${formatBytes(downloadProgress.received)} / ${formatBytes(downloadProgress.total)})`
      : '下載中…')
    : (backupDownloaded ? '備份已下載' : '下載初始化備份');
  const stepIndex = steps.findIndex((item) => item.key === step);

  return (
    <section className="view active" id="system-initialization">
      <style>{`
        .syi-hero { background: linear-gradient(135deg,#1f2937,#111827 60%); border: 1px solid #334155; border-radius: 16px; padding: 26px; color: #e5e7eb; display: flex; justify-content: space-between; gap: 24px; align-items: center; flex-wrap: wrap; }
        .syi-hero h2 { margin: 0 0 10px; font-size: 20px; color: #f8fafc; display: flex; align-items: center; gap: 10px; }
        .syi-hero p { margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.8; max-width: 760px; }
        .syi-danger-btn { height: 42px; padding: 0 20px; border: 0; border-radius: 10px; background: linear-gradient(90deg,#dc2626,#b91c1c); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
        .syi-danger-btn:hover { filter: brightness(1.08); }
        .syi-scope { margin-top: 18px; display: grid; grid-template-columns: repeat(auto-fit,minmax(240px,1fr)); gap: 12px; }
        .syi-scope-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; }
        .syi-scope-card h3 { margin: 0 0 8px; font-size: 13px; color: #e2e8f0; display: flex; align-items: center; gap: 8px; }
        .syi-scope-card p { margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.7; }
        .syi-message { padding: 9px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .syi-message.error { background: #7f1d1d; color: #fecaca; }
        .syi-message.success { background: #065f46; color: #a7f3d0; }
        .syi-overlay { position: fixed; inset: 0; background: rgba(2,6,23,0.78); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .syi-modal { width: min(920px,100%); max-height: 92vh; background: #0f172a; border: 1px solid #334155; border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); display: flex; flex-direction: column; overflow: hidden; }
        .syi-modal-head { padding: 18px 22px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .syi-modal-head h3 { margin: 0; font-size: 17px; color: #f8fafc; display: flex; align-items: center; gap: 9px; }
        .syi-close { border: 0; background: transparent; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 8px; }
        .syi-close:hover { background: #1e293b; color: #f8fafc; }
        .syi-steps { display: flex; gap: 8px; padding: 14px 22px; border-bottom: 1px solid #1e293b; flex-wrap: wrap; }
        .syi-step { font-size: 12px; color: #64748b; padding: 5px 12px; border-radius: 20px; background: #111827; border: 1px solid #1e293b; }
        .syi-step.active { color: #bfdbfe; border-color: #2563eb; background: #172554; }
        .syi-step.done { color: #a7f3d0; border-color: #065f46; background: #052e2b; }
        .syi-modal-body { padding: 20px 22px; overflow: auto; flex: 1; min-height: 0; }
        .syi-modal-body-fixed { overflow: hidden; display: flex; flex-direction: column; }
        .syi-warning-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
        .syi-modal, .syi-modal * { scrollbar-width: thin; scrollbar-color: #4b5563 #0b1220; }
        .syi-modal *::-webkit-scrollbar { width: 8px; height: 8px; }
        .syi-modal *::-webkit-scrollbar-track { background: #0b1220; }
        .syi-modal *::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; border: 2px solid #0b1220; }
        .syi-modal *::-webkit-scrollbar-thumb:hover { background: #4b5563; }
        .syi-label { display: block; color: #cbd5e1; font-size: 12px; margin-bottom: 6px; }
        .syi-input { width: 100%; height: 42px; border-radius: 9px; border: 1px solid #334155; background: #0b1220; color: #f8fafc; padding: 0 12px; font-size: 13px; box-sizing: border-box; outline: none; }
        .syi-input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.18); }
        .syi-input:-webkit-autofill, .syi-input:-webkit-autofill:hover, .syi-input:-webkit-autofill:focus { -webkit-text-fill-color: #f8fafc; -webkit-box-shadow: 0 0 0 1000px #0b1220 inset; transition: background-color 9999s ease-in-out 0s; }
        .syi-field { margin-bottom: 15px; }
        .syi-warning { border: 1px solid #7f1d1d; background: #2a1115; border-radius: 12px; padding: 15px 16px; color: #fecaca; font-size: 13px; line-height: 1.8; margin-bottom: 16px; }
        .syi-warning h4 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        .syi-warning ul { margin: 0; padding-left: 20px; }
        .syi-check { display: flex; gap: 9px; align-items: center; color: #cbd5e1; font-size: 13px; line-height: 1.6; margin: 12px 0 0; cursor: pointer; flex: 0 0 auto; }
        .syi-check input { width: 16px; height: 16px; flex: 0 0 16px; margin: 0; accent-color: #dc2626; }
        .syi-check span { flex: 1; min-width: 0; }
        .syi-preview { border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; margin-top: 0; flex: 1; min-height: 120px; display: flex; flex-direction: column; }
        .syi-preview-head { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; background: #111827; color: #e2e8f0; font-size: 13px; flex-wrap: wrap; flex: 0 0 auto; }
        .syi-preview-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; background: #0b1220; }
        .syi-group { margin-bottom: 12px; }
        .syi-group h5 { margin: 0 0 7px; font-size: 12px; color: #93c5fd; }
        .syi-row { display: flex; justify-content: space-between; gap: 14px; font-size: 12px; color: #cbd5e1; padding: 4px 0; border-bottom: 1px dashed #1e293b; }
        .syi-row:last-child { border-bottom: 0; }
        .syi-row span:last-child { color: #fca5a5; font-family: monospace; }
        .syi-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
        .syi-warning-pane .syi-warning { flex: 0 0 auto; margin-bottom: 12px; }
        .syi-warning-pane .syi-actions { flex: 0 0 auto; margin-top: 10px; padding-top: 12px; border-top: 1px solid #1e293b; }
        .syi-primary { height: 40px; padding: 0 18px; border: 0; border-radius: 9px; background: linear-gradient(90deg,#2563eb,#4f46e5); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .syi-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .syi-secondary { height: 40px; padding: 0 15px; border: 1px solid #334155; border-radius: 9px; background: #1f2937; color: #bfdbfe; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .syi-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
        .syi-danger { height: 40px; padding: 0 16px; border: 1px solid #7f1d1d; border-radius: 9px; background: #3b1111; color: #fca5a5; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .syi-backup-card { border: 1px solid #1e293b; border-radius: 12px; background: #0b1220; padding: 15px; margin-top: 14px; }
        .syi-backup-card .syi-row { border-bottom: 1px solid #1e293b; padding: 7px 0; }
        .syi-mono { font-family: monospace; font-size: 11px; word-break: break-all; color: #e2e8f0; }
        .syi-hint { font-size: 12px; color: #94a3b8; line-height: 1.7; margin-top: 10px; }
        .syi-progress { display: flex; align-items: center; gap: 10px; color: #bfdbfe; font-size: 14px; padding: 18px 0; }
        .syi-spin { animation: syi-spin 1s linear infinite; }
        @keyframes syi-spin { to { transform: rotate(360deg); } }
        .syi-result { text-align: center; padding: 24px 10px; }
        .syi-result h4 { margin: 12px 0 8px; font-size: 18px; color: #f8fafc; }
        .syi-result p { margin: 0 0 8px; color: #94a3b8; font-size: 13px; line-height: 1.8; }
      `}</style>

      {message.text && <div className={`syi-message ${message.type}`}>{message.text}</div>}

      <div className="syi-hero">
        <div>
          <h2><ShieldAlert size={22} /> 數據初始化</h2>
          <p>
            僅清理 SaaS 資料（資料庫與上傳檔案）。
            執行前必須驗證初始化超級管理員、閱讀警告、建立並下載完整備份。
          </p>
        </div>
        <button type="button" className="syi-danger-btn" onClick={openDialog}>
          <ShieldAlert size={17} /> 開始數據初始化
        </button>
      </div>

      <div className="syi-scope">
        <div className="syi-scope-card">
          <h3><Database size={15} /> 清理範圍</h3>
          <p>租戶、帳號、訂單、客服、AI、門禁、通話記錄、在線狀態、上傳圖片與附件。</p>
        </div>
        <div className="syi-scope-card">
          <h3><CheckCircle2 size={15} /> 保留範圍</h3>
          <p>初始化超級管理員、系統試用租戶、平台計費目錄、電子名片預設模板、呼叫中心預設圖、目前 App 版本、首頁品牌與 iOS 連結。</p>
        </div>
        <div className="syi-scope-card">
          <h3><LockKeyhole size={15} /> 安全機制</h3>
          <p>超級管理員密碼複驗、二次警告確認、強制初始化備份、維護模式、事務回滾與檔案隔離。</p>
        </div>
      </div>

      {open && (
        <div className="syi-overlay">
          <div className="syi-modal">
            <div className="syi-modal-head">
              <h3><ShieldAlert size={18} /> 數據初始化</h3>
              <button type="button" className="syi-close" onClick={closeDialog} disabled={executing} aria-label="關閉">
                <X size={18} />
              </button>
            </div>
            <div className="syi-steps">
              {steps.map((item, index) => (
                <span
                  key={item.key}
                  className={`syi-step ${step === item.key ? 'active' : ''} ${stepIndex > index || step === 'done' ? 'done' : ''}`}
                >
                  {index + 1}. {item.label}
                </span>
              ))}
            </div>
            <div className={`syi-modal-body ${step === 'warning' ? 'syi-modal-body-fixed' : ''}`}>
              {step === 'verify' && (
                <form onSubmit={handleVerify}>
                  <div className="syi-warning">
                    <h4><AlertTriangle size={16} /> 請先驗證初始化超級管理員</h4>
                    只有指定的超級管理員可以執行數據初始化。驗證通過後會顯示完整清理範圍與警告。
                  </div>
                  <div className="syi-field">
                    <label className="syi-label">超級管理員帳號</label>
                    <input
                      className="syi-input"
                      type="email"
                      autoComplete="off"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="初始化超級管理員 Email"
                    />
                  </div>
                  <div className="syi-field">
                    <label className="syi-label">超級管理員密碼</label>
                    <input
                      className="syi-input"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="目前登入密碼"
                    />
                  </div>
                  <div className="syi-actions">
                    <button type="button" className="syi-secondary" onClick={closeDialog}>取消</button>
                    <button type="submit" className="syi-primary" disabled={verifying}>
                      {verifying ? <RefreshCw size={15} className="syi-spin" /> : <LockKeyhole size={15} />}
                      {verifying ? '驗證中…' : '驗證並查看警告'}
                    </button>
                  </div>
                </form>
              )}

              {step === 'warning' && (
                <div className="syi-warning-pane">
                  <div className="syi-warning">
                    <h4><AlertTriangle size={16} /> 高風險操作警告</h4>
                    <ul>
                      {(verification?.warning || []).map((text) => <li key={text}>{text}</li>)}
                    </ul>
                  </div>
                  <div className="syi-preview">
                    <div className="syi-preview-head">
                      <span>清理範圍預覽</span>
                      <span>
                        資料列 {Number(preview?.totals?.rows || 0).toLocaleString()} · 檔案 {Number(preview?.totals?.files || 0).toLocaleString()} · {formatBytes(preview?.totals?.bytes)}
                      </span>
                    </div>
                    <div className="syi-preview-body">
                      {tableGroups.map((group) => (
                        <div key={group.key} className="syi-group">
                          <h5>{group.label}</h5>
                          {group.items.map((row) => (
                            <div key={row.table} className="syi-row">
                              <span>{row.table}</span>
                              <span>{Number(row.count).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {previewPartials.length > 0 && (
                        <div className="syi-group">
                          <h5>部分清理 / 重置</h5>
                          {previewPartials.map((row) => (
                            <div key={row.key} className="syi-row">
                              <span>{row.label}</span>
                              <span>{Number(row.count).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(preview?.files || []).length > 0 && (
                        <div className="syi-group">
                          <h5>檔案清理</h5>
                          {preview.files.map((row) => (
                            <div key={row.key} className="syi-row">
                              <span>{row.label}</span>
                              <span>{Number(row.count).toLocaleString()} / {formatBytes(row.bytes)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {(preview?.kept || []).length > 0 && (
                        <div className="syi-group">
                          <h5>保留</h5>
                          {preview.kept.map((text) => (
                            <div key={text} className="syi-row"><span>{text}</span><span>保留</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <label className="syi-check">
                    <input
                      type="checkbox"
                      checked={warningAccepted}
                      onChange={(event) => setWarningAccepted(event.target.checked)}
                    />
                    <span>我已閱讀並理解上述警告，確認清理範圍正確。</span>
                  </label>
                  <div className="syi-actions">
                    <button type="button" className="syi-secondary" onClick={closeDialog}>取消</button>
                    <button type="button" className="syi-primary" disabled={!warningAccepted || backupStarting} onClick={handleCreateBackup}>
                      {backupStarting ? <RefreshCw size={15} className="syi-spin" /> : <Database size={15} />}
                      {backupStarting ? '建立備份中…' : '建立初始化備份'}
                    </button>
                  </div>
                </div>
              )}

              {step === 'backup' && (
                <>
                  <div className="syi-warning">
                    <h4><AlertTriangle size={16} /> 初始化前必須先備份並下載</h4>
                    備份包含全部資料庫、系統設定、assets 與 uploads，可用於回滾到初始化前狀態。
                    未下載並校驗備份前，無法執行初始化。
                  </div>
                  <div className="syi-backup-card">
                    <div className="syi-row"><span>狀態</span><span>{backupJob?.status === 'success' ? '完成' : backupJob?.status === 'failed' ? '失敗' : '建立中'}</span></div>
                    <div className="syi-row"><span>檔名</span><span className="syi-mono">{backupJob?.filename || '-'}</span></div>
                    <div className="syi-row"><span>大小</span><span>{formatBytes(backupJob?.sizeBytes)}</span></div>
                    <div className="syi-row"><span>SHA256</span><span className="syi-mono">{backupJob?.sha256 || '-'}</span></div>
                    {backupJob?.password && (
                      <div className="syi-row">
                        <span>解壓密碼</span>
                        <span className="syi-mono">{backupJob.password}</span>
                      </div>
                    )}
                    {backupJob?.error && <div className="syi-row"><span>錯誤</span><span>{backupJob.error}</span></div>}
                  </div>
                  <div className="syi-actions">
                    {backupJob?.status === 'failed' && (
                      <button type="button" className="syi-secondary" onClick={handleCreateBackup} disabled={backupStarting}>
                        {backupStarting ? <RefreshCw size={15} className="syi-spin" /> : <RefreshCw size={15} />}
                        {backupStarting ? '重新建立中…' : '重新建立備份'}
                      </button>
                    )}
                    {backupJob?.password && (
                      <button type="button" className="syi-secondary" onClick={copyPassword}>
                        <Copy size={15} /> 複製密碼
                      </button>
                    )}
                    <button
                      type="button"
                      className="syi-primary"
                      disabled={backupJob?.status !== 'success' || downloading || backupDownloaded}
                      onClick={handleDownloadBackup}
                    >
                      {downloading ? <RefreshCw size={15} className="syi-spin" /> : backupDownloaded ? <CheckCircle2 size={15} /> : <Download size={15} />}
                      {downloadLabel}
                    </button>
                    {downloading && downloadMode === 'picker' && (
                      <button type="button" className="syi-secondary" onClick={cancelDownload}>
                        取消下載
                      </button>
                    )}
                    {(backupJob?.status === 'success' || backupJob?.status === 'failed') && (
                      <button type="button" className="syi-secondary" onClick={handleDeletePreparedBackup}>
                        <Trash2 size={15} /> 刪除伺服器備份
                      </button>
                    )}
                    {backupDownloaded && (
                      <button type="button" className="syi-primary" onClick={() => setStep('execute')}>
                        繼續確認
                      </button>
                    )}
                  </div>
                  <div className="syi-hint">
                    點擊下載會先詢問儲存位置；下載完成後請用 `certutil -hashfile 檔名 SHA256` 核對。備份檔只保存在本機；伺服器上的副本可在初始化成功後刪除。
                  </div>
                </>
              )}

              {step === 'execute' && (
                <>
                  <div className="syi-warning">
                    <h4><AlertTriangle size={16} /> 最後確認</h4>
                    執行後將刪除上述全部資料，並使所有管理員會話失效。此操作不可從系統內撤銷，只能使用已下載的初始化備份回滾。
                    初始化成功後，伺服器上的備份會自動刪除，下載檔是唯一回滾副本，請務必妥善保存。
                  </div>
                  <label className="syi-check">
                    <input type="checkbox" checked={backupChecked} onChange={(event) => setBackupChecked(event.target.checked)} />
                    <span>我已下載初始化備份，並核對 SHA256 與檔案大小一致。</span>
                  </label>
                  <div className="syi-field" style={{ marginTop: 14 }}>
                    <label className="syi-label">請輸入「初始化」以確認執行</label>
                    <input
                      className="syi-input"
                      type="text"
                      autoComplete="off"
                      value={phrase}
                      onChange={(event) => setPhrase(event.target.value)}
                      placeholder="初始化"
                    />
                  </div>
                  <div className="syi-actions">
                    <button type="button" className="syi-secondary" onClick={() => setStep('backup')} disabled={executing}>上一步</button>
                    <button type="button" className="syi-secondary" onClick={closeDialog} disabled={executing}>取消</button>
                    <button type="button" className="syi-danger" disabled={!canExecute} onClick={handleExecute}>
                      {executing ? <RefreshCw size={15} className="syi-spin" /> : <Play size={15} />}
                      {executing ? '執行中…' : '確認執行初始化'}
                    </button>
                  </div>
                </>
              )}

              {step === 'done' && (
                <div className="syi-result">
                  <CheckCircle2 size={44} color="#34d399" />
                  <h4>數據初始化完成</h4>
                  <p>業務資料已清理，所有管理員會話已失效。</p>
                  <p>請使用初始化超級管理員重新登入。</p>
                  {run?.summary && (
                    <div className="syi-backup-card" style={{ textAlign: 'left' }}>
                      <div className="syi-row"><span>資料表清理</span><span>{Object.keys(run.summary.tables || {}).length} 張 / {Object.values(run.summary.tables || {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()} 列</span></div>
                      <div className="syi-row"><span>檔案清理</span><span>{Number(run.summary.fileCount || 0).toLocaleString()} 個</span></div>
                      <div className="syi-row"><span>移除管理員</span><span>{Number(run.summary.partials?.adminUsersDeleted || 0)} 個</span></div>
                      <div className="syi-row"><span>移除租戶</span><span>{Number(run.summary.partials?.tenantsDeleted || 0)} 個</span></div>
                      <div className="syi-row"><span>移除舊 App 記錄</span><span>{Number(run.summary.partials?.appReleasesDeleted || 0)} 條</span></div>
                      <div className="syi-row"><span>伺服器初始化備份</span><span>{run.backupDeleted ? '已自動刪除' : '仍保留，請手動刪除'}</span></div>
                    </div>
                  )}
                  {run?.purgeWarning && <p style={{ color: '#fca5a5' }}>{run.purgeWarning}</p>}
                  <div className="syi-actions" style={{ justifyContent: 'center' }}>
                    {!run?.backupDeleted && !backupDeleted && (
                      <button type="button" className="syi-secondary" onClick={handleDeleteBackup} disabled={deletingBackup}>
                        {deletingBackup ? <RefreshCw size={15} className="syi-spin" /> : <Trash2 size={15} />}
                        {deletingBackup ? '刪除中…' : '刪除伺服器上的初始化備份'}
                      </button>
                    )}
                    <button type="button" className="syi-primary" onClick={onLogout}>返回登入</button>
                  </div>
                  <div className="syi-hint">
                    本機下載的初始化備份是唯一回滾副本，請妥善保存；伺服器副本在初始化成功後已自動刪除。
                  </div>
                </div>
              )}

              {step === 'running' && (
                <div className="syi-progress">
                  <RefreshCw size={18} className="syi-spin" /> 數據初始化執行中，請勿關閉視窗…
                </div>
              )}

              {executing && step !== 'done' && (
                <div className="syi-hint">初始化已開始，系統已進入維護模式；完成後會自動顯示結果。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
