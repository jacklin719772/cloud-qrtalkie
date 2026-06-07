import React, { useEffect, useState, useMemo } from 'react';
import apiClient from './apiClient';

const MOCK = {
  tenant: { name: "未来社区物业管理有限公司", sipDomain: "sip.qrtalkie.org", contactPerson: "张三", contactPhone: "138****8888", contactEmail: "admin@futurecommunity.com", status: "active", createdAt: "2025-03-15 14:20:30", lastLoginAt: "2026-06-01 10:15:22" },
  plan: { planName: "企业版 Professional", accountQuantity: 10, addonNames: "Ecard, 呼叫中心", payableAmount: 999, paymentMethod: "线下支付", paymentDate: "2025-03-15", createdAt: "2025-03-15", expiresAt: "2027-06-01", daysLeft: 365, status: "active" },
  sipAccounts: { total: 3200, enabled: 3015, expired: 85, expiring: 32, noDisplayName: 185, noEmail: 320, limit: 5000, list: [] },
  ecards: { total: 3200, configured: 2800, unconfigured: 400, active: 2600, expired: 120, expiring: 48 },
  devices: { total: 218, online: 213, offline: 5, onlineRate: 97.7, limit: 500 },
  buildings: { communities: 35, buildings: 185, rooms: 6200, entrances: 128, entranceBound: 112, devices: 500, deviceBound: 218 },
  callCenter: { total: 5, active: 3, disabled: 1, visitorEnabled: 2, expiring: 1, agents: 28, todayCalls: 682, monthCalls: 12852, callTrend: [{date:"2026-05-27",count:45},{date:"2026-05-28",count:62},{date:"2026-05-29",count:38},{date:"2026-05-30",count:71},{date:"2026-05-31",count:55},{date:"2026-06-01",count:80},{date:"2026-06-02",count:68}], recentCalls: [{ time: "10:28", caller: "10001", callee: "10002", status: "completed" }, { time: "10:25", caller: "10008", callee: "10001", status: "completed" }, { time: "10:21", caller: "10005", callee: "10003", status: "completed" }, { time: "10:18", caller: "10012", callee: "10001", status: "failed" }] },
  cloudStorage: { used: 128, limit: 500 },
  alerts: [{ text: "东门门禁设备离线", time: "10:25" }, { text: "地下车库入口设备离线", time: "09:58" }, { text: "南门对讲设备异常", time: "09:40" }, { text: "3栋2单元门禁设备电量低", time: "08:30" }],
  orderList: [
    { id: 1, orderNo: "ORD20250315918452", planName: "企业版 Professional", orderStatus: "review_approved", payableAmount: 999, expiresAt: "2027-06-01" },
    { id: 2, orderNo: "ORD20240601918452", planName: "企业版 Professional", orderStatus: "review_approved", payableAmount: 999, expiresAt: "2026-06-01" },
  ],
};

function formatDate(v) { if (!v) return "-"; return String(v).slice(0, 10) + " " + String(v).slice(11, 19); }

