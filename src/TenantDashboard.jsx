import React, { useEffect, useState, useMemo } from 'react';
import apiClient from './apiClient';

const MOCK = {
  tenant: { name: "未來社群物業管理有限公司", sipDomain: "sip.qrtalkie.org", contactPerson: "張三", contactPhone: "138****8888", contactEmail: "admin@futurecommunity.com", status: "active", createdAt: "2025-03-15 14:20:30", lastLoginAt: "2026-06-01 10:15:22" },
  plan: { planName: "企業版 Professional", accountQuantity: 10, addonNames: "Ecard, 呼叫中心", payableAmount: 999, paymentMethod: "線下支付", paymentDate: "2025-03-15", createdAt: "2025-03-15", expiresAt: "2027-06-01", daysLeft: 365, status: "active" },
  sipAccounts: { total: 3200, enabled: 3015, expired: 85, expiring: 32, noDisplayName: 185, noEmail: 320, limit: 5000, list: [] },
  ecards: { total: 3200, configured: 2800, unconfigured: 400, active: 2600, expired: 120, expiring: 48 },
  devices: { total: 218, online: 213, offline: 5, onlineRate: 97.7, limit: 500 },
  buildings: { communities: 35, buildings: 185, rooms: 6200, entrances: 128, entranceBound: 112, devices: 500, deviceBound: 218 },
  callCenter: { total: 5, active: 3, disabled: 1, visitorEnabled: 2, expiring: 1, agents: 28, todayCalls: 682, monthCalls: 12852, callTrend: [{date:"2026-05-27",count:45},{date:"2026-05-28",count:62},{date:"2026-05-29",count:38},{date:"2026-05-30",count:71},{date:"2026-05-31",count:55},{date:"2026-06-01",count:80},{date:"2026-06-02",count:68}], recentCalls: [{ time: "10:28", caller: "10001", callee: "10002", status: "completed" }, { time: "10:25", caller: "10008", callee: "10001", status: "completed" }, { time: "10:21", caller: "10005", callee: "10003", status: "completed" }, { time: "10:18", caller: "10012", callee: "10001", status: "failed" }] },
  cloudStorage: { used: 128, limit: 500 },
  alerts: [{ text: "東門門禁裝置離線", time: "10:25" }, { text: "地下車庫入口裝置離線", time: "09:58" }, { text: "南門對講裝置異常", time: "09:40" }, { text: "3棟2單元門禁裝置電量低", time: "08:30" }],
  orderList: [
    { id: 1, orderNo: "ORD20250315918452", planName: "企業版 Professional", orderStatus: "review_approved", payableAmount: 999, expiresAt: "2027-06-01" },
    { id: 2, orderNo: "ORD20240601918452", planName: "企業版 Professional", orderStatus: "review_approved", payableAmount: 999, expiresAt: "2026-06-01" },
  ],
};

function formatDate(v) { if (!v) return "-"; return String(v).slice(0, 10) + " " + String(v).slice(11, 19); }

function buildChartBars(trend, valueKey) {
  if (!trend || trend.length === 0) return { bars: [], labels: [], max: 1 };
  const max = Math.max(1, ...trend.map(d => d[valueKey]));
  const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const bars = trend.map(d => ({ label: dayNames[new Date(d.date + 'T00:00:00').getDay()] || d.date.slice(5), pct: Math.round((d[valueKey] / max) * 100) }));
  return { bars, labels: bars.map(b => b.label), max };
}

const orderStatusLabels = {
  review_approved: '已生效',
  pending_review: '待審核',
  pending_payment: '待付款',
  payment_submitted: '待審核',
  review_rejected: '審核未通過',
  cancelled: '已取消',
};

