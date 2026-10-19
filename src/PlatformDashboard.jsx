import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

const EMPTY_HEALTH = {
  cpu: { usage: null, cores: null, loadAvg: null },
  memory: null,
  disk: null,
  uptime: null,
  load: { load1: 0, load5: 0, load15: 0 },
  os: null,
  ntpSynchronized: null,
  asteriskCerts: { sipTls: null, wss: null },
  pushGateway: {
    enabled: false,
    status: 'unknown',
    warnings: [],
    jpush: { enabled: false, configured: false },
    apns: { enabled: false, configured: false, voipConfigured: false, authMode: '', environment: '' },
    fcm: { enabled: false, configured: false },
    devices: { total: 0, enabled: 0, android: 0, ios: 0, jpush: 0, fcm: 0, apns: 0, lastSeenAt: null },
    last24h: { total: 0, success: 0, processed: 0, received: 0, failed: 0 },
    lastEventAt: null,
    lastFailureAt: null,
    lastFailureProvider: '',
    lastFailureCode: '',
  },
  mariadb: 'unknown',
  mongodb: 'unknown',
  asterisk: 'unknown',
  flexisip: 'unknown',
  redis: 'unknown',
  apache: 'unknown',
  coturn: 'unknown',
  mqtt: 'unknown',
  aiservice: 'unknown',
  lime: 'unknown',
  fts: 'unknown',
  accountManager: 'unknown',
  ssl: null,
  checkedAt: null,
};

const EMPTY_STATS = {
  sipTotal: 0, sipAssigned: 0, sipTrialActive: 0, sipAvailable: 0, sipRecycled: 0,
  webTotal: 0, webAssigned: 0, webActive: 0,
  tenantCount: 0, tenantTotal: 0,
  orderCount: 0, orderNewCount: 0, orderRenewalCount: 0, trialOrderCount: 0,
  pendingReviewCount: 0, pendingPaymentCount: 0,
  paidTotal: 0, paidThisMonth: 0,
  ecardCount: 0, ecardTotal: 0, ecardExpiring: 0,
  deviceCount: 0, deviceTotal: 0, deviceOnline: 0, deviceOffline: 0, deviceUnknown: 0, deviceAssignmentExpired: 0,
  communityCount: 0, communityTotal: 0, roomCount: 0,
  topPlan: '-', topPlanCount: 0, bottomPlan: '-', bottomPlanCount: 0,
  syncAnomaly: 0, accountsExpired: 0, accountsExpiring: 0, plansExpiring: 0,
  trial: { total: 0, active: 0, expiring: 0, grace: 0, paused: 0, converted: 0, reclaimed: 0 },
  tenantTrend: [], paymentTrend: [],
  recentTenants: [], recentOrders: [], recentPayments: [], alerts: [],
};

function normalizeHealth(res) {
  if (!res || typeof res !== 'object') return EMPTY_HEALTH;
  const pg = res.pushGateway || {};
  return {
    ...EMPTY_HEALTH,
    ...res,
    cpu: { ...EMPTY_HEALTH.cpu, ...(res.cpu || {}) },
    load: { ...EMPTY_HEALTH.load, ...(res.load || {}) },
    asteriskCerts: { ...EMPTY_HEALTH.asteriskCerts, ...(res.asteriskCerts || {}) },
    pushGateway: {
      ...EMPTY_HEALTH.pushGateway,
      ...pg,
      jpush: { ...EMPTY_HEALTH.pushGateway.jpush, ...(pg.jpush || {}) },
      apns: { ...EMPTY_HEALTH.pushGateway.apns, ...(pg.apns || {}) },
      fcm: { ...EMPTY_HEALTH.pushGateway.fcm, ...(pg.fcm || {}) },
      devices: { ...EMPTY_HEALTH.pushGateway.devices, ...(pg.devices || {}) },
      last24h: { ...EMPTY_HEALTH.pushGateway.last24h, ...(pg.last24h || {}) },
    },
  };
}