function buildChartBars(trend, valueKey) {
  if (!trend || trend.length === 0) return { bars: [], labels: [], max: 1 };
  const max = Math.max(1, ...trend.map(d => d[valueKey]));
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
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
            &#9888; 无法连接服务器，当前显示示例数据。请检查网络连接后刷新页面。
          </div>
        )}
        {/* 1. 租户基本信息 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">1</span>租户基本信息</h2>
          <div className="td-card td-tenant-card">
            <div>
              <div className="td-title">{d.tenant.name} <span className="td-tag">{d.tenant.status === 'active' ? '正常' : '异常'}</span></div>
              <div className="td-meta">
                租户ID：TENANT-{String(d.tenant.id).padStart(5, '0')}<br />
                创建时间：{formatDate(d.tenant.createdAt)}<br />
                最后登录：{formatDate(d.tenant.lastLoginAt)}<br />
                <button className="td-btn" style={{ marginTop: 8 }} onClick={() => onNavigate?.('tenant')}>租户设定</button>
              </div>
            </div>
            <div className="td-divider" />
            <div className="td-contact">
              <b>管理员：</b> {d.tenant.contactPerson || '-'}<br />
              <b>联系电话：</b> {d.tenant.contactPhone || '-'}<br />
              <b>邮箱：</b> {d.tenant.contactEmail || '-'}
            </div>
          </div>
        </div>

        {/* 2. 套餐订购情况 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">2</span>套餐订购情况</h2>
          <div className="td-grid-2">
            <div className="td-card td-plan">
              <div className="td-small">当前套餐</div>
              <div className="td-plan-name">{d.plan?.planName || '未订购'} <span className="td-tag" style={{ background: d.plan?.status === 'active' ? '#065f46' : '#7f1d1d', color: d.plan?.status === 'active' ? '#6ee7b7' : '#fca5a5' }}>{d.plan?.status === 'active' ? '正常' : '已过期'}</span></div>
              {d.plan ? (
                <div className="td-meta">
                  账号数量：{d.plan.accountQuantity ?? '-'}<br />
                  增值服务：{d.plan.addonNames || '-'}<br />
                  金额：${(d.plan.payableAmount ?? 0).toFixed(2)}<br />
                  付款时间：{d.plan.paymentDate || '-'}<br />
                  开通时间：{d.plan.createdAt || '-'}<br />
                  有效期：{d.plan.expiresAt}<br />
                  剩余时间：<span style={{ fontSize: 22, color: '#2477ff', fontWeight: 500 }}>{d.plan.daysLeft}</span> 天
                </div>
              ) : <div className="td-meta">暂无订购套餐</div>}
              <button className="td-btn" style={{ marginTop: 14 }} onClick={() => onNavigate?.('domain')}>我的套餐</button>
            </div>
            <div className="td-card td-panel" style={{ overflow: 'auto' }}>
              <table className="td-table" style={{ width: '100%', minWidth: '500px' }}>
                <thead><tr><th>订单编号</th><th>套餐名称</th><th>状态</th><th>金额</th><th>到期日期</th></tr></thead>
                <tbody>
                  {(d.orderList || []).length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8' }}>暂无订单</td></tr>
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

        {/* 3. 账号情况 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">3</span>已分配账号 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('tenant-account-management')}>账号管理</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">总账号数</div><div className="td-m-value">{d.sipAccounts.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">已启用</div><div className="td-m-value">{d.sipAccounts.enabled.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已过期</div><div className="td-m-value">{d.sipAccounts.expired.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">即将过期</div><div className="td-m-value">{d.sipAccounts.expiring.toLocaleString()}</div></div>
              <div className="td-metric small"><div className="td-m-label">未设置显示名</div><div className="td-m-value">{d.sipAccounts.noDisplayName.toLocaleString()}</div></div>
              <div className="td-metric small"><div className="td-m-label">未设置邮箱</div><div className="td-m-value">{d.sipAccounts.noEmail.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 260, overflow: 'auto', scrollbarWidth: 'none' }}>
              <style>{`.td-table-wrap::-webkit-scrollbar { display: none; }`}</style>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('username')}>账号<SortArrow col="username" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('displayName')}>显示名<SortArrow col="displayName" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('email')}>邮箱<SortArrow col="email" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('phone')}>电话<SortArrow col="phone" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('webAccount')}>Web账号<EcardSortArrow col="webAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('contactBook')}>通讯录<SortArrow col="contactBook" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('status')}>状态<EcardSortArrow col="status" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('expiresAt')}>到期日期<SortArrow col="expiresAt" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.length === 0 ? (
                    <tr><td colSpan="8" style={{ textAlign: 'center', color: '#94a3b8' }}>暂无数据</td></tr>
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

        {/* 4. Ecard 情况 */}
        <div className="td-section" style={{ marginTop: 16 }}>
          <h2 className="td-section-title"><span className="td-num">4</span>电子名片设置 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('ecard-styles-management')}>Ecard 设置</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">Ecard 总数</div><div className="td-m-value">{d.ecards.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">已配置</div><div className="td-m-value">{d.ecards.configured.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">未配置</div><div className="td-m-value">{d.ecards.unconfigured.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">启用中</div><div className="td-m-value">{d.ecards.active.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已过期</div><div className="td-m-value">{d.ecards.expired.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">即将过期</div><div className="td-m-value">{d.ecards.expiring.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('sipAccount')}>SIP 账号<EcardSortArrow col="sipAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('userName')}>用户名<EcardSortArrow col="userName" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("webAccount")}>Web 账号<EcardSortArrow col="webAccount" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("validFrom")}>有效期<EcardSortArrow col="validFrom" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("status")}>状态<EcardSortArrow col="status" /></th><th style={{ cursor: "pointer" }} onClick={() => handleEcardSort("createdAt")}>产生日期<EcardSortArrow col="createdAt" /></th></tr>
                </thead>
                <tbody>
                  {(d.ecards.list || []).length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8' }}>暂无数据</td></tr>
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

        {/* 5. 呼叫中心情况 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">5</span>呼叫中心设置情况 <button className="td-btn" style={{ marginLeft: "auto" }} onClick={() => onNavigate?.("call-center")}>呼叫中心管理</button></h2>
          <div className="td-card td-panel">
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">呼叫中心總數</div><div className="td-m-value">{d.callCenter.total.toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">啟用中</div><div className="td-m-value">{d.callCenter.active.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已禁用</div><div className="td-m-value">{d.callCenter.disabled.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">開啟訪客登記</div><div className="td-m-value">{d.callCenter.visitorEnabled.toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">即將到期</div><div className="td-m-value">{d.callCenter.expiring.toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">坐席总数</div><div className="td-m-value">{d.callCenter.agents.toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: "auto", scrollbarWidth: "none" }}>
              <table className="td-table" style={{ width: "100%" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                  <tr><th>名称</th><th>呼叫地址</th><th>访客登记</th><th>坐席数量</th><th>状态</th><th>创建时间</th></tr>
                </thead>
                <tbody>
                  {(d.callCenter.list || []).length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: "center", color: "#94a3b8" }}>暂无数据</td></tr>
                  ) : (d.callCenter.list || []).map(r => (
                    <tr key={r.id}>
                      <td>{r.name || "-"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.url || "-"}</td>
                      <td>{r.visitorEnabled ? "已开启" : "未开启"}</td>
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

        {/* 6. 门禁系统设置情况 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">6</span>门禁系统设置情况 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('access-control')}>门禁系统管理</button></h2>
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
                  <tr><th>社区名称</th><th>地址</th><th>状态</th><th>创建时间</th></tr>
                </thead>
                <tbody>
                  {(d.buildings.list || []).length === 0 ? (
                    <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8' }}>暂无数据</td></tr>
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
