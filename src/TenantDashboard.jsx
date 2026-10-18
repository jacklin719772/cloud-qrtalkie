import React, { useEffect, useState, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

const EMPTY = {
  tenant: {
    id: null,
    tenantNumber: '',
    name: '',
    sipDomain: '',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    status: 'active',
    createdAt: null,
    lastLoginAt: null,
  },
  plan: null,
  orderList: [],
  accounts: {
    total: 0, enabled: 0, expired: 0, expiring: 0, disabled: 0,
    noDisplayName: 0, noEmail: 0, syncAnomaly: 0, limit: 0, list: [],
  },
  trial: {
    total: 0, active: 0, expiring: 0, grace: 0, paused: 0, converted: 0, reclaimed: 0, list: [],
  },
  ecards: {
    total: 0, configured: 0, unconfigured: 0, active: 0, expired: 0, expiring: 0, list: [],
  },
  devices: {
    total: 0, online: 0, offline: 0, unknown: 0, assignmentExpired: 0, onlineRate: 0, list: [],
  },
  buildings: {
    communities: 0, activeCommunities: 0, buildings: 0, rooms: 0,
    entrances: 0, entranceBound: 0, usableEntrances: 0, devices: 0, deviceOnline: 0, list: [],
  },
  callCenter: {
    total: 0, active: 0, disabled: 0, visitorEnabled: 0, agents: 0,
    pendingInquiries: 0, todayInquiries: 0, monthInquiries: 0, todayCalls: 0, monthCalls: 0,
    list: [], recentInquiries: [], recentCalls: [],
  },
  todos: [],
};

function normalizeData(res) {
  if (!res || typeof res !== 'object') return EMPTY;
  const accounts = res.accounts || res.sipAccounts || {};
  return {
    ...EMPTY,
    ...res,
    tenant: { ...EMPTY.tenant, ...(res.tenant || {}) },
    accounts: { ...EMPTY.accounts, ...accounts },
    trial: { ...EMPTY.trial, ...(res.trial || {}) },
    ecards: { ...EMPTY.ecards, ...(res.ecards || {}) },
    devices: { ...EMPTY.devices, ...(res.devices || {}) },
    buildings: { ...EMPTY.buildings, ...(res.buildings || {}) },
    callCenter: { ...EMPTY.callCenter, ...(res.callCenter || {}) },
    orderList: Array.isArray(res.orderList) ? res.orderList : [],
    todos: Array.isArray(res.todos) ? res.todos : [],
  };
}

function formatDate(v) {
  if (!v) return '-';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 19).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(11, 16);
  return d.toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5);
}

const orderStatusLabels = {
  review_approved: '已生效',
  pending_review: '待審核',
  pending_payment: '待付款',
  payment_submitted: '待審核',
  review_rejected: '審核未通過',
  cancelled: '已取消',
};

const orderTypeLabels = {
  new_purchase: '新購',
  renewal: '續費',
  trial: '試用',
};

const paymentStatusLabels = {
  paid: '已付款',
  unpaid: '未付款',
  refunded: '已退款',
};

const trialStatusLabels = {
  active: '進行中',
  paused: '暫停',
  converted: '已轉正',
  reclaimed: '已回收',
};