function normalizeStats(res) {
  if (!res || typeof res !== 'object') return EMPTY_STATS;
  return {
    ...EMPTY_STATS,
    ...res,
    trial: { ...EMPTY_STATS.trial, ...(res.trial || {}) },
    tenantTrend: Array.isArray(res.tenantTrend) ? res.tenantTrend : [],
    paymentTrend: Array.isArray(res.paymentTrend) ? res.paymentTrend : [],
    recentTenants: Array.isArray(res.recentTenants) ? res.recentTenants : [],
    recentOrders: Array.isArray(res.recentOrders) ? res.recentOrders : [],
    recentPayments: Array.isArray(res.recentPayments) ? res.recentPayments : [],
    alerts: Array.isArray(res.alerts) ? res.alerts : [],
  };
}

function formatTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimeShort(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(5, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const gb = n / 1024 / 1024 / 1024;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)}TB`;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)}GB`;
}

function serviceTone(status) {
  if (status === 'running') return 'green';
  if (status === 'partial') return 'warn';
  if (status === 'stopped' || status === 'error') return 'red';
  return 'gray';
}

function serviceText(status, runningText = '執行正常') {
  if (status === 'running') return runningText;
  if (status === 'partial') return '部分執行';
  if (status === 'stopped') return '已停止';
  if (status === 'error') return '異常';
  if (status === 'not_installed') return '未安裝';
  return '未知';
}

function pushStatusTone(status) {
  if (status === 'running') return 'green';
  if (status === 'warning') return 'warn';
  if (status === 'misconfigured') return 'red';
  if (status === 'disabled') return 'gray';
  return 'gray';
}

function pushStatusText(status) {
  if (status === 'running') return '運行中';
  if (status === 'warning') return '有失敗記錄';
  if (status === 'misconfigured') return '配置不完整';
  if (status === 'disabled') return '已停用';
  return '未知';
}

function certDaysText(cert) {
  if (!cert || cert.daysLeft == null) return '未取得';
  const days = Number(cert.daysLeft);
  return days < 0 ? `已過期 ${Math.abs(days)} 天` : `${days} 天`;
}

function certTone(cert) {
  if (!cert || cert.daysLeft == null) return 'gray';
  const days = Number(cert.daysLeft);
  if (days <= 7) return 'red';
  if (days <= 30) return 'warn';
  return 'green';
}

function buildChartBars(trend, valueKey) {
  if (!trend || trend.length === 0) return { bars: [], labels: [], max: 1 };
  const max = Math.max(1, ...trend.map(d => d[valueKey]));
  const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const bars = trend.map(d => ({ label: dayNames[new Date(d.date + 'T00:00:00').getDay()] || d.date.slice(5), pct: Math.round((d[valueKey] / max) * 100) }));
  return { bars, labels: bars.map(b => b.label), max };
}