export default function TenantDashboard({ onNavigate }) {
  const [data, setData] = useState(MOCK);
  const [isMock, setIsMock] = useState(true);
  const [sortKey, setSortKey] = useState('username');
  const [sortDir, setSortDir] = useState('asc');
  const [ecardSortKey, setEcardSortKey] = useState('sipAccount');
  const [ecardSortDir, setEcardSortDir] = useState('asc');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/tenant/dashboard');
        setData(res);
        setIsMock(false);
      } catch { /* use mock */ }
    })();
  }, []);

  const d = data;

  const handleSort = (key) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortedList = useMemo(() => {
    const list = [...(d.sipAccounts?.list || [])];
    list.sort((a, b) => {
      const va = (a[sortKey] || '').toString().toLowerCase();
      const vb = (b[sortKey] || '').toString().toLowerCase();
      return va.localeCompare(vb) * (sortDir === 'asc' ? 1 : -1);
    });
    return list;
  }, [d.sipAccounts?.list, sortKey, sortDir]);

  const SortArrow = ({ col }) => (
    <span style={{ fontSize: 10, marginLeft: 2, color: sortKey === col ? '#2477ff' : '#cbd5e1' }}>
      {sortKey === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </span>
  );

  const EcardSortArrow = ({ col }) => (
    <span style={{ fontSize: 10, marginLeft: 2, color: ecardSortKey === col ? '#2477ff' : '#cbd5e1' }}>
      {ecardSortKey === col ? (ecardSortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </span>
  );

  const handleEcardSort = (key) => {
    if (ecardSortKey === key) { setEcardSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setEcardSortKey(key); setEcardSortDir('asc'); }
  };

  const sortedEcardList = useMemo(() => {
    const list = [...(d.ecards?.list || [])];
    list.sort((a, b) => {
      const va = (a[ecardSortKey] || '').toString().toLowerCase();
      const vb = (b[ecardSortKey] || '').toString().toLowerCase();
      return va.localeCompare(vb) * (ecardSortDir === 'asc' ? 1 : -1);
    });
    return list;
  }, [d.ecards?.list, ecardSortKey, ecardSortDir]);

  return (
    <section className="view active" id="tenant-dashboard" style={{ overflow: 'auto', height: '100%', scrollbarWidth: 'none', background: '#0f172a', padding: '24px' }}>
      <style>{`
        #tenant-dashboard::-webkit-scrollbar { display: none; }
        #console .main.domain-home-mode .page-heading { margin-bottom: 4px; margin-top: -16px; }
        .td-page { max-width: 1440px; }
        .td-section { margin-bottom: 16px; }
        .td-section-title { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        .td-num { width: 24px; height: 24px; border-radius: 7px; background: #3b82f6; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
        .td-card { background: #1a2332; border: 1px solid #2d3a4a; border-radius: 10px; }
        .td-tenant-card { padding: 22px; display: grid; grid-template-columns: 1fr 1px 320px; gap: 24px; align-items: center; }
        .td-logo-box { width: 110px; height: 110px; border-radius: 14px; background: #1a2332; display: flex; align-items: center; justify-content: center; font-size: 42px; }
        .td-divider { height: 100%; background: #1f2937; width: 1px; }
        .td-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #f3f4f6; }
        .td-tag { display: inline-block; padding: 3px 8px; border-radius: 12px; background: #065f46; color: #6ee7b7; font-size: 12px; margin-left: 8px; }
        .td-meta { line-height: 2; color: #9ca3af; font-size: 13px; }
        .td-contact { line-height: 2.4; font-size: 13px; color: #d1d5db; }
        .td-grid-2 { display: grid; grid-template-columns: 360px 1fr; gap: 14px; }
        .td-plan { padding: 22px; background: #1a2332; border-color: #f59e0b; }
        .td-plan-name { font-size: 15px; font-weight: 600; margin: 10px 0 18px; color: #f3f4f6; }
        .td-btn { border: 1px solid #374151; background: #1f2937; color: #93c5fd; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
        .td-btn:hover { background: #1e293b; }
        .td-usage-grid { padding: 18px; display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
        .td-usage-item { border: 1px solid #1f2937; border-radius: 12px; padding: 15px; }
        .td-usage-head { display: flex; justify-content: space-between; color: #9ca3af; margin-bottom: 12px; font-size: 12px; }
        .td-value { font-size: 16px; font-weight: 500; color: #e5e7eb; }
        .td-small { font-size: 12px; color: #9ca3af; }
        .td-progress { height: 7px; background: #1f2937; border-radius: 99px; overflow: hidden; margin-top: 12px; }
        .td-bar { height: 100%; background: #3b82f6; border-radius: 99px; }
        .td-bar.green { background: #22c55e; }
        .td-bar.orange { background: #f59e0b; }
        .td-bar.purple { background: #8b5cf6; }
        .td-half { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .td-panel { padding: 18px; }
        .td-metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
        .td-metrics-6 { display: grid; grid-template-columns: repeat(6,1fr); gap: 8px; }
        .td-metrics-5 { display: grid; grid-template-columns: repeat(5,1fr); gap: 8px; }
        .td-metric.small { padding: 10px; }
        .td-metric.small .td-m-value { font-size: 14px; }
        .td-metric { border: 1px solid #1f2937; border-radius: 12px; padding: 14px; background: #1a2332; }
        .td-metric .td-m-label { color: #9ca3af; margin-bottom: 8px; font-size: 12px; }
        .td-metric .td-m-value { font-size: 16px; font-weight: 500; color: #e5e7eb; }
        .td-metric.green .td-m-value { color: #22c55e; }
        .td-metric.orange .td-m-value { color: #f59e0b; }
        .td-metric.purple .td-m-value { color: #8b5cf6; }
        .td-subgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
        .td-donut { width: 120px; height: 120px; border-radius: 50%; position: relative; margin: 10px auto; }
        .td-donut-inner { position: absolute; inset: 28px; background: #1a2332; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 500; color: #e5e7eb; }
        .td-spark { height: 70px; background: linear-gradient(180deg,rgba(36,119,255,.12),transparent); border-radius: 10px; position: relative; margin-top: 10px; overflow: hidden; }
        .td-spark:before { content: ""; position: absolute; left: 8px; right: 8px; top: 38px; height: 3px; background: linear-gradient(90deg,#8ab6ff,#2477ff); transform: skewY(-16deg); border-radius: 99px; }
        .td-list { margin: 0; padding: 0; list-style: none; }
        .td-list li { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #1f2937; font-size: 13px; color: #d1d5db; }
        .td-list li:last-child { border-bottom: 0; }
        .td-wide-metrics { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 12px; }
        .td-chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .td-chart { border: 1px solid #1f2937; border-radius: 12px; padding: 14px; background: #1a2332; }
        .td-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
        .td-table th, .td-table td { text-align: left; padding: 10px; border-bottom: 1px solid #1f2937; color: #d1d5db; }
        .td-table th { color: #9ca3af; font-weight: 500; background: #1a2332; }
        .td-status { padding: 3px 8px; border-radius: 99px; background: #065f46; color: #6ee7b7; font-size: 12px; }
        .td-status.red { background: #7f1d1d; color: #fca5a5; }
        .td-building-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 12px; }
        .td-building-bottom { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 12px; }
        .td-circle-rate { width: 90px; height: 90px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: auto; font-size: 18px; font-weight: 500; border: 4px solid #18a969; color: #18a969; }
      `}</style>

      <div className="td-page">
        {isMock && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '8px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '8px' }}>
            &#9888; 無法連接服務器，當前顯示示例數據。請檢查網絡連接後刷新頁面。
          </div>
        )}
        {/* 1. 租戶基本信息 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">1</span>租戶基本信息</h2>
          <div className="td-card td-tenant-card">
            <div>
              <div className="td-title">{d.tenant.name} <span className="td-tag">{d.tenant.status === 'active' ? '正常' : '異常'}</span></div>
              <div className="td-meta">
                租戶ID：TENANT-{String(d.tenant.id).padStart(5, '0')}<br />
                創建時間：{formatDate(d.tenant.createdAt)}<br />
                最后登錄：{formatDate(d.tenant.lastLoginAt)}<br />
                <button className="td-btn" style={{ marginTop: 8 }} onClick={() => onNavigate?.('tenant')}>租戶設定</button>
              </div>
            </div>
            <div className="td-divider" />
            <div className="td-contact">
              <b>管理员：</b> {d.tenant.contactPerson || '-'}<br />
              <b>聯繫電話：</b> {d.tenant.contactPhone || '-'}<br />
              <b>郵箱：</b> {d.tenant.contactEmail || '-'}
            </div>
          </div>
        </div>

        {/* 2. 套餐訂購情況 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">2</span>套餐訂購情況</h2>
          <div className="td-grid-2">
            <div className="td-card td-plan">
              <div className="td-small">當前套餐</div>
              <div className="td-plan-name">{d.plan?.planName || '未訂購'} <span className="td-tag" style={{ background: d.plan?.status === 'active' ? '#065f46' : '#7f1d1d', color: d.plan?.status === 'active' ? '#6ee7b7' : '#fca5a5' }}>{d.plan?.status === 'active' ? '正常' : '已過期'}</span></div>
              {d.plan ? (
                <div className="td-meta">
                  帳號數量：{d.plan.accountQuantity ?? '-'}<br />
                  增值服務：{d.plan.addonNames || '-'}<br />
                  金額：${(d.plan.payableAmount ?? 0).toFixed(2)}<br />
                  付款時間：{d.plan.paymentDate || '-'}<br />
                  開通時間：{d.plan.createdAt || '-'}<br />
                  有效期：{d.plan.expiresAt}<br />
                  剩餘時間：<span style={{ fontSize: 22, color: '#2477ff', fontWeight: 500 }}>{d.plan.daysLeft}</span> 天
                </div>
              ) : <div className="td-meta">暫無訂購套餐</div>}
              <button className="td-btn" style={{ marginTop: 14 }} onClick={() => onNavigate?.('domain')}>我的套餐</button>
            </div>
            <div className="td-card td-panel" style={{ overflow: 'auto' }}>
              <table className="td-table" style={{ width: '100%', minWidth: '500px' }}>
                <thead><tr><th>訂單编號</th><th>套餐名稱</th><th>狀態</th><th>金額</th><th>到期日期</th></tr></thead>
                <tbody>
                  {(d.orderList || []).length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無訂單</td></tr>
                  ) : (d.orderList || []).map(o => (
                    <tr key={o.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.orderNo}</td>
                      <td>{o.planName}</td>
                      <td><span className={`td-status ${o.orderStatus !== 'review_approved' ? 'red' : ''}`}>{orderStatusLabels[o.orderStatus] || o.orderStatus}</span></td>
                      <td>${o.payableAmount.toFixed(2)}</td>
                      <td>{o.expiresAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 3. 帳號情況 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">3</span>已分配帳號 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('tenant-account-management')}>帳號管理</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">總帳號數</div><div className="td-m-value">{d.sipAccounts.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">已啟用</div><div className="td-m-value">{d.sipAccounts.enabled.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已過期</div><div className="td-m-value">{d.sipAccounts.expired.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">即將過期</div><div className="td-m-value">{d.sipAccounts.expiring.toLocaleString()}</div></div>
              <div className="td-metric small"><div className="td-m-label">未設置顯示名</div><div className="td-m-value">{d.sipAccounts.noDisplayName.toLocaleString()}</div></div>
              <div className="td-metric small"><div className="td-m-label">未設置郵箱</div><div className="td-m-value">{d.sipAccounts.noEmail.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 260, overflow: 'auto', scrollbarWidth: 'none' }}>
              <style>{`.td-table-wrap::-webkit-scrollbar { display: none; }`}</style>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('username')}>帳號<SortArrow col="username" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('displayName')}>顯示名<SortArrow col="displayName" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('email')}>郵箱<SortArrow col="email" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('phone')}>電話<SortArrow col="phone" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('webAccount')}>Web帳號<EcardSortArrow col="webAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('contactBook')}>通讯錄<SortArrow col="contactBook" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('status')}>狀態<EcardSortArrow col="status" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('expiresAt')}>到期日期<SortArrow col="expiresAt" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.length === 0 ? (
                    <tr><td colSpan="8" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : sortedList.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: 'monospace' }}>{a.username}</td>
                      <td>{a.displayName || '-'}</td>
                      <td>{a.email || '-'}</td>
                      <td>{a.phone || '-'}</td>
                      <td>{a.webAccount || '-'}</td>
                      <td>{a.contactBook || '-'}</td>
                      <td><span className={`td-status ${a.status !== 'active' ? 'red' : ''}`}>{a.status === 'active' ? '啟用' : a.status}</span></td>
                      <td>{a.expiresAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 4. Ecard 情況 */}
        <div className="td-section" style={{ marginTop: 16 }}>
          <h2 className="td-section-title"><span className="td-num">4</span>電子名片設置 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('ecard-styles-management')}>Ecard 設置</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">Ecard 總數</div><div className="td-m-value">{d.ecards.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">已配置</div><div className="td-m-value">{d.ecards.configured.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">未配置</div><div className="td-m-value">{d.ecards.unconfigured.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">啟用中</div><div className="td-m-value">{d.ecards.active.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已過期</div><div className="td-m-value">{d.ecards.expired.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">即將過期</div><div className="td-m-value">{d.ecards.expiring.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('sipAccount')}>SIP 帳號<EcardSortArrow col="sipAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('userName')}>用戶名<EcardSortArrow col="userName" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("webAccount")}>Web 帳號<EcardSortArrow col="webAccount" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("validFrom")}>有效期<EcardSortArrow col="validFrom" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("status")}>狀態<EcardSortArrow col="status" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("createdAt")}>產生日期<EcardSortArrow col="createdAt" /></th></tr>
                </thead>
                <tbody>
                  {(d.ecards.list || []).length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : sortedEcardList.map(e => (
                    <tr key={e.id}>
                      <td style={{ fontFamily: 'monospace' }}>{e.sipAccount}</td>
                      <td>{e.userName || '-'}</td>
                      <td>{e.webAccount || '-'}</td>
                      <td>{e.validFrom || '-'} ~ {e.validTo || '-'}</td>
                      <td><span className={`td-status ${e.status !== 'active' ? 'red' : ''}`}>{e.status === 'active' ? '啟用' : '停用'}</span></td>
                      <td>{e.createdAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 5. 呼叫中心情況 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">5</span>呼叫中心設置情況 <button className="td-btn" style={{ marginLeft: "auto" }} onClick={() => onNavigate?.("call-center")}>呼叫中心管理</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">呼叫中心總數</div><div className="td-m-value">{d.callCenter.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">啟用中</div><div className="td-m-value">{d.callCenter.active.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已禁用</div><div className="td-m-value">{d.callCenter.disabled.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">開啟訪客登記</div><div className="td-m-value">{d.callCenter.visitorEnabled.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">即將到期</div><div className="td-m-value">{d.callCenter.expiring.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">坐席總數</div><div className="td-m-value">{d.callCenter.agents.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: "auto", scrollbarWidth: "none" }}>
              <table className="td-table" style={{ width: "100%" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                  <tr><th>名稱</th><th>呼叫地址</th><th>訪客登記</th><th>坐席數量</th><th>狀態</th><th>創建時間</th></tr>
                </thead>
                <tbody>
                  {(d.callCenter.list || []).length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: "center", color: "#94a3b8" }}>暫無數據</td></tr>
                  ) : (d.callCenter.list || []).map(r => (
                    <tr key={r.id}>
                      <td>{r.name || "-"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.url || "-"}</td>
                      <td>{r.visitorEnabled ? "已開啟" : "未開啟"}</td>
                      <td>{r.agentCount}</td>
                      <td><span className={`td-status ${r.status !== 'active' ? 'red' : ''}`}>{r.status === 'active' ? '啟用' : '停用'}</span></td>
                      <td>{r.createdAt || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 6. 門禁係統設置情況 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">6</span>門禁係統設置情況 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('access-control')}>門禁係統管理</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-5">
              <div className="td-metric small"><div className="td-m-label">社區總數</div><div className="td-m-value">{d.buildings.communities}</div></div>
              <div className="td-metric small green"><div className="td-m-label">樓宇總數</div><div className="td-m-value">{d.buildings.buildings}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">房間總數</div><div className="td-m-value">{d.buildings.rooms.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">入口總數</div><div className="td-m-value">{d.buildings.entranceBound}/{d.buildings.entrances}</div></div>
              <div className="td-metric small"><div className="td-m-label">設備數量</div><div className="td-m-value">{d.buildings.deviceBound}/{d.buildings.devices}</div></div>
            </div>
<div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr><th>社區名稱</th><th>地址</th><th>狀態</th><th>創建時間</th></tr>
                </thead>
                <tbody>
                  {(d.buildings.list || []).length === 0 ? (
                    <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : (d.buildings.list || []).map(c => (
                    <tr key={c.id}>
                      <td>{c.name || '-'}</td>
                      <td>{c.address || '-'}</td>
                      <td><span className={`td-status ${!c.isActive ? 'red' : ''}`}>{c.isActive ? '啟用' : '停用'}</span></td>
                      <td>{c.createdAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        </div>
    </section>
  );
}
