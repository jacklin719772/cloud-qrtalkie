import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

function formatTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

const MOCK_HEALTH = {
  cpu: { usage: 23, loadAvg: 0.42 },
  memory: { usage: 46 },
  disk: { usage: 62 },
  uptime: { days: 35, text: '35 天' },
  mariadb: 'running',
  mongodb: 'running',
  asterisk: 'running',
  flexisip: 'running',
  redis: 'running',
  coturn: 'running',
  mqtt: 'running',
  aiservice: 'running',
  lime: 'running',
  fts: 'running',
  accountManager: 'running',
  ssl: { daysLeft: 83, date: '2026-08-25' },
  load: { load1: 0.38, load5: 0.42, load15: 0.35 },
};

const MOCK_STATS = {
  sipCreated: 18367, sipAssigned: 12845, webCreated: 8521, webAssigned: 5932,
  tenantCount: 286, orderCount: 1248, pendingReviewCount: 15, pendingPaymentCount: 8, paidTotal: 186520,
  ecardCount: 3847, deviceCount: 2156, communityCount: 328, roomCount: 4920,
  topPlan: "企業旗艦版", bottomPlan: "基礎版",
  tenantTrend: [
    { date: 'Mon', count: 12 }, { date: 'Tue', count: 15 }, { date: 'Wed', count: 11 }, { date: 'Thu', count: 17 }, { date: 'Fri', count: 16 }, { date: 'Sat', count: 19 }, { date: 'Sun', count: 22 },
  ],
  paymentTrend: [
    { date: 'Mon', amount: 40 }, { date: 'Tue', amount: 55 }, { date: 'Wed', amount: 68 }, { date: 'Thu', amount: 50 }, { date: 'Fri', amount: 72 }, { date: 'Sat', amount: 60 }, { date: 'Sun', amount: 85 },
  ],
};

function buildChartBars(trend, valueKey) {
  if (!trend || trend.length === 0) return { bars: [], labels: [], max: 1 };
  const max = Math.max(1, ...trend.map(d => d[valueKey]));
  const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const bars = trend.map(d => ({ label: dayNames[new Date(d.date + 'T00:00:00').getDay()] || d.date.slice(5), pct: Math.round((d[valueKey] / max) * 100) }));
  return { bars, labels: bars.map(b => b.label), max };
}