const PlatformDashboard = forwardRef((props, ref) => {
  const [health, setHealth] = useState(EMPTY_HEALTH);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadAll = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    const results = await Promise.allSettled([
      apiClient.get('/platform/health'),
      apiClient.get('/platform/stats'),
    ]);
    const failures = [];
    if (results[0].status === 'fulfilled') setHealth(normalizeHealth(results[0].value));
    else failures.push('健康狀態');
    if (results[1].status === 'fulfilled') setStats(normalizeStats(results[1].value));
    else failures.push('平台統計');
    setError(failures.length > 0 ? `無法讀取${failures.join('、')}，請稍後重試。` : '');
    if (results.some(r => r.status === 'fulfilled')) setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadAll(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => loadAll({ silent: true });
  useImperativeHandle(ref, () => ({ refresh }));

  const handleRestartAi = async () => {
    if (!window.confirm('確定要重啟 Web AI 服務嗎？')) return;
    try {
      await apiClient.post('/platform/health/restart-ai');
      alert('Web AI 服務已重啟');
      loadAll({ silent: true });
    } catch (e) {
      alert('重啟失敗：' + (e.message || '未知錯誤'));
    }
  };

  const handleCleanLogs = async () => {
    if (!window.confirm('確定要清理伺服器日誌嗎？\n\n清理策略：\n- 當前日誌檔案：truncate 清空（不中斷服務）\n- 輪轉／歸檔檔案（.gz、.log.1 等）：直接刪除\n- Flexisip 明細目錄（errors/、users/）：僅保留最近 7 天\n- GCP 日誌代理緩衝：清空（代理自動重建）')) return;
    try {
      const res = await apiClient.post('/platform/health/clean-logs');
      alert(res.message || '日誌清理完成');
      loadAll({ silent: true });
    } catch (e) {
      alert('清理失敗：' + (e.message || '未知錯誤'));
    }
  };

  const memoryText = health.memory
    ? `${formatBytes(health.memory.usedBytes)} / ${formatBytes(health.memory.totalBytes)}`
    : '-';
  const diskText = health.disk
    ? `已用 ${formatBytes(health.disk.usedBytes)} / ${formatBytes(health.disk.totalBytes)}`
    : '-';

  const serviceAlerts = [];
  const certEntries = [
    ['Web SIP TLS', health.asteriskCerts?.sipTls],
    ['WebRTC WSS', health.asteriskCerts?.wss],
  ];
  certEntries.forEach(([label, cert]) => {
    if (!cert || cert.daysLeft == null) return;
    const days = Number(cert.daysLeft);
    if (days <= 30) {
      serviceAlerts.push({
        severity: days <= 7 ? 'error' : 'warning',
        text: `${label} 證書${days < 0 ? `已過期 ${Math.abs(days)} 天` : `剩餘 ${days} 天`}（${cert.date}）`,
      });
    }
  });
  const serviceDefs = [
    ['flexisip', 'SIP 呼叫服務'], ['asterisk', 'Web 呼叫服務'], ['mariadb', 'MariaDB'],
    ['mongodb', 'MongoDB'], ['redis', 'Redis'], ['apache', 'Apache'],
    ['coturn', 'Coturn'], ['mqtt', 'MQTT'], ['aiservice', 'Web AI 服務'],
    ['lime', '加密服務'], ['fts', '檔案傳輸服務'], ['accountManager', '帳號管理 API'],
  ];
  serviceDefs.forEach(([key, label]) => {
    if (health[key] && health[key] !== 'running' && health[key] !== 'unknown') {
      serviceAlerts.push({
        severity: health[key] === 'stopped' || health[key] === 'error' ? 'error' : 'warning',
        text: `${label}：${serviceText(health[key], '')}`,
      });
    }
  });
  const pg = health.pushGateway;
  if (pg) {
    if (pg.status === 'disabled') {
      serviceAlerts.push({ severity: 'warning', text: 'Push Gateway 已停用' });
    } else if (pg.status === 'misconfigured') {
      serviceAlerts.push({ severity: 'error', text: 'Push Gateway 配置不完整' });
    } else if (Number(pg.last24h?.failed || 0) > 0) {
      serviceAlerts.push({ severity: 'warning', text: `Push Gateway 近 24 小時有 ${Number(pg.last24h.failed)} 次推送失敗` });
    }
    if (pg.enabled && Number(pg.devices?.enabled || 0) === 0) {
      serviceAlerts.push({ severity: 'warning', text: 'Push Gateway 目前沒有已啟用的推播裝置' });
    }
  }
  if (health.disk && Number(health.disk.usage) >= 80) {
    serviceAlerts.push({ severity: Number(health.disk.usage) >= 90 ? 'error' : 'warning', text: `磁盤使用率 ${health.disk.usage}%` });
  }
  if (health.memory && Number(health.memory.usage) >= 85) {
    serviceAlerts.push({ severity: 'warning', text: `內存使用率 ${health.memory.usage}%` });
  }
  const allAlerts = [...serviceAlerts, ...stats.alerts];

  return (
    <section className="view active" id="platform-dashboard" style={{ overflow: 'auto', height: '100%', scrollbarWidth: 'none' }}>
      <style>{`
        .pdb-page { max-width: 1280px; }
        .pdb-title-row { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
        .pdb-title h1 { margin: 0; font-size: 20px; font-weight: 500; letter-spacing: .2px; color: #f3f4f6; }
        .pdb-title p { margin: 5px 0 0; color: #9ca3af; font-size: 12px; }
        .pdb-time { color: #9ca3af; font-size: 12px; display: flex; align-items: center; gap: 10px; }
        .pdb-section { margin-top: 14px; }
        .pdb-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .pdb-section-title { font-size: 14px; font-weight: 600; color: #f3f4f6; }
        .pdb-section-note { font-size: 11px; color: #9ca3af; }
        .pdb-grid { display: grid; gap: 12px; }
        .pdb-grid-4 { grid-template-columns: repeat(4, 1fr); }
        .pdb-grid-5 { grid-template-columns: repeat(5, 1fr); }
        .pdb-grid-3 { grid-template-columns: repeat(3, 1fr); }
        .pdb-grid-2 { grid-template-columns: 1.05fr .95fr; }
        .pdb-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 6px 18px rgba(0,0,0,.2); padding: 14px; }
        .pdb-metric { min-height: 76px; }
        .pdb-metric-label { color: #9ca3af; font-size: 12px; margin-bottom: 6px; }
        .pdb-metric-value { font-size: 18px; font-weight: 400; line-height: 1.1; color: #f3f4f6; }
        .pdb-metric-sub { margin-top: 6px; font-size: 11px; color: #9ca3af; }
        .pdb-progress { height: 5px; background: #374151; border-radius: 99px; overflow: hidden; margin-top: 10px; }
        .pdb-bar { height: 100%; border-radius: 99px; }
        .pdb-bar.green { background: #5fc89f; }
        .pdb-bar.orange { background: #f6b25d; }
        .pdb-bar.red { background: #ee7070; }
        .pdb-service-card { display: flex; align-items: center; gap: 12px; min-height: 74px; }
        .pdb-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
        .pdb-dot.green { background: #59c98d; box-shadow: 0 0 0 4px rgba(89,201,141,.12); }
        .pdb-dot.warn { background: #f6b25d; box-shadow: 0 0 0 4px rgba(246,178,93,.15); }
        .pdb-dot.red { background: #ee7070; box-shadow: 0 0 0 4px rgba(238,112,112,.15); }
        .pdb-dot.gray { background: #6b7280; box-shadow: 0 0 0 4px rgba(107,114,128,.15); }
        .pdb-service-name { font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #f3f4f6; }
        .pdb-service-status { font-size: 12px; color: #9ca3af; }
        .pdb-biz-value { font-size: 18px; font-weight: 400; margin-top: 6px; color: #f3f4f6; }
        .pdb-biz-label { font-size: 12px; color: #9ca3af; }
        .pdb-alert-list { padding: 4px 0; max-height: 220px; overflow: auto; scrollbar-width: thin; scrollbar-color: #4b5563 #111827; }
        .pdb-alert-item { display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: center; padding: 9px 4px; border-bottom: 1px solid #1f2937; }
        .pdb-alert-item:last-child { border-bottom: none; }
        .pdb-alert-text { font-size: 12px; color: #e5e7eb; }
        .pdb-chart { height: 160px; position: relative; padding: 12px 10px 0; }
        .pdb-chart-bars { height: 105px; display: flex; align-items: end; gap: 12px; border-left: 1px solid #374151; border-bottom: 1px solid #374151; padding-left: 10px; }
        .pdb-chart-bars span { width: 100%; max-width: 34px; background: linear-gradient(180deg, #8bbcff, #dbeaff); border-radius: 8px 8px 0 0; }
        .pdb-chart-labels { display: flex; gap: 12px; padding-left: 11px; margin-top: 8px; color: #9ca3af; font-size: 10px; }
        .pdb-chart-labels span { width: 34px; text-align: center; }
        .pdb-mini-list { margin: 0; padding: 0; list-style: none; }
        .pdb-mini-list li { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid #1f2937; font-size: 12px; color: #d1d5db; }
        .pdb-mini-list li:last-child { border-bottom: 0; }
        .pdb-mini-sub { color: #9ca3af; font-size: 11px; }
        @media (max-width: 1100px) {
          .pdb-grid-5, .pdb-grid-4 { grid-template-columns: repeat(3, 1fr); }
          .pdb-grid-3, .pdb-grid-2 { grid-template-columns: 1fr; }
        }
        #platform-dashboard::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="pdb-page">
        <div className="pdb-title-row">
          <div className="pdb-title">
            <h1>平台概覽</h1>
            <p>Ubuntu / 核心服務 / 通訊業務</p>
          </div>
          <div className="pdb-time">
            {updatedAt && <span>更新於 {formatTime(updatedAt)}</span>}
            <button onClick={refresh} disabled={loading || refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #374151', background: '#1f2937', color: '#93c5fd', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: refreshing ? 'wait' : 'pointer' }}>
              <RefreshCw size={13} />{refreshing ? '更新中...' : '刷新'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #b91c1c', borderRadius: '8px', padding: '8px 14px', marginBottom: '14px', fontSize: '13px', color: '#fecaca' }}>
            {error}
          </div>
        )}

        {/* 平台健康狀態 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title">平台健康狀態</div>
            <div className="pdb-section-note">Ubuntu / 核心服務 / 通訊業務</div>
          </div>
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">CPU 使用率</div>
              <div className="pdb-metric-value">{health.cpu?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className="pdb-bar green" style={{ width: `${health.cpu?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">{health.cpu?.cores || '-'} 核 · 5 分鐘負載 {health.load?.load5 ?? '-'}</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">內存使用率</div>
              <div className="pdb-metric-value">{health.memory?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className="pdb-bar green" style={{ width: `${health.memory?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">{memoryText}</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="pdb-metric-label">磁盤使用率</div>
                <span onClick={handleCleanLogs} style={{ fontSize: '11px', color: '#2563eb', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff' }}>清理</span>
              </div>
              <div className="pdb-metric-value">{health.disk?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className={`pdb-bar ${(health.disk?.usage || 0) > 80 ? 'red' : (health.disk?.usage || 0) > 60 ? 'orange' : 'green'}`} style={{ width: `${health.disk?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">{diskText}{health.disk?.freeBytes ? ` · 剩餘 ${formatBytes(health.disk.freeBytes)}` : ''}</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">SSL 證書到期</div>
              <div className="pdb-metric-value" style={{ color: (health.ssl?.daysLeft ?? 90) <= 7 ? '#ef4444' : (health.ssl?.daysLeft ?? 90) <= 30 ? '#fbbf24' : '#f3f4f6' }}>
                {health.ssl ? `${health.ssl.daysLeft} 天` : '-'}
              </div>
              <div className="pdb-progress"><div className={`pdb-bar ${(health.ssl?.daysLeft ?? 90) <= 7 ? 'red' : (health.ssl?.daysLeft ?? 90) <= 30 ? 'orange' : 'green'}`} style={{ width: `${Math.min(100, ((health.ssl?.daysLeft ?? 90) / 90) * 100)}%` }} /></div>
              <div className="pdb-metric-sub">{health.ssl ? `到期日：${health.ssl.date}` : '-'}</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">系統運行時間</div>
              <div className="pdb-metric-value">{health.uptime?.text ?? '-'}</div>
              <div className="pdb-metric-sub">{health.os?.version || '-'} · NTP {health.ntpSynchronized === true ? '正常' : health.ntpSynchronized === false ? '未同步' : '未知'}</div>
            </div>
          </div>
        </div>

        {/* 證書狀態 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title">證書狀態</div>
            <div className="pdb-section-note">Web SIP TLS / WebRTC WSS</div>
          </div>
          <div className="pdb-grid pdb-grid-2">
            {certEntries.map(([label, cert]) => {
              const tone = certTone(cert);
              return (
                <div className="pdb-card pdb-metric" key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="pdb-metric-label">{label}</div>
                    <span className={`pdb-dot ${tone}`} />
                  </div>
                  <div className="pdb-metric-value" style={{ color: tone === 'red' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : '#f3f4f6' }}>
                    {certDaysText(cert)}
                  </div>
                  <div className="pdb-metric-sub">
                    {cert ? `到期 ${cert.date} · ${cert.commonName || '-'}` : '未取得證書資訊'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 核心服務 */}
        <div className="pdb-section">
          <div className="pdb-section-head"><div className="pdb-section-title">核心服務</div></div>
          <div className="pdb-grid pdb-grid-5">
            {[
              ['flexisip', 'SIP 呼叫服務'], ['asterisk', 'Web 呼叫服務'], ['mariadb', 'MariaDB'], ['mongodb', 'MongoDB'], ['redis', 'Redis'],
            ].map(([key, label]) => (
              <div className="pdb-card pdb-service-card" key={key}>
                <span className={`pdb-dot ${serviceTone(health[key])}`} />
                <div><div className="pdb-service-name">{label}</div><div className="pdb-service-status">{serviceText(health[key], key === 'mariadb' ? '連線正常' : '執行正常')}</div></div>
              </div>
            ))}
          </div>
        </div>

        {/* API / 其他服務 */}
        <div className="pdb-section">
          <div className="pdb-section-head"><div className="pdb-section-title">API / 其他服務</div></div>
          <div className="pdb-grid pdb-grid-5">
            {[
              ['accountManager', '帳號管理 API'], ['lime', '加密服務'], ['fts', '檔案傳輸服務'],
              ['aiservice', 'Web AI 服務'], ['apache', 'Apache'], ['coturn', 'Coturn'], ['mqtt', 'MQTT'],
            ].map(([key, label]) => (
              <div className="pdb-card pdb-service-card" key={key}>
                <span className={`pdb-dot ${serviceTone(health[key])}`} />
                <div style={{ flex: 1 }}>
                  <div className="pdb-service-name">{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="pdb-service-status">{serviceText(health[key])}</div>
                    {key === 'aiservice' && health[key] !== 'running' && (
                      <span onClick={handleRestartAi} style={{ fontSize: '10px', color: '#2563eb', cursor: 'pointer', padding: '1px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', whiteSpace: 'nowrap' }}>重啟</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 推送服務 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title">推送服務</div>
            <div className="pdb-section-note">裝置註冊與近 24 小時推送</div>
          </div>
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${pushStatusTone(health.pushGateway.status)}`} />
              <div>
                <div className="pdb-service-name">Push Gateway</div>
                <div className="pdb-service-status">{pushStatusText(health.pushGateway.status)}</div>
                <div className="pdb-metric-sub">裝置 {Number(health.pushGateway.devices.enabled)} / {Number(health.pushGateway.devices.total)}（Android {Number(health.pushGateway.devices.android)} · iOS {Number(health.pushGateway.devices.ios)}）</div>
              </div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${!health.pushGateway.jpush.enabled ? 'gray' : (health.pushGateway.jpush.configured ? 'green' : 'red')}`} />
              <div>
                <div className="pdb-service-name">JPush</div>
                <div className="pdb-service-status">{!health.pushGateway.jpush.enabled ? '已停用' : health.pushGateway.jpush.configured ? '已配置' : '配置不完整'}</div>
                <div className="pdb-metric-sub">JPush 裝置 {Number(health.pushGateway.devices.jpush)}</div>
              </div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${!health.pushGateway.apns.enabled ? 'gray' : (health.pushGateway.apns.configured ? 'green' : 'red')}`} />
              <div>
                <div className="pdb-service-name">APNs</div>
                <div className="pdb-service-status">{!health.pushGateway.apns.enabled ? '已停用' : health.pushGateway.apns.configured ? '已配置' : '配置不完整'}</div>
                <div className="pdb-metric-sub">iOS 裝置 {Number(health.pushGateway.devices.apns)}{health.pushGateway.apns.environment ? ` · ${health.pushGateway.apns.environment === 'sandbox' ? '沙箱' : '生產'}` : ''}</div>
              </div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${!health.pushGateway.fcm.enabled ? 'gray' : (health.pushGateway.fcm.configured ? 'green' : 'red')}`} />
              <div>
                <div className="pdb-service-name">FCM</div>
                <div className="pdb-service-status">{!health.pushGateway.fcm.enabled ? '已停用' : health.pushGateway.fcm.configured ? '已配置' : '配置不完整'}</div>
                <div className="pdb-metric-sub">FCM 裝置 {Number(health.pushGateway.devices.fcm)}</div>
              </div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${Number(health.pushGateway.last24h.failed) > 0 ? 'warn' : 'green'}`} />
              <div>
                <div className="pdb-service-name">近 24 小時推送</div>
                <div className="pdb-service-status">處理 {Number(health.pushGateway.last24h.processed)} · 失敗 {Number(health.pushGateway.last24h.failed)}</div>
                <div className="pdb-metric-sub">
                  最近事件 {formatTimeShort(health.pushGateway.lastEventAt)}
                  {health.pushGateway.lastFailureAt ? ` · 最近失敗 ${health.pushGateway.lastFailureProvider || '-'} ${health.pushGateway.lastFailureCode || ''}` : ''}
                </div>
              </div>
            </div>
          </div>
          {health.pushGateway.warnings.length > 0 && (
            <div className="pdb-metric-sub" style={{ marginTop: 6, color: '#f6b25d' }}>
              配置警告：{health.pushGateway.warnings.join('、')}
            </div>
          )}
        </div>

        {/* 帳號庫存 */}
        <div className="pdb-section">
          <div className="pdb-section-head"><div className="pdb-section-title">帳號庫存</div></div>
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已創建 SIP 帳號</div><div className="pdb-metric-value">{Number(stats.sipTotal).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已分配 SIP 帳號</div><div className="pdb-metric-value">{Number(stats.sipAssigned).toLocaleString()}</div><div className="pdb-metric-sub">訂閱帳號（不含試用）</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">試用中 SIP 帳號</div><div className="pdb-metric-value">{Number(stats.sipTrialActive).toLocaleString()}</div><div className="pdb-metric-sub">7 天內到期 {Number(stats.trial.expiring)} · 寬限 {Number(stats.trial.grace)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">可用 SIP 庫存</div><div className="pdb-metric-value">{Number(stats.sipAvailable).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已回收 SIP 帳號</div><div className="pdb-metric-value">{Number(stats.sipRecycled).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已創建 Web 帳號</div><div className="pdb-metric-value">{Number(stats.webTotal).toLocaleString()}</div><div className="pdb-metric-sub">有效 {Number(stats.webActive)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已分配 Web 帳號</div><div className="pdb-metric-value">{Number(stats.webAssigned).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">同步異常帳號</div><div className="pdb-metric-value">{Number(stats.syncAnomaly).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">試用帳號總數</div><div className="pdb-metric-value">{Number(stats.trial.total).toLocaleString()}</div><div className="pdb-metric-sub">轉正 {Number(stats.trial.converted)} · 回收 {Number(stats.trial.reclaimed)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">到期帳號</div><div className="pdb-metric-value">{Number(stats.accountsExpiring).toLocaleString()}</div><div className="pdb-metric-sub">已過期 {Number(stats.accountsExpired)} · 套餐到期 {Number(stats.plansExpiring)}</div></div>
          </div>
        </div>

        {/* 運營指標 */}
        <div className="pdb-section">
          <div className="pdb-section-head"><div className="pdb-section-title">運營指標</div></div>
          <div className="pdb-grid pdb-grid-4">
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已註冊租戶</div><div className="pdb-metric-value">{Number(stats.tenantCount).toLocaleString()}</div><div className="pdb-metric-sub">全部 {Number(stats.tenantTotal)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已銷售套餐</div><div className="pdb-metric-value">{Number(stats.orderCount).toLocaleString()}</div><div className="pdb-metric-sub">新購 {Number(stats.orderNewCount)} · 續費 {Number(stats.orderRenewalCount)} · 試用批次 {Number(stats.trialOrderCount)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">待稽核訂單</div><div className="pdb-metric-value" style={{ color: stats.pendingReviewCount > 0 ? '#f87171' : '#f3f4f6' }}>{Number(stats.pendingReviewCount).toLocaleString()}</div><div className="pdb-metric-sub">含已提交付款</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">待付款訂單</div><div className="pdb-metric-value" style={{ color: stats.pendingPaymentCount > 0 ? '#fbbf24' : '#f3f4f6' }}>{Number(stats.pendingPaymentCount).toLocaleString()}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">已收款總額</div><div className="pdb-metric-value">${Number(stats.paidTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div className="pdb-metric-sub">本月 ${Number(stats.paidThisMonth).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">電子名片</div><div className="pdb-metric-value">{Number(stats.ecardCount).toLocaleString()} / {Number(stats.ecardTotal).toLocaleString()}</div><div className="pdb-metric-sub">啟用 / 總量 · 7 天內到期 {Number(stats.ecardExpiring)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">門控設備</div><div className="pdb-metric-value">{Number(stats.deviceOnline).toLocaleString()} / {Number(stats.deviceCount).toLocaleString()}</div><div className="pdb-metric-sub">在線 / 已分配 · 離線 {Number(stats.deviceOffline)} · 未知 {Number(stats.deviceUnknown)} · 總庫存 {Number(stats.deviceTotal)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">管控社群 / 房間</div><div className="pdb-metric-value">{Number(stats.communityCount).toLocaleString()} / {Number(stats.roomCount).toLocaleString()}</div><div className="pdb-metric-sub">社群啟用 {Number(stats.communityCount)} · 總量 {Number(stats.communityTotal)}</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">銷量最高套餐</div><div className="pdb-metric-value" style={{ fontSize: 15 }}>{stats.topPlan || '-'}</div><div className="pdb-metric-sub">{Number(stats.topPlanCount).toLocaleString()} 筆</div></div>
            <div className="pdb-card pdb-metric"><div className="pdb-metric-label">銷量最低套餐</div><div className="pdb-metric-value" style={{ fontSize: 15 }}>{stats.bottomPlan || '-'}</div><div className="pdb-metric-sub">{Number(stats.bottomPlanCount).toLocaleString()} 筆</div></div>
          </div>
        </div>

        {/* 告警中心 + 趨勢 */}
        <div className="pdb-section">
          <div className="pdb-grid pdb-grid-2">
            <div className="pdb-card" style={{ padding: 16 }}>
              <div className="pdb-section-head" style={{ marginBottom: 6 }}>
                <div className="pdb-section-title">告警中心</div>
                <div className="pdb-section-note">{allAlerts.length} 項</div>
              </div>
              <div className="pdb-alert-list">
                {allAlerts.length === 0 ? (
                  <div className="pdb-metric-sub" style={{ padding: '14px 4px' }}>暫無告警</div>
                ) : allAlerts.map((item, i) => (
                  <div className="pdb-alert-item" key={`${item.text}-${i}`}>
                    <span className={`pdb-dot ${item.severity === 'error' ? 'red' : 'warn'}`} />
                    <div className="pdb-alert-text">{item.text}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="pdb-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f3f4f6', marginBottom: 8 }}>近 7 日租戶註冊數量</div>
                <div className="pdb-chart">
                  <div className="pdb-chart-bars">
                    {buildChartBars(stats.tenantTrend, 'count').bars.map((b, i) => (
                      <span key={i} style={{ height: b.pct + '%' }} title={b.label + ': ' + (stats.tenantTrend[i]?.count || 0)} />
                    ))}
                  </div>
                  <div className="pdb-chart-labels">
                    {buildChartBars(stats.tenantTrend, 'count').labels.map((l, i) => <span key={i}>{l}</span>)}
                  </div>
                </div>
              </div>
              <div className="pdb-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f3f4f6', marginBottom: 8 }}>近 7 日付款金額</div>
                <div className="pdb-chart">
                  <div className="pdb-chart-bars">
                    {buildChartBars(stats.paymentTrend, 'amount').bars.map((b, i) => (
                      <span key={i} style={{ height: b.pct + '%', background: 'linear-gradient(180deg, #5fc89f, #b7ebd0)' }} title={b.label + ': $' + Number(stats.paymentTrend[i]?.amount || 0).toFixed(2)} />
                    ))}
                  </div>
                  <div className="pdb-chart-labels">
                    {buildChartBars(stats.paymentTrend, 'amount').labels.map((l, i) => <span key={i}>{l}</span>)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 最近活動 */}
        <div className="pdb-section">
          <div className="pdb-section-head"><div className="pdb-section-title">最近活動</div></div>
          <div className="pdb-grid pdb-grid-3">
            <div className="pdb-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#f3f4f6', marginBottom: 8 }}>最近註冊租戶</div>
              <ul className="pdb-mini-list">
                {stats.recentTenants.length === 0 ? <li><span className="pdb-mini-sub">暫無記錄</span></li> : stats.recentTenants.map(t => (
                  <li key={t.id}><span>{t.name || '-'}</span><span className="pdb-mini-sub">{t.tenantNumber} · {formatTimeShort(t.createdAt)}</span></li>
                ))}
              </ul>
            </div>
            <div className="pdb-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#f3f4f6', marginBottom: 8 }}>最近訂單</div>
              <ul className="pdb-mini-list">
                {stats.recentOrders.length === 0 ? <li><span className="pdb-mini-sub">暫無記錄</span></li> : stats.recentOrders.map(o => (
                  <li key={o.orderNo}><span>{o.tenantName} · {o.planName}</span><span className="pdb-mini-sub">${Number(o.payableAmount).toFixed(2)} · {formatTimeShort(o.createdAt)}</span></li>
                ))}
              </ul>
            </div>
            <div className="pdb-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#f3f4f6', marginBottom: 8 }}>最近付款</div>
              <ul className="pdb-mini-list">
                {stats.recentPayments.length === 0 ? <li><span className="pdb-mini-sub">暫無記錄</span></li> : stats.recentPayments.map(p => (
                  <li key={`${p.orderNo}-${p.paidAt}`}><span>{p.tenantName} · {p.orderNo}</span><span className="pdb-mini-sub">${Number(p.amount).toFixed(2)} · {formatTimeShort(p.paidAt)}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});

export default PlatformDashboard;