export default function TenantDashboard({ onNavigate }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [sortKey, setSortKey] = useState('username');
  const [sortDir, setSortDir] = useState('asc');
  const [ecardSortKey, setEcardSortKey] = useState('sipAccount');
  const [ecardSortDir, setEcardSortDir] = useState('asc');

  const loadData = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await apiClient.get('/tenant/dashboard');
      setData(normalizeData(res));
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err?.data?.message || err?.message || '讀取租戶概覽失敗，請稍後重試。');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = data;

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((v) => (v === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortedList = useMemo(() => {
    const list = [...(d.accounts?.list || [])];
    list.sort((a, b) => {
      const va = (a[sortKey] || '').toString().toLowerCase();
      const vb = (b[sortKey] || '').toString().toLowerCase();
      return va.localeCompare(vb) * (sortDir === 'asc' ? 1 : -1);
    });
    return list;
  }, [d.accounts?.list, sortKey, sortDir]);

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
    if (ecardSortKey === key) setEcardSortDir((v) => (v === 'asc' ? 'desc' : 'asc'));
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

  const accountQuota = Number(d.plan?.accountQuantity || 0);
  const accountUsed = Number(d.accounts?.total || 0);
  const quotaPercent = accountQuota > 0 ? Math.min(100, Math.round((accountUsed / accountQuota) * 100)) : 0;
  const overQuota = accountQuota > 0 && accountUsed > accountQuota;

  const accountStatusLabel = (status) => {
    if (status === 'active') return '啟用';
    if (status === 'expired') return '已過期';
    if (status === 'disabled') return '已停用';
    return status || '-';
  };

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
        .td-divider { height: 100%; background: #1f2937; width: 1px; }
        .td-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #f3f4f6; }
        .td-tag { display: inline-block; padding: 3px 8px; border-radius: 12px; background: #065f46; color: #6ee7b7; font-size: 12px; margin-left: 8px; }
        .td-tag.warn { background: #78350f; color: #fcd34d; }
        .td-meta { line-height: 2; color: #9ca3af; font-size: 13px; }
        .td-contact { line-height: 2.4; font-size: 13px; color: #d1d5db; }
        .td-grid-2 { display: grid; grid-template-columns: 360px 1fr; gap: 14px; }
        .td-plan { padding: 22px; background: #1a2332; border-color: #f59e0b; }
        .td-plan-name { font-size: 15px; font-weight: 600; margin: 10px 0 18px; color: #f3f4f6; }
        .td-btn { border: 1px solid #374151; background: #1f2937; color: #93c5fd; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
        .td-btn:hover { background: #1e293b; }
        .td-btn:disabled { cursor: wait; opacity: 0.7; }
        .td-metrics-6 { display: grid; grid-template-columns: repeat(6,1fr); gap: 8px; }
        .td-metrics-5 { display: grid; grid-template-columns: repeat(5,1fr); gap: 8px; }
        .td-metric.small { padding: 10px; }
        .td-metric.small .td-m-value { font-size: 14px; }
        .td-metric { border: 1px solid #1f2937; border-radius: 12px; padding: 14px; background: #1a2332; }
        .td-metric .td-m-label { color: #9ca3af; margin-bottom: 8px; font-size: 12px; }
        .td-metric .td-m-value { font-size: 16px; font-weight: 500; color: #e5e7eb; }
        .td-metric .td-m-sub { color: #6b7280; font-size: 11px; margin-top: 4px; }
        .td-metric.green .td-m-value { color: #22c55e; }
        .td-metric.orange .td-m-value { color: #f59e0b; }
        .td-metric.purple .td-m-value { color: #8b5cf6; }
        .td-metric.red .td-m-value { color: #ef4444; }
        .td-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
        .td-table th, .td-table td { text-align: left; padding: 10px; border-bottom: 1px solid #1f2937; color: #d1d5db; }
        .td-table th { color: #9ca3af; font-weight: 500; background: #1a2332; }
        .td-status { padding: 3px 8px; border-radius: 99px; background: #065f46; color: #6ee7b7; font-size: 12px; }
        .td-status.red { background: #7f1d1d; color: #fca5a5; }
        .td-status.warn { background: #78350f; color: #fcd34d; }
        .td-small { font-size: 12px; color: #9ca3af; }
        .td-subline { margin-top: 10px; font-size: 12px; color: #9ca3af; display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
        .td-progress { height: 7px; background: #1f2937; border-radius: 99px; overflow: hidden; margin-top: 8px; }
        .td-bar { height: 100%; background: #3b82f6; border-radius: 99px; }
        .td-bar.orange { background: #f59e0b; }
        .td-todo { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .td-todo li { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; background: #111827; border: 1px solid #1f2937; font-size: 13px; color: #d1d5db; cursor: pointer; }
        .td-todo li:hover { border-color: #3b82f6; }
        .td-todo .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .td-todo .dot.error { background: #ef4444; }
        .td-todo .dot.warning { background: #f59e0b; }
        .td-half { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .td-mini-list { margin: 0; padding: 0; list-style: none; }
        .td-mini-list li { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid #1f2937; font-size: 12px; color: #d1d5db; }
        .td-mini-list li:last-child { border-bottom: 0; }
        .td-span-2 { grid-column: 1 / -1; }
        @media (max-width: 980px) {
          .td-grid-2, .td-half { grid-template-columns: 1fr; }
          .td-metrics-6 { grid-template-columns: repeat(3,1fr); }
          .td-metrics-5 { grid-template-columns: repeat(2,1fr); }
          .td-tenant-card { grid-template-columns: 1fr; }
          .td-divider { display: none; }
          .td-todo { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="td-page">
        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #b91c1c', borderRadius: '8px', padding: '8px 14px', marginBottom: '16px', fontSize: '13px', color: '#fecaca' }}>
            {error}
          </div>
        )}

        {/* 1. 租戶基本信息 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">1</span>租戶基本信息</h2>
          <div className="td-card td-tenant-card">
            <div>
              <div className="td-title">
                {d.tenant.name || '-'}
                <span className={`td-tag ${d.tenant.status === 'active' ? '' : 'warn'}`}>{d.tenant.status === 'active' ? '正常' : '異常'}</span>
              </div>
              <div className="td-meta">
                租戶編號：{d.tenant.tenantNumber || '-'}<br />
                創建時間：{formatDate(d.tenant.createdAt)}<br />
                最後登錄：{formatDate(d.tenant.lastLoginAt)}<br />
                <button className="td-btn" style={{ marginTop: 8 }} onClick={() => onNavigate?.('tenant')}>租戶設定</button>
              </div>
            </div>
            <div className="td-divider" />
            <div className="td-contact">
              <b>管理員：</b> {d.tenant.contactPerson || '-'}<br />
              <b>聯繫電話：</b> {d.tenant.contactPhone || '-'}<br />
              <b>郵箱：</b> {d.tenant.contactEmail || '-'}<br />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button className="td-btn" onClick={() => loadData({ silent: true })} disabled={loading || refreshing}>
                  <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                  {refreshing ? '更新中...' : '刷新數據'}
                </button>
                {updatedAt && <span className="td-small">更新於 {updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* 待處理提醒 */}
        {d.todos.length > 0 && (
          <div className="td-section">
            <h2 className="td-section-title"><span className="td-num">!</span>待處理提醒</h2>
            <div className="td-card" style={{ padding: 14 }}>
              <ul className="td-todo">
                {d.todos.map((todo, index) => (
                  <li key={`${todo.type}-${index}`} onClick={() => todo.view && onNavigate?.(todo.view)}>
                    <span className={`dot ${todo.severity === 'error' ? 'error' : 'warning'}`} />
                    <span>{todo.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 2. 套餐訂購情況 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">2</span>套餐訂購情況</h2>
          <div className="td-grid-2">
            <div className="td-card td-plan">
              <div className="td-small">當前套餐</div>
              <div className="td-plan-name">
                {d.plan?.planName || '未訂購'}
                <span className="td-tag" style={{ background: d.plan?.status === 'active' ? '#065f46' : '#7f1d1d', color: d.plan?.status === 'active' ? '#6ee7b7' : '#fca5a5' }}>
                  {d.plan?.status === 'active' ? '正常' : '已過期'}
                </span>
              </div>
              {d.plan ? (
                <div className="td-meta">
                  帳號配額：{accountUsed} / {accountQuota || '-'}<br />
                  <div className="td-progress">
                    <div className={`td-bar ${overQuota ? 'orange' : ''}`} style={{ width: `${quotaPercent}%` }} />
                  </div>
                  {overQuota && <div className="td-small" style={{ color: '#f59e0b', marginTop: 4 }}>已超出套餐帳號配額</div>}
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
            <div className="td-card" style={{ padding: 18, overflow: 'auto' }}>
              <table className="td-table" style={{ width: '100%', minWidth: '560px' }}>
                <thead><tr><th>訂單編號</th><th>類型</th><th>套餐名稱</th><th>狀態</th><th>金額</th><th>到期日期</th></tr></thead>
                <tbody>
                  {d.orderList.length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無訂單</td></tr>
                  ) : d.orderList.map((o) => (
                    <tr key={o.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.orderNo}</td>
                      <td>{orderTypeLabels[o.orderType] || o.orderType || '-'}</td>
                      <td>{o.planName}</td>
                      <td>
                        <span className={`td-status ${['review_rejected', 'cancelled'].includes(o.orderStatus) ? 'red' : (o.orderStatus !== 'review_approved' ? 'warn' : '')}`}>{orderStatusLabels[o.orderStatus] || o.orderStatus}</span>
                        <span className="td-small" style={{ marginLeft: 6 }}>{paymentStatusLabels[o.paymentStatus] || o.paymentStatus || '-'}</span>
                      </td>
                      <td>${Number(o.payableAmount || 0).toFixed(2)}</td>
                      <td>{o.expiresAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 3. 已分配帳號 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">3</span>已分配帳號 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('tenant-account-management')}>訂閱帳號管理</button></h2>
          <div className="td-card" style={{ padding: 18 }}>
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">總帳號數</div><div className="td-m-value">{Number(d.accounts.total).toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">啟用中</div><div className="td-m-value">{Number(d.accounts.enabled).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已過期</div><div className="td-m-value">{Number(d.accounts.expired).toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">7 天內到期</div><div className="td-m-value">{Number(d.accounts.expiring).toLocaleString()}</div></div>
              <div className="td-metric small red"><div className="td-m-label">已停用</div><div className="td-m-value">{Number(d.accounts.disabled).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">同步異常</div><div className="td-m-value">{Number(d.accounts.syncAnomaly).toLocaleString()}</div></div>
            </div>
            <div className="td-subline">
              <span>未設顯示名：{Number(d.accounts.noDisplayName)}</span>
              <span>未設郵箱：{Number(d.accounts.noEmail)}</span>
              <span>「同步異常」僅指本地同步記錄；AM 激活態請到訂閱帳號管理使用「狀態檢查」。</span>
            </div>

            {Number(d.trial.total) > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#111827', border: '1px solid #1f2937', fontSize: 12, color: '#d1d5db' }}>
                <b style={{ color: '#f3f4f6' }}>試用帳號：</b>
                進行中 {Number(d.trial.active)} · 7 天內到期 {Number(d.trial.expiring)} · 寬限期 {Number(d.trial.grace)} · 暫停 {Number(d.trial.paused)} · 已轉正 {Number(d.trial.converted)} · 已回收 {Number(d.trial.reclaimed)}
                <button className="td-btn" style={{ marginLeft: 10, padding: '4px 10px' }} onClick={() => onNavigate?.('trial-management')}>試用帳號管理</button>
              </div>
            )}

            <div style={{ marginTop: 14, maxHeight: 260, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('username')}>帳號<SortArrow col="username" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('displayName')}>顯示名<SortArrow col="displayName" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('email')}>郵箱<SortArrow col="email" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('phone')}>電話<SortArrow col="phone" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('webAccount')}>Web帳號<SortArrow col="webAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('contactBook')}>通訊錄<SortArrow col="contactBook" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('status')}>狀態<SortArrow col="status" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('expiresAt')}>到期日期<SortArrow col="expiresAt" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.length === 0 ? (
                    <tr><td colSpan="8" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : sortedList.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: 'monospace' }}>{a.username}</td>
                      <td>{a.displayName || '-'}</td>
                      <td>{a.email || '-'}</td>
                      <td>{a.phone || '-'}</td>
                      <td>{a.webAccount || '-'}</td>
                      <td>{a.contactBook || '-'}</td>
                      <td>
                        <span className={`td-status ${a.status !== 'active' ? 'red' : ''}`}>{accountStatusLabel(a.status)}</span>
                        {a.syncStatus && a.syncStatus !== 'active' && <span className="td-status warn" style={{ marginLeft: 6 }}>同步異常</span>}
                      </td>
                      <td>{a.expiresAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 4. 電子名片 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">4</span>電子名片設置 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('ecard-styles-management')}>Ecard 設置</button></h2>
          <div className="td-card" style={{ padding: 18 }}>
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">名片帳號總數</div><div className="td-m-value">{Number(d.ecards.total).toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">已配置</div><div className="td-m-value">{Number(d.ecards.configured).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">未配置</div><div className="td-m-value">{Number(d.ecards.unconfigured).toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">啟用中</div><div className="td-m-value">{Number(d.ecards.active).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已過期</div><div className="td-m-value">{Number(d.ecards.expired).toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">7 天內到期</div><div className="td-m-value">{Number(d.ecards.expiring).toLocaleString()}</div></div>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('sipAccount')}>SIP 帳號<EcardSortArrow col="sipAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('userName')}>用戶名<EcardSortArrow col="userName" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('webAccount')}>Web 帳號<EcardSortArrow col="webAccount" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('validFrom')}>有效期<EcardSortArrow col="validFrom" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('status')}>狀態<EcardSortArrow col="status" /></th>
                    <th style={{ cursor: 'pointer' }} onClick={() => handleEcardSort('createdAt')}>產生日期<EcardSortArrow col="createdAt" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEcardList.length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : sortedEcardList.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontFamily: 'monospace' }}>
                        {e.sipAccount}
                        {e.isTrial && <span className="td-tag warn" style={{ marginLeft: 6, fontSize: 10 }}>試用</span>}
                      </td>
                      <td>{e.userName || '-'}</td>
                      <td>{e.webAccount || '-'}</td>
                      <td>{e.validFrom || '-'} ~ {e.validTo || '-'}</td>
                      <td>
                        <span className={`td-status ${e.expired ? 'red' : (e.status !== 'active' ? 'warn' : '')}`}>
                          {e.expired ? '已過期' : (e.status === 'active' ? '啟用' : '停用')}
                        </span>
                      </td>
                      <td>{e.createdAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 5. 呼叫中心 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">5</span>呼叫中心設置情況 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('call-center')}>呼叫中心管理</button></h2>
          <div className="td-card" style={{ padding: 18 }}>
            <div className="td-metrics-6">
              <div className="td-metric small"><div className="td-m-label">呼叫中心總數</div><div className="td-m-value">{Number(d.callCenter.total).toLocaleString()}</div></div>
              <div className="td-metric small green"><div className="td-m-label">啟用中</div><div className="td-m-value">{Number(d.callCenter.active).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">已禁用</div><div className="td-m-value">{Number(d.callCenter.disabled).toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">開啟訪客登記</div><div className="td-m-value">{Number(d.callCenter.visitorEnabled).toLocaleString()}</div></div>
              <div className="td-metric small purple"><div className="td-m-label">坐席總數</div><div className="td-m-value">{Number(d.callCenter.agents).toLocaleString()}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">待處理留言</div><div className="td-m-value">{Number(d.callCenter.pendingInquiries).toLocaleString()}</div></div>
            </div>
            <div className="td-subline">
              <span>今日通話：{Number(d.callCenter.todayCalls)}</span>
              <span>本月通話：{Number(d.callCenter.monthCalls)}</span>
              <span>今日訪客留言：{Number(d.callCenter.todayInquiries)}</span>
              <span>本月訪客留言：{Number(d.callCenter.monthInquiries)}</span>
            </div>
            <div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr><th>名稱</th><th>呼叫地址</th><th>訪客登記</th><th>坐席數量</th><th>待處理</th><th>狀態</th><th>創建時間</th></tr>
                </thead>
                <tbody>
                  {d.callCenter.list.length === 0 ? (
                    <tr><td colSpan="7" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : d.callCenter.list.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name || '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.url || '-'}</td>
                      <td>{r.visitorEnabled ? '已開啟' : '未開啟'}</td>
                      <td>{r.agentCount}</td>
                      <td>{r.pendingInquiryCount > 0 ? <span className="td-status warn">{r.pendingInquiryCount}</span> : 0}</td>
                      <td><span className={`td-status ${r.status !== 'active' ? 'red' : ''}`}>{r.status === 'active' ? '啟用' : '停用'}</span></td>
                      <td>{r.createdAt || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="td-half" style={{ marginTop: 14 }}>
              <div>
                <div className="td-title" style={{ fontSize: 13, marginBottom: 4 }}>最近通話</div>
                <ul className="td-mini-list">
                  {d.callCenter.recentCalls.length === 0 ? (
                    <li><span className="td-small">暫無記錄</span></li>
                  ) : d.callCenter.recentCalls.map((c, i) => (
                    <li key={`call-${i}`}><span>{formatTime(c.initiatedAt)} {c.caller} → {c.callee}</span><span className="td-small">{c.status}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="td-title" style={{ fontSize: 13, marginBottom: 4 }}>最近訪客留言</div>
                <ul className="td-mini-list">
                  {d.callCenter.recentInquiries.length === 0 ? (
                    <li><span className="td-small">暫無記錄</span></li>
                  ) : d.callCenter.recentInquiries.map((v, i) => (
                    <li key={`inq-${i}`}><span>{formatTime(v.createdAt)} {v.centerName} · {v.sipNumber}</span><span className="td-small">{v.visitorName || v.visitorPhone || v.status}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* 6. 門禁系統 */}
        <div className="td-section">
          <h2 className="td-section-title"><span className="td-num">6</span>門禁系統設置情況 <button className="td-btn" style={{ marginLeft: 'auto' }} onClick={() => onNavigate?.('access-control')}>門禁系統管理</button></h2>
          <div className="td-card" style={{ padding: 18 }}>
            <div className="td-metrics-5">
              <div className="td-metric small">
                <div className="td-m-label">社區總數</div>
                <div className="td-m-value">{Number(d.buildings.communities)}</div>
                <div className="td-m-sub">啟用 {Number(d.buildings.activeCommunities)}</div>
              </div>
              <div className="td-metric small green"><div className="td-m-label">樓宇總數</div><div className="td-m-value">{Number(d.buildings.buildings)}</div></div>
              <div className="td-metric small orange"><div className="td-m-label">房間總數</div><div className="td-m-value">{Number(d.buildings.rooms).toLocaleString()}</div></div>
              <div className="td-metric small purple">
                <div className="td-m-label">可用入口 / 入口總數</div>
                <div className="td-m-value">{Number(d.buildings.usableEntrances)} / {Number(d.buildings.entrances)}</div>
                <div className="td-m-sub">已綁定設備 {Number(d.buildings.entranceBound)}</div>
              </div>
              <div className="td-metric small">
                <div className="td-m-label">設備在線 / 總數</div>
                <div className="td-m-value">{Number(d.devices.online)} / {Number(d.devices.total)}</div>
                <div className="td-m-sub">離線 {Number(d.devices.offline)} · 未知 {Number(d.devices.unknown)}</div>
              </div>
            </div>
            {Number(d.devices.assignmentExpired) > 0 && (
              <div className="td-small" style={{ color: '#f59e0b', marginTop: 8 }}>
                有 {Number(d.devices.assignmentExpired)} 台設備的分配已過期，請到門禁系統檢查。
              </div>
            )}
            <div style={{ marginTop: 14, maxHeight: 220, overflow: 'auto', scrollbarWidth: 'none' }}>
              <table className="td-table" style={{ width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr><th>社區名稱</th><th>地址</th><th>狀態</th><th>創建時間</th></tr>
                </thead>
                <tbody>
                  {d.buildings.list.length === 0 ? (
                    <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8' }}>暫無數據</td></tr>
                  ) : d.buildings.list.map((c) => (
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