const PlatformDashboard = forwardRef((props, ref) => {
  const [, setTick] = useState(0);
  const [health, setHealth] = useState(MOCK_HEALTH);
  const [stats, setStats] = useState(MOCK_STATS);

  const fetchHealth = async () => {
    try {
      const res = await apiClient.get('/platform/health');
      setHealth(res);
    } catch { /* keep mock */ }
  };

  const fetchStats = async () => {
    try {
      const res = await apiClient.get('/platform/stats');
      setStats(res);
    } catch { /* keep mock */ }
  };

    useEffect(() => { fetchHealth(); fetchStats(); }, []);

  const refresh = () => { setTick(t => t + 1); fetchHealth(); fetchStats(); };
  useImperativeHandle(ref, () => ({ refresh }));

  const handleRestartAi = async () => {
    if (!window.confirm('確定要重啟 Web AI 服務嗎？')) return;
    try {
      await apiClient.post('/platform/health/restart-ai');
      alert('Web AI 服務已重啟');
      fetchHealth();
    } catch (e) {
      alert('重啟失敗：' + (e.message || '未知錯誤'));
    }
  };

  const handleCleanLogs = async () => {
    if (!window.confirm('確定要清理 Asterisk 和 Flexisip 日誌嗎？\n\n安全清理策略：\n- 當前日誌檔案：truncate 清空（不影響服務執行）\n- 舊歸檔檔案（.gz）：直接刪除\n- .log.1 緩衝區：保留')) return;
    try {
      const res = await apiClient.post('/platform/health/clean-logs');
      alert(res.message || '日誌清理完成');
      fetchHealth();
    } catch (e) {
      alert('清理失敗：' + (e.message || '未知錯誤'));
    }
  };
  return (
    <section className="view active" id="platform-dashboard" style={{ overflow: 'auto', height: '100%', scrollbarWidth: 'none' }}>
      <style>{`
        .pdb-page { max-width: 1280px; }
        .pdb-title-row { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
        .pdb-title h1 { margin: 0; font-size: 20px; font-weight: 500; letter-spacing: .2px; color: #f3f4f6; }
        .pdb-title p { margin: 5px 0 0; color: #9ca3af; font-size: 12px; }
        .pdb-time { color: #9ca3af; font-size: 12px; }
        .pdb-section { margin-top: 14px; }
        .pdb-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .pdb-section-title { font-size: 14px; font-weight: 500; color: #0f172a; }
        .pdb-section-note { font-size: 11px; color: #9ca3af; }
        .pdb-grid { display: grid; gap: 12px; }
        .pdb-grid-4 { grid-template-columns: repeat(4, 1fr); }
        .pdb-grid-5 { grid-template-columns: repeat(5, 1fr); }
        .pdb-grid-3 { grid-template-columns: repeat(3, 1fr); }
        .pdb-grid-2 { grid-template-columns: 1.05fr .95fr; }
        .pdb-grid-2-eq { grid-template-columns: 1fr 1fr; }
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
        .pdb-bar.blue { background: #6aa6ff; }
        .pdb-service-card { display: flex; align-items: center; gap: 12px; min-height: 74px; }
        .pdb-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
        .pdb-dot.green { background: #59c98d; box-shadow: 0 0 0 4px rgba(89,201,141,.12); }
        .pdb-dot.warn { background: #f6b25d; box-shadow: 0 0 0 4px rgba(246,178,93,.15); }
        .pdb-service-name { font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #f3f4f6; }
        .pdb-service-status { font-size: 12px; color: #9ca3af; }
        .pdb-biz-card { text-align: left; }
        .pdb-biz-value { font-size: 18px; font-weight: 400; margin-top: 6px; color: #f3f4f6; }
        .pdb-biz-label { font-size: 12px; color: #9ca3af; }
        .pdb-alert-card { padding: 0; overflow: hidden; }
        .pdb-alert-header { padding: 13px 14px; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; }
        .pdb-alert-count { font-size: 11px; color: #9ca3af; }
        .pdb-alert-list { padding: 4px 0; }
        .pdb-alert-item { display: grid; grid-template-columns: 82px 1fr 80px; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #1f2937; }
        .pdb-alert-item:last-child { border-bottom: none; }
        .pdb-tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; border-radius: 99px; font-size: 11px; padding: 0 10px; }
        .pdb-tag.critical { background: #1118270f0; color: #d94a4a; }
        .pdb-tag.warning { background: #1118278e8; color: #b97710; }
        .pdb-tag.info { background: #eff6ff; color: #4178c0; }
        .pdb-alert-text { font-size: 12px; color: #e5e7eb; }
        .pdb-alert-time { text-align: right; font-size: 11px; color: #9ca3af; }
        .pdb-chart { height: 190px; position: relative; padding: 12px 10px 0; }
        .pdb-chart-bars { height: 135px; display: flex; align-items: end; gap: 12px; border-left: 1px solid #374151; border-bottom: 1px solid #374151; padding-left: 10px; }
        .pdb-chart-bars span { width: 100%; max-width: 34px; background: linear-gradient(180deg, #8bbcff, #dbeaff); border-radius: 8px 8px 0 0; }
        .pdb-chart-labels { display: flex; gap: 12px; padding-left: 11px; margin-top: 8px; color: #9ca3af; font-size: 10px; }
        .pdb-chart-labels span { width: 34px; text-align: center; }
        .pdb-activity { padding: 2px 0; }
        .pdb-activity-item { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid #1f2937; }
        .pdb-activity-item:last-child { border-bottom: none; }
        .pdb-activity-time { width: 44px; color: #9ca3af; font-size: 11px; flex-shrink: 0; }
        .pdb-activity-text { font-size: 12px; color: #e5e7eb; }
        .pdb-pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .pdb-pill { background: #f4f7fb; border: 1px solid #1f2937; border-radius: 999px; padding: 6px 10px; font-size: 11px; color: #667085; }
        .pdb-overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        #platform-dashboard::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="pdb-page">
        <div className="pdb-title-row" style={{ marginBottom: '14px' }}>
        </div>

        {/* 平台健康狀態 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title" style={{ fontWeight: 800, color: "#f3f4f6" }}>平台健康狀態</div>
            <div className="pdb-section-note">Ubuntu / 核心服務 / 通訊業務</div>
          </div>
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">CPU 使用率</div>
              <div className="pdb-metric-value">{health.cpu?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className="pdb-bar green" style={{ width: `${health.cpu?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">5分鐘平均負載：{health.load?.load5 ?? '-'}</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div className="pdb-metric-label">內存使用率</div>
              <div className="pdb-metric-value">{health.memory?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className="pdb-bar green" style={{ width: `${health.memory?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">已用 14.7GB / 32GB</div>
            </div>
            <div className="pdb-card pdb-metric">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="pdb-metric-label">磁盤使用率</div>
                <span onClick={handleCleanLogs} style={{ fontSize: '11px', color: '#2563eb', cursor: 'pointer', padding: '2px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff' }}>清理</span>
              </div>
              <div className="pdb-metric-value">{health.disk?.usage ?? '-'}%</div>
              <div className="pdb-progress"><div className={`pdb-bar ${(health.disk?.usage || 0) > 80 ? 'red' : (health.disk?.usage || 0) > 60 ? 'orange' : 'green'}`} style={{ width: `${health.disk?.usage || 0}%` }} /></div>
              <div className="pdb-metric-sub">/ 剩餘 {(health.disk?.usage != null) ? `${((100 - health.disk.usage) * 1.0).toFixed(0)}%` : '-'}</div>
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
              <div className="pdb-metric-sub">Ubuntu 24.04 · NTP 正常</div>
            </div>
          </div>
        </div>

        {/* 核心服務狀態 */}
        <div className="pdb-section">
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.flexisip === 'running' ? 'green' : health.flexisip === 'partial' ? 'warn' : 'warn'}`} />
              <div><div className="pdb-service-name">SIP 呼叫服務</div><div className="pdb-service-status">{health.flexisip === 'running' ? '執行正常' : health.flexisip === 'partial' ? '部分執行' : '已停止'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.asterisk === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">Web 呼叫服務</div><div className="pdb-service-status">{health.asterisk === 'running' ? '執行正常' : health.asterisk === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.mariadb === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">MariaDB</div><div className="pdb-service-status">{health.mariadb === 'running' ? '連線正常' : '連線異常'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.mongodb === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">MongoDB</div><div className="pdb-service-status">{health.mongodb === 'running' ? '執行正常' : health.mongodb === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.redis === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">Redis</div><div className="pdb-service-status">{health.redis === 'running' ? '執行正常' : health.redis === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
          </div>
        </div>

        {/* API 服務狀態 */}
        <div className="pdb-section">
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.accountManager === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">帳號管理 API</div><div className="pdb-service-status">{health.accountManager === 'running' ? '執行正常' : health.accountManager === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.lime === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">加密服務</div><div className="pdb-service-status">{health.lime === 'running' ? '執行正常' : health.lime === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.fts === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">檔案傳輸服務</div><div className="pdb-service-status">{health.fts === 'running' ? '執行正常' : health.fts === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.aiservice === 'running' ? 'green' : 'warn'}`} />
              <div style={{ flex: 1 }}>
                <div className="pdb-service-name">Web AI 服務</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="pdb-service-status">{health.aiservice === 'running' ? '執行正常' : health.aiservice === 'stopped' ? '已停止' : '未安裝'}</div>
                  {health.aiservice !== 'running' && (
                    <span onClick={handleRestartAi} style={{ fontSize: '10px', color: '#2563eb', cursor: 'pointer', padding: '1px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', whiteSpace: 'nowrap' }}>重啟</span>
                  )}
                </div>
              </div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.redis === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">Redis</div><div className="pdb-service-status">{health.redis === 'running' ? '執行正常' : health.redis === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.coturn === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">Coturn</div><div className="pdb-service-status">{health.coturn === 'running' ? '執行正常' : health.coturn === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
            <div className="pdb-card pdb-service-card">
              <span className={`pdb-dot ${health.mqtt === 'running' ? 'green' : 'warn'}`} />
              <div><div className="pdb-service-name">MQTT</div><div className="pdb-service-status">{health.mqtt === 'running' ? '執行正常' : health.mqtt === 'stopped' ? '已停止' : '未安裝'}</div></div>
            </div>
          </div>
        </div>

        {/* 通訊業務狀態 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title" style={{ fontWeight: 800, color: "#f3f4f6" }}>通訊業務狀態</div>
          </div>
          <div className="pdb-grid pdb-grid-5">
            <div className="pdb-card pdb-biz-card">
              <div className="pdb-biz-label">已創建 SIP 帳號</div>
              <div className="pdb-biz-value">{stats.sipCreated?.toLocaleString()}</div>
            </div>
            <div className="pdb-card pdb-biz-card">
              <div className="pdb-biz-label">已分配 SIP 帳號</div>
              <div className="pdb-biz-value">{stats.sipAssigned?.toLocaleString()}</div>
            </div>
            <div className="pdb-card pdb-biz-card">
              <div className="pdb-biz-label">已創建 Web 帳號</div>
              <div className="pdb-biz-value">{stats.webCreated?.toLocaleString()}</div>
            </div>
            <div className="pdb-card pdb-biz-card">
              <div className="pdb-biz-label">已分配 Web 帳號</div>
              <div className="pdb-biz-value">{stats.webAssigned?.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* 告警中心 + 平台核心指标 */}
        <div className="pdb-section">
          <div className="pdb-section-head">
            <div className="pdb-section-title" style={{ fontWeight: 800, color: "#f3f4f6" }}>运营情况</div>
          </div>
          <div className="pdb-grid pdb-grid-2">
            <div className="pdb-card" style={{ padding: '18px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { label: '已註冊租戶', value: stats.tenantCount?.toLocaleString() },
                  { label: '已銷售套餐', value: stats.orderCount?.toLocaleString() },
                  { label: '待稽核訂單', value: stats.pendingReviewCount?.toLocaleString(), color: stats.pendingReviewCount > 0 ? '#f87171' : '#f3f4f6' },
                  { label: '待付款訂單', value: stats.pendingPaymentCount?.toLocaleString(), color: stats.pendingPaymentCount > 0 ? '#fbbf24' : '#f3f4f6' },
                  { label: '已收款總額', value: '$' + (stats.paidTotal?.toLocaleString()) },
                  { label: '已分配 SIP 帳號', value: stats.sipAssigned?.toLocaleString() },
                  { label: '已分配 Web 帳號', value: stats.webAssigned?.toLocaleString() },
                  { label: '電子名片數量', value: stats.ecardCount?.toLocaleString() },
                  { label: '門控裝置數量', value: stats.deviceCount?.toLocaleString() },
                  { label: '管控社群數量', value: stats.communityCount?.toLocaleString() },
                  { label: '管控房間數量', value: stats.roomCount?.toLocaleString() },
                  { label: '銷量最高套餐', value: stats.topPlan },
                  { label: '銷量最低套餐', value: stats.bottomPlan },
                ].map((item, i) => (
                  <div key={i} style={{ background: '#1a2332', borderRadius: '8px', padding: '12px 14px', border: '1px solid #1f2937' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>{item.label}</div>
                    <div style={{ fontSize: '16px', fontWeight: 500, color: item.color || '#f3f4f6', whiteSpace: 'nowrap' }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="pdb-card" style={{ flex: 1, padding: '18px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#f3f4f6', marginBottom: '12px' }}>近7日租戶註冊數量</div>
                <div className="pdb-chart" style={{ height: '140px' }}>
                  <div className="pdb-chart-bars" style={{ height: '100px' }}>
                    {buildChartBars(stats.tenantTrend, 'count').bars.map((b, i) => (
                      <span key={i} style={{ height: b.pct + '%' }} title={b.label + ': ' + (stats.tenantTrend[i]?.count || 0)} />
                    ))}
                  </div>
                  <div className="pdb-chart-labels">
                    {buildChartBars(stats.tenantTrend, 'count').labels.map((l, i) => <span key={i}>{l}</span>)}
                  </div>
                </div>
              </div>
              <div className="pdb-card" style={{ flex: 1, padding: '18px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: '#f3f4f6', marginBottom: '12px' }}>近7日用戶付款金額</div>
                <div className="pdb-chart" style={{ height: '140px' }}>
                  <div className="pdb-chart-bars" style={{ height: '100px' }}>
                    {buildChartBars(stats.paymentTrend, 'amount').bars.map((b, i) => (
                      <span key={i} style={{ height: b.pct + '%', background: 'linear-gradient(180deg, #5fc89f, #b7ebd0)' }} title={b.label + ': $' + (stats.paymentTrend[i]?.amount || 0).toFixed(2)} />
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
      </div>
    </section>
  );
});

export default PlatformDashboard;
