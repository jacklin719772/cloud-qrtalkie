import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

const TABS = [
  { key: 'web', label: 'Web 帳號狀態' },
  { key: 'sip', label: 'SIP 帳號狀態' },
  { key: 'callLog', label: 'Web 呼叫日誌' },
  { key: 'sipCallLog', label: 'SIP 呼叫日誌' },
];

const MOCK_CALL_LOGS = [
  { linkedId: '1686900010.1001', eventTime: '2026-06-10T14:22:15.000Z', endTime: '2026-06-10T14:24:32.000Z', durationSeconds: 137, cidName: '訪客9503', cidNumber: '9503', extension: '10001', channelName: 'PJSIP/9503-00000001', eventCount: 8, direction: 'outbound' },
  { linkedId: '1686900010.1002', eventTime: '2026-06-10T14:18:05.000Z', endTime: '2026-06-10T14:19:48.000Z', durationSeconds: 103, cidName: '管理處', cidNumber: '9507', extension: '9508', channelName: 'PJSIP/9507-00000002', eventCount: 6, direction: 'internal' },
  { linkedId: '1686900010.1003', eventTime: '2026-06-10T14:10:30.000Z', endTime: '2026-06-10T14:12:10.000Z', durationSeconds: 100, cidName: '', cidNumber: '0223456789', extension: '9505', channelName: 'PJSIP/9505-00000003', eventCount: 10, direction: 'inbound' },
  { linkedId: '1686900010.1004', eventTime: '2026-06-10T13:55:12.000Z', endTime: '2026-06-10T13:56:45.000Z', durationSeconds: 93, cidName: '訪客9508', cidNumber: '9508', extension: '10002', channelName: 'PJSIP/9508-00000004', eventCount: 5, direction: 'outbound' },
  { linkedId: '1686900010.1005', eventTime: '2026-06-10T13:42:00.000Z', endTime: '2026-06-10T13:42:15.000Z', durationSeconds: 15, cidName: '大廳接待', cidNumber: '9505', extension: '9505', channelName: 'PJSIP/9505-00000005', eventCount: 4, direction: 'internal' },
  { linkedId: '1686900010.1006', eventTime: '2026-06-10T12:30:22.000Z', endTime: '2026-06-10T12:35:50.000Z', durationSeconds: 328, cidName: '', cidNumber: '0912345678', extension: '9503', channelName: 'PJSIP/9503-00000006', eventCount: 12, direction: 'inbound' },
  { linkedId: '1686900010.1007', eventTime: '2026-06-10T11:15:08.000Z', endTime: '2026-06-10T11:16:30.000Z', durationSeconds: 82, cidName: '訪客9520-測試', cidNumber: '9520', extension: '9506', channelName: 'PJSIP/9520-00000007', eventCount: 6, direction: 'outbound' },
  { linkedId: '1686900010.1008', eventTime: '2026-06-10T10:05:44.000Z', endTime: '2026-06-10T10:06:10.000Z', durationSeconds: 26, cidName: '訪客9503', cidNumber: '9503', extension: '9508', channelName: 'PJSIP/9503-00000008', eventCount: 4, direction: 'internal' },
  { linkedId: '1686900010.1009', eventTime: '2026-06-09T16:40:18.000Z', endTime: '2026-06-09T16:44:55.000Z', durationSeconds: 277, cidName: '', cidNumber: '0312345678', extension: '9507', channelName: 'PJSIP/9507-00000009', eventCount: 14, direction: 'inbound' },
  { linkedId: '1686900010.1010', eventTime: '2026-06-09T15:20:05.000Z', endTime: '2026-06-09T15:21:00.000Z', durationSeconds: 55, cidName: '訪客9504', cidNumber: '9504', extension: '10001', channelName: 'PJSIP/9504-00000010', eventCount: 5, direction: 'outbound' },
  { linkedId: '1686900010.1011', eventTime: '2026-06-09T14:10:30.000Z', endTime: '2026-06-09T14:11:00.000Z', durationSeconds: 30, cidName: '訪客9510', cidNumber: '9510', extension: '9509', channelName: 'PJSIP/9510-00000011', eventCount: 3, direction: 'internal' },
  { linkedId: '1686900010.1012', eventTime: '2026-06-09T11:55:42.000Z', endTime: '2026-06-09T12:02:18.000Z', durationSeconds: 396, cidName: '', cidNumber: '0412345678', extension: '9503', channelName: 'PJSIP/9503-00000012', eventCount: 18, direction: 'inbound' },
];

const statusBadge = (s) => {
  const map = {
    online: { bg: '#065f46', color: '#6ee7b7', text: '在線' },
    offline: { bg: '#1e293b', color: '#9ca3af', text: '離線' },
    unknown: { bg: '#1f2937', color: '#6b7280', text: '未知' },
    not_found: { bg: '#1f2937', color: '#6b7280', text: '不存在' },
  };
  const style = map[s] || map.unknown;
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 500, background: style.bg, color: style.color }}>{style.text}</span>;
};

const pageSizeOptions = [10, 20, 50, '全部'];

function formatTime(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'); }
  catch { return '-'; }
}

const MOCK_SIP_ACCOUNTS = [
  { id: 1, username: '100005', displayName: 'scott', domain: 'sip.qrtalkie.org', tenantName: '太域科技', communityName: '', buildingName: '', roomNumber: '', status: 'online', registered: true, contactsCount: 2, lastRegisterAt: '2026-06-11T10:30:00Z', expiresAt: '2026-06-11T10:35:00Z', ttlSeconds: 240, accountStatus: 'active', syncStatus: 'active' },
  { id: 2, username: '100006', displayName: 'pad', domain: 'sip.qrtalkie.org', tenantName: '', communityName: '', buildingName: '', roomNumber: '', status: 'offline', registered: false, contactsCount: 0, lastRegisterAt: '2026-06-10T08:15:00Z', expiresAt: null, ttlSeconds: 0, accountStatus: 'active', syncStatus: 'active' },
  { id: 3, username: '100003', displayName: 'Jacklin03', domain: 'sip.qrtalkie.org', tenantName: '', communityName: '', buildingName: '', roomNumber: '', status: 'online', registered: true, contactsCount: 1, lastRegisterAt: '2026-06-11T11:00:00Z', expiresAt: '2026-06-11T11:05:00Z', ttlSeconds: 280, accountStatus: 'active', syncStatus: 'active' },
  { id: 4, username: '1000001', displayName: 'jack01', domain: 'sip.qrtalkie.org', tenantName: '太域科技', communityName: '翡翠灣社區', buildingName: 'A棟', roomNumber: '101', status: 'online', registered: true, contactsCount: 3, lastRegisterAt: '2026-06-11T10:45:00Z', expiresAt: '2026-06-11T10:50:00Z', ttlSeconds: 200, accountStatus: 'active', syncStatus: 'active' },
  { id: 5, username: '1000002', displayName: 'jack02', domain: 'sip.qrtalkie.org', tenantName: '太域科技', communityName: '翡翠灣社區', buildingName: 'B棟', roomNumber: '202', status: 'offline', registered: false, contactsCount: 0, lastRegisterAt: null, expiresAt: null, ttlSeconds: 0, accountStatus: 'active', syncStatus: 'active' },
  { id: 6, username: '100010', displayName: '訪客A', domain: 'sip.qrtalkie.org', tenantName: '', communityName: '', buildingName: '', roomNumber: '', status: 'unknown', registered: false, contactsCount: 0, lastRegisterAt: null, expiresAt: null, ttlSeconds: 0, accountStatus: 'inactive', syncStatus: 'local_only' },
  { id: 7, username: '100011', displayName: '大廳', domain: 'sip.qrtalkie.org', tenantName: '未來社區物業管理有限公司', communityName: '陽光花園', buildingName: 'C棟', roomNumber: '301', status: 'online', registered: true, contactsCount: 5, lastRegisterAt: '2026-06-11T11:15:00Z', expiresAt: '2026-06-11T11:20:00Z', ttlSeconds: 310, accountStatus: 'active', syncStatus: 'active' },
  { id: 8, username: '100012', displayName: '訪客B', domain: 'sip.qrtalkie.org', tenantName: '', communityName: '', buildingName: '', roomNumber: '', status: 'offline', registered: false, contactsCount: 0, lastRegisterAt: null, expiresAt: null, ttlSeconds: 0, accountStatus: 'active', syncStatus: 'active' },
  { id: 9, username: '100013', displayName: '接待處', domain: 'sip.qrtalkie.org', tenantName: '太域科技', communityName: '', buildingName: '', roomNumber: '', status: 'online', registered: true, contactsCount: 1, lastRegisterAt: '2026-06-11T10:50:00Z', expiresAt: '2026-06-11T10:55:00Z', ttlSeconds: 150, accountStatus: 'active', syncStatus: 'active' },
  { id: 10, username: '123456', displayName: 'test', domain: 'sip.qrtalkie.org', tenantName: '', communityName: '', buildingName: '', roomNumber: '', status: 'unknown', registered: false, contactsCount: 0, lastRegisterAt: null, expiresAt: null, ttlSeconds: 0, accountStatus: 'active', syncStatus: 'local_only' },
];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('web');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assignFilter, setAssignFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Call log state
  const [callSearch, setCallSearch] = useState('');
  const [callDateFrom, setCallDateFrom] = useState('');
  const [callDateTo, setCallDateTo] = useState('');
  const [callPage, setCallPage] = useState(1);
  const [callPageSize, setCallPageSize] = useState(10);
  const [callExtension, setCallExtension] = useState('');
  const [expandedCall, setExpandedCall] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [callLogTotal, setCallLogTotal] = useState(0);
  const [isCallLogLoading, setIsCallLogLoading] = useState(false);

  // SIP call log state
  const [sipCallLogs, setSipCallLogs] = useState([]);
  const [sipCallLogTotal, setSipCallLogTotal] = useState(0);
  const [isSipCallLogLoading, setIsSipCallLogLoading] = useState(false);
  const [sipCallAccount, setSipCallAccount] = useState('');
  const [sipCallDirection, setSipCallDirection] = useState('all');
  const [sipCallResult, setSipCallResult] = useState('all');
  const [sipCallDateFrom, setSipCallDateFrom] = useState('');
  const [sipCallDateTo, setSipCallDateTo] = useState('');
  const [sipCallPage, setSipCallPage] = useState(1);
  const [sipCallPageSize, setSipCallPageSize] = useState(10);
  const [sipCallExpanded, setSipCallExpanded] = useState(null);
  const [sipCallDateRange, setSipCallDateRange] = useState(null);
  // SIP state
  const [sipSearch, setSipSearch] = useState('');
  const [sipStatusFilter, setSipStatusFilter] = useState('all');
  const [sipTenantFilter, setSipTenantFilter] = useState('all');
  const [sipPage, setSipPage] = useState(1);
  const [sipPageSize, setSipPageSize] = useState(10);
  const [sipData, setSipData] = useState([]);
  const [sipStats, setSipStats] = useState({ total: 0, online: 0, offline: 0, unknown: 0 });
  const [isSipLoading, setIsSipLoading] = useState(true);
  const [isSipRefreshing, setIsSipRefreshing] = useState(false);
  const [sipLastFetchAt, setSipLastFetchAt] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiClient.get('/admin/web-accounts');
      const list = Array.isArray(res.accounts) ? res.accounts : [];
      setAccounts(list);
      return list;
    } catch { return []; }
  }, []);

  const fetchStatuses = useCallback(async (accList, silent) => {
    const exts = accList.map(a => a.username).filter(e => /^\d+$/.test(e));
    if (!exts.length) return;
    try {
      const statusRes = await apiClient.get(`/pbx/webrtc-accounts/status?extensions=${exts.join(',')}`);
      const items = statusRes.data?.items || [];
      const map = {};
      for (const it of items) { map[it.extension] = it; }

      // Batch presence for lastSeenAt
      try {
        const presRes = await apiClient.get(`/pbx/webrtc-accounts/presence?extensions=${exts.join(',')}`);
        const presItems = presRes.data?.items || presRes?.data?.items || [];
        for (const p of presItems) {
          if (map[p.extension]) {
            map[p.extension].lastSeenAt = p.lastSeenAt || null;
            map[p.extension].onlineAt = p.onlineAt || null;
            map[p.extension].presenceStatus = p.status;
          }
        }
      } catch {}
      setStatusMap(map);
    } catch {}
  }, []);

  const loadData = useCallback(async (silent) => {
    if (!silent) setIsLoading(true); else setIsRefreshing(true);
    const accList = await fetchAccounts();
    await fetchStatuses(accList, silent);
    setLastFetchAt(new Date().toISOString());
    setIsLoading(false);
    setIsRefreshing(false);
  }, [fetchAccounts, fetchStatuses]);

  // Initial load
  useEffect(() => { loadData(false); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(() => loadData(true), 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  // SIP data
  const loadSipData = useCallback(async (silent) => {
    if (!silent) setIsSipLoading(true); else setIsSipRefreshing(true);
    try {
      let allItems = [];
      let total = 0;
      let offset = 0;
      const limit = 100;
      // 分页加载全部数据
      while (true) {
        const res = await apiClient.get(`/flexisip/accounts/registration-status?limit=${limit}&offset=${offset}`);
        const items = res.data?.items || [];
        total = res.data?.total || 0;
        allItems = allItems.concat(items);
        offset += limit;
        if (offset >= total) break;
      }
      setSipData(allItems);
      const online = allItems.filter(i => i.status === 'online').length;
      const offline = allItems.filter(i => i.status === 'offline').length;
      setSipStats({ total: allItems.length, online, offline, unknown: allItems.length - online - offline });
      setSipLastFetchAt(new Date().toISOString());
    } catch { setSipData([]); }
    finally { setIsSipLoading(false); setIsSipRefreshing(false); }
  }, []);

  useEffect(() => {
    if (activeTab !== 'sipCallLog') return;
    (async () => {
      try {
        const res = await apiClient.get('/flexisip/call-logs/date-range');
        setSipCallDateRange(res?.data || null);
      } catch { setSipCallDateRange(null); }
    })();
  }, [activeTab]);

  useEffect(() => { loadSipData(false); }, [loadSipData]);

  const data = useMemo(() => {
    return accounts.map(acc => {
      const st = statusMap[acc.username] || {};
      return {
        id: acc.id,
        extension: acc.username,
        displayName: acc.displayName || '',
        sipAccount: `${acc.username}@${acc.domain || 'pbx.qrtalkie.org'}`,
        tenantName: acc.tenantName || null,
        assigned: Boolean(acc.tenantName),
        status: st.status || st.presenceStatus || 'unknown',
        statusText: st.statusText || '未知',
        transport: st.transport || '-',
        channelCount: typeof st.channelCount === 'number' ? st.channelCount : 0,
        lastSeen: st.lastSeenAt || st.lastSeen || null,
      };
    });
  }, [accounts, statusMap]);

  const filtered = useMemo(() => {
    let list = data;
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      list = list.filter(a => a.extension.includes(kw) || a.displayName.toLowerCase().includes(kw));
    }
    if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter);
    if (assignFilter !== 'all') list = list.filter(a => assignFilter === 'assigned' ? a.assigned : !a.assigned);
    return list;
  }, [data, searchKeyword, statusFilter, assignFilter]);

  const effectivePageSize = pageSize === '全部' ? filtered.length : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);

  const stats = useMemo(() => ({
    total: data.length,
    online: data.filter(a => a.status === 'online').length,
    offline: data.filter(a => a.status === 'offline').length,
    unknown: data.filter(a => !['online', 'offline'].includes(a.status)).length,
  }), [data]);

  return (
    <section className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      {/* Tab 栏 */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f2937', background: '#111827', padding: '0 24px' }}>
        <div style={{ display: 'flex' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setCurrentPage(1); setSearchKeyword(''); setStatusFilter('all'); setAssignFilter('all'); }}
              style={{
                padding: '14px 24px', fontSize: '14px', fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? '#60a5fa' : '#9ca3af', border: 'none', background: 'none',
                borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent', cursor: 'pointer',
              }}>
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {activeTab === 'web' && lastFetchAt && <span style={{ fontSize: '11px', color: '#6b7280' }}>更新於 {formatTime(lastFetchAt)}</span>}
          {activeTab === 'sip' && sipLastFetchAt && <span style={{ fontSize: '11px', color: '#6b7280' }}>更新於 {formatTime(sipLastFetchAt)}</span>}
          {(activeTab === 'web' || activeTab === 'sip') && (
          <button onClick={() => activeTab === 'web' ? loadData(true) : loadSipData(true)} title="手動刷新"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '6px', background: '#1f2937', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px', cursor: 'pointer' }}>
            <RefreshCw size={14} style={{ animation: activeTab === 'web' ? (isRefreshing ? 'spin 1s linear infinite' : 'none') : (isSipRefreshing ? 'spin 1s linear infinite' : 'none') }} />
            刷新
          </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      {activeTab === 'web' && (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0, overflow: 'hidden' }}>
        {/* 工具栏 */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 20px', marginBottom: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 1 auto', minWidth: 0 }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="search" placeholder="搜尋分機號或顯示名稱" value={searchKeyword} onChange={e => { setSearchKeyword(e.target.value); setCurrentPage(1); }}
                style={{ width: '100%', height: '40px', padding: '0 14px 0 38px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
            </div>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
              <option value="all">全部狀態</option>
              <option value="online">在線</option>
              <option value="offline">離線</option>
              <option value="unknown">未知</option>
            </select>
            <select value={assignFilter} onChange={e => { setAssignFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
              <option value="all">全部</option>
              <option value="assigned">已分配</option>
              <option value="unassigned">未分配</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>全部 <strong style={{ color: '#e5e7eb' }}>{stats.total}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#065f46', border: '1px solid #059669', color: '#6ee7b7', fontSize: '12px' }}>在線 <strong>{stats.online}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>離線 <strong style={{ color: '#e5e7eb' }}>{stats.offline}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1f2937', border: '1px solid #374151', color: '#6b7280', fontSize: '12px' }}>未知 <strong>{stats.unknown}</strong></span>
          </div>
        </div>

        {/* 列表 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f2937 transparent', msOverflowStyle: 'none' }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#9ca3af' }}>載入中...</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#6b7280' }}>暫無數據</div>
            ) : (
              <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#1e293b' }}>
                    <th style={{ width: '40px', padding: '12px 0', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}><input type="checkbox" style={{ cursor: 'pointer', accentColor: '#3b82f6' }} /></th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>Web 帳號</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>顯示名稱</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>SIP 帳號</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>租戶名稱</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>狀態</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>傳輸</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>頻道數</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>最後上線</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #1f2937' }}>
                      <td style={{ padding: '12px 0', textAlign: 'center', background: '#111827' }}>
                        <input type="checkbox" style={{ cursor: 'pointer', accentColor: '#3b82f6' }} />
                      </td>
                      <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace', fontWeight: 500 }}>{row.extension}</td>
                      <td style={{ padding: '12px 16px', color: '#d1d5db' }}>{row.displayName}</td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px', fontFamily: 'monospace' }}>{row.sipAccount}</td>
                      <td style={{ padding: '12px 16px', color: '#d1d5db', fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.tenantName || '未分配'}>
                        {row.tenantName || '未分配'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>{statusBadge(row.status)}</td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px', fontFamily: 'monospace' }}>{row.transport}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 500 }}>{row.channelCount}</td>
                      <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{formatTime(row.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 分页 */}
          <div style={{ flexShrink: 0, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1f2937', background: '#111827' }}>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>共 {filtered.length} 筆記錄</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select value={pageSize} onChange={e => { setPageSize(e.target.value === '全部' ? '全部' : Number(e.target.value)); setCurrentPage(1); }}
                style={{ height: '34px', padding: '0 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
                {pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === '全部' ? '全部' : `${opt} 條/頁`}</option>)}
              </select>
              <button disabled={safePage <= 1} onClick={() => setCurrentPage(p => p - 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage <= 1 ? '#4b5563' : '#9ca3af', cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <span style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#1e3a5f', color: '#60a5fa', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{safePage}</span>
              <button disabled={safePage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage >= totalPages ? '#4b5563' : '#9ca3af', cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            </div>
          </div>
        </div>
      </div>
      )}
      {/* SIP 帳號狀態 Tab */}
      {activeTab === 'sip' && <SipAccountTable data={sipData} stats={sipStats} isLoading={isSipLoading} search={sipSearch} statusFilter={sipStatusFilter} tenantFilter={sipTenantFilter}
        onSearchChange={v => { setSipSearch(v); setSipPage(1); }} onStatusChange={v => { setSipStatusFilter(v); setSipPage(1); }} onTenantChange={v => { setSipTenantFilter(v); setSipPage(1); }}
        page={sipPage} pageSize={sipPageSize} onPageChange={setSipPage} onPageSizeChange={v => { setSipPageSize(v); setSipPage(1); }} />}
      {/* Web 呼叫日誌 Tab */}
      {activeTab === 'callLog' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 20px', marginBottom: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', flexWrap: 'wrap' }}>
            <select value={callExtension} onChange={e => { setCallExtension(e.target.value); setCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer', minWidth: '130px' }}>
              <option value="">選擇分機號</option>
              {accounts.filter(a => /^\d+$/.test(a.username)).map(a => (
                <option key={a.id} value={a.username}>{a.username} {a.displayName ? `(${a.displayName})` : ''}</option>
              ))}
            </select>
            <div style={{ position: 'relative', width: '200px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="search" placeholder="搜尋主叫/被叫號碼" value={callSearch} onChange={e => { setCallSearch(e.target.value); setCallPage(1); }}
                style={{ width: '100%', height: '40px', padding: '0 14px 0 38px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
            </div>
            <input type="date" value={callDateFrom} onChange={e => { setCallDateFrom(e.target.value); setCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
            <span style={{ color: '#6b7280', fontSize: '13px' }}>至</span>
            <input type="date" value={callDateTo} onChange={e => { setCallDateTo(e.target.value); setCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
          </div>
          <CallLogTable logs={callLogs} total={callLogTotal} search={callSearch} dateFrom={callDateFrom} dateTo={callDateTo}
            page={callPage} pageSize={callPageSize} onPageChange={setCallPage} onPageSizeChange={v => { setCallPageSize(v); setCallPage(1); }}
            expandedCall={expandedCall} onToggleExpand={setExpandedCall} isLoading={isCallLogLoading}
            extension={callExtension} onFetch={async (ext, params) => {
              setIsCallLogLoading(true);
              try {
                const qs = new URLSearchParams(params).toString();
                const res = await apiClient.get(`/pbx/webrtc-accounts/${ext}/call-logs?${qs}`);
                setCallLogs(res.data?.calls || []);
                setCallLogTotal(res.data?.total || 0);
              } catch { setCallLogs([]); setCallLogTotal(0); }
              finally { setIsCallLogLoading(false); }
            }} />
        </div>
      )}
      {/* SIP 呼叫日誌 Tab */}
      {activeTab === 'sipCallLog' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 20px', marginBottom: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', flexWrap: 'wrap' }}>
            <select value={sipCallAccount} onChange={e => { setSipCallAccount(e.target.value); setSipCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer', minWidth: '130px' }}>
              <option value="">全部帳號</option>
              {accounts.filter(a => /^\d+$/.test(a.username)).map(a => (
                <option key={a.id} value={a.username}>{a.username}</option>
              ))}
            </select>
            <select value={sipCallDirection} onChange={e => { setSipCallDirection(e.target.value); setSipCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
              <option value="all">全部方向</option>
              <option value="inbound">呼入</option>
              <option value="outbound">呼出</option>
              <option value="internal">內部</option>
            </select>
            <select value={sipCallResult} onChange={e => { setSipCallResult(e.target.value); setSipCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
              <option value="all">全部結果</option>
              <option value="answered">已接聽</option>
              <option value="missed">未接</option>
              <option value="cancelled">已取消</option>
              <option value="busy">忙線</option>
              <option value="declined">拒絕</option>
              <option value="timeout">超時</option>
              <option value="failed">失敗</option>
            </select>
            <input type="date" value={sipCallDateFrom} onChange={e => { setSipCallDateFrom(e.target.value); setSipCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
            <span style={{ color: '#6b7280', fontSize: '13px' }}>至</span>
            <input type="date" value={sipCallDateTo} onChange={e => { setSipCallDateTo(e.target.value); setSipCallPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
          </div>
          {sipCallDateRange && (sipCallDateRange.earliest || sipCallDateRange.latest) && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', marginBottom: '12px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px', color: '#9ca3af' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              <span>目前保存的呼叫記錄範圍：</span>
              {sipCallDateRange.earliest ? <span style={{ color: '#e5e7eb', fontWeight: 500 }}>{new Date(sipCallDateRange.earliest).toLocaleDateString('zh-CN')}</span> : <span style={{ color: '#6b7280' }}>無數據</span>}
              <span style={{ color: '#6b7280' }}>至</span>
              {sipCallDateRange.latest ? <span style={{ color: '#e5e7eb', fontWeight: 500 }}>{new Date(sipCallDateRange.latest).toLocaleDateString('zh-CN')}</span> : <span style={{ color: '#6b7280' }}>無數據</span>}
            </div>
          )}
          <FlexisipCallLogTable logs={sipCallLogs} total={sipCallLogTotal} account={sipCallAccount} direction={sipCallDirection}
            result={sipCallResult} dateFrom={sipCallDateFrom} dateTo={sipCallDateTo}
            page={sipCallPage} pageSize={sipCallPageSize} onPageChange={setSipCallPage} onPageSizeChange={v => { setSipCallPageSize(v); setSipCallPage(1); }}
            expandedCall={sipCallExpanded} onToggleExpand={setSipCallExpanded} isLoading={isSipCallLogLoading}
            onFetch={async (params) => {
              setIsSipCallLogLoading(true);
              try {
                const qs = new URLSearchParams(params).toString();
                const res = await apiClient.get(`/flexisip/call-logs?${qs}`);
                setSipCallLogs(res.data?.items || []);
                setSipCallLogTotal(res.data?.total || 0);
              } catch { setSipCallLogs([]); setSipCallLogTotal(0); }
              finally { setIsSipCallLogLoading(false); }
            }} />
        </div>
      )}
      {/* Spin animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
      `}</style>
    </section>
  );
}

// SIP Account Status Table
function SipAccountTable({ data, stats, isLoading, search, statusFilter, tenantFilter, onSearchChange, onStatusChange, onTenantChange, page, pageSize, onPageChange, onPageSizeChange }) {
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [sortField, setSortField] = useState('username');
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    let list = data;
    if (search) {
      const kw = search.toLowerCase();
      list = list.filter(a => (a.username || '').includes(kw) || (a.displayName || '').toLowerCase().includes(kw));
    }
    if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter);
    if (tenantFilter !== 'all') list = list.filter(a => tenantFilter === 'assigned' ? a.tenantName : !a.tenantName);
    return list;
  }, [data, search, statusFilter, tenantFilter]);

  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const type = typeof va;
      if (type === 'number') return (va - (vb || 0)) * dir;
      return String(va).localeCompare(String(vb || ''), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const statsData = stats;
  const totalPages = Math.max(1, Math.ceil(sorted.length / (pageSize === '全部' ? sorted.length : pageSize)));
  const effectiveSize = pageSize === '全部' ? sorted.length : Number(pageSize);
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * effectiveSize, safePage * effectiveSize);

  const formatShort = (iso) => { if (!iso) return '-'; try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'); } catch { return '-'; } };

  const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const thSortable = (field, label, align, extraStyle = {}) => (
    <th onClick={() => handleSort(field)}
      style={{ padding: '12px 16px', textAlign: align, color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', ...extraStyle }}>
      {label}<span style={{ color: sortField === field ? '#60a5fa' : '#4b5563', marginLeft: '4px' }}>{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
    </th>
  );

  const handleDetailClick = async (row) => {
    setDetailModalOpen(true);
    setDetailData(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const res = await apiClient.get(`/flexisip/accounts/registration-detail?username=${encodeURIComponent(row.username)}&domain=${encodeURIComponent(row.domain)}`);
      if (res?.data) {
        setDetailData(res.data);
      } else {
        setDetailError(res?.message || '數據為空');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.statusText || err?.message || '請求失敗';
      setDetailError(String(msg));
    }
    finally { setDetailLoading(false); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0, overflow: 'hidden' }}>
      {/* 工具栏 */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 20px', marginBottom: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '200px' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder="搜尋帳號或顯示名稱" value={search} onChange={e => onSearchChange(e.target.value)}
              style={{ width: '100%', height: '40px', padding: '0 14px 0 38px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
          </div>
          <select value={statusFilter} onChange={e => onStatusChange(e.target.value)}
            style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
            <option value="all">全部狀態</option>
            <option value="online">在線</option>
            <option value="offline">離線</option>
            <option value="unknown">未知</option>
          </select>
          <select value={tenantFilter} onChange={e => onTenantChange(e.target.value)}
            style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
            <option value="all">全部</option>
            <option value="assigned">已分配</option>
            <option value="unassigned">未分配</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>全部 <strong style={{ color: '#e5e7eb' }}>{statsData.total}</strong></span>
          <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#065f46', border: '1px solid #059669', color: '#6ee7b7', fontSize: '12px' }}>在線 <strong>{statsData.online}</strong></span>
          <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>離線 <strong style={{ color: '#e5e7eb' }}>{statsData.offline}</strong></span>
          <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1f2937', border: '1px solid #374151', color: '#6b7280', fontSize: '12px' }}>未知 <strong>{statsData.unknown}</strong></span>
        </div>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f2937 transparent' }}>
          <table style={{ width: '100%', minWidth: '960px', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                {thSortable('username', '帳號', 'left')}
                {thSortable('displayName', '顯示名稱', 'left')}
                {thSortable('domain', 'Domain', 'left')}
                {thSortable('tenantName', '租戶', 'left')}
                {thSortable('status', '註冊狀態', 'center')}
                {thSortable('contactsCount', '連線數', 'center')}
                {thSortable('lastRegisterAt', '最後註冊', 'left')}
                {thSortable('expiresAt', '過期日期', 'left')}
                <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, right: 0, zIndex: 3, whiteSpace: 'nowrap', boxShadow: '-4px 0 8px rgba(0,0,0,0.3)' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan="9" style={{ padding: '60px', textAlign: 'center', color: '#9ca3af' }}>載入中...</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan="9" style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>暫無數據</td></tr>
              ) : paginated.map(row => (
                <tr key={row.id} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace', fontWeight: 500 }}>{row.username}</td>
                  <td style={{ padding: '12px 16px', color: '#d1d5db' }}>{row.displayName}</td>
                  <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{row.domain}</td>
                  <td style={{ padding: '12px 16px', color: '#d1d5db', fontSize: '12px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.tenantName || '未分配'}>{row.tenantName || '未分配'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>{statusBadge(row.status)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 500 }}>{row.contactsCount}</td>
                  <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{formatShort(row.lastRegisterAt)}</td>
                  <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{formatShort(row.expiresAt)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', background: 'inherit', position: 'sticky', right: 0, zIndex: 1, boxShadow: '-4px 0 8px rgba(0,0,0,0.3)' }}>
                    <button onClick={() => handleDetailClick(row)}
                      style={{ padding: '5px 14px', borderRadius: '6px', border: '1px solid #374151', background: '#1e293b', color: '#60a5fa', fontSize: '12px', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      詳情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div style={{ flexShrink: 0, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1f2937', background: '#111827' }}>
          <span style={{ color: '#9ca3af', fontSize: '12px' }}>共 {filtered.length} 筆記錄</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select value={pageSize} onChange={e => onPageSizeChange(e.target.value === '全部' ? '全部' : Number(e.target.value))}
              style={{ height: '34px', padding: '0 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
              {[10, 20, 50, '全部'].map(o => <option key={o} value={o}>{o === '全部' ? o : `${o} 條/頁`}</option>)}
            </select>
            <button disabled={safePage <= 1} onClick={() => onPageChange(p => p - 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage <= 1 ? '#4b5563' : '#9ca3af', cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            <span style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#1e3a5f', color: '#60a5fa', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{safePage}</span>
            <button disabled={safePage >= totalPages} onClick={() => onPageChange(p => p + 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage >= totalPages ? '#4b5563' : '#9ca3af', cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          </div>
        </div>
      </div>

      {/* 註冊詳情彈窗 */}
      {detailModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => { setDetailModalOpen(false); setDetailData(null); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', width: '90vw', maxWidth: '720px', maxHeight: '85vh', background: '#111827', border: '1px solid #1f2937', borderRadius: '14px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #1f2937' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#e5e7eb', fontWeight: 700 }}>SIP 帳號註冊詳情</h2>
              <button onClick={() => { setDetailModalOpen(false); setDetailData(null); }}
                style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '24px', scrollbarWidth: 'thin', scrollbarColor: '#1f2937 transparent' }}>
              {detailLoading ? (
                <p style={{ color: '#9ca3af', textAlign: 'center', padding: '40px' }}>載入中...</p>
              ) : detailError ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p style={{ color: '#ef4444', marginBottom: '8px' }}>數據載入失敗</p>
                  <p style={{ color: '#9ca3af', fontSize: '12px' }}>{detailError}</p>
                </div>
              ) : !detailData ? (
                <p style={{ color: '#ef4444', textAlign: 'center', padding: '40px' }}>數據載入失敗</p>
              ) : (
                <>
                  <div style={{ marginBottom: '24px' }}>
                    <h3 style={{ margin: '0 0 14px 0', fontSize: '14px', color: '#e5e7eb', fontWeight: 600, borderBottom: '1px solid #1f2937', paddingBottom: '10px' }}>基本資訊</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                      {[
                        { label: '帳號', value: detailData.username },
                        { label: 'Domain', value: detailData.domain },
                        { label: 'AOR', value: detailData.aor },
                        { label: '註冊狀態', value: detailData.status === 'online' ? '🟢 在線' : detailData.status === 'offline' ? '🔴 離線' : '⚪ 未知' },
                        { label: 'Key 類型', value: detailData.keyType },
                        { label: 'TTL (秒)', value: String(detailData.ttl) },
                        { label: '總 Contact 數', value: String(detailData.totalContacts) },
                        { label: '有效 Contact 數', value: String(detailData.validContacts) },
                        { label: '最後註冊時間', value: detailData.lastRegisterAt ? new Date(detailData.lastRegisterAt).toLocaleString('zh-CN', { hour12: false }) : '-' },
                        { label: '註冊過期時間', value: detailData.expiresAt ? new Date(detailData.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '-' },
                      ].map((item, i) => (
                        <div key={i} style={{ background: '#1a2332', borderRadius: '8px', padding: '10px 14px', border: '1px solid #1f2937' }}>
                          <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '4px' }}>{item.label}</div>
                          <div style={{ color: '#e5e7eb', fontSize: '13px', fontWeight: 500, wordBreak: 'break-all' }}>{item.value || '-'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {detailData.warnings && detailData.warnings.length > 0 && (
                    <div style={{ marginBottom: '24px', padding: '12px 16px', background: '#1a1a0a', border: '1px solid #fbbf24', borderRadius: '8px' }}>
                      <div style={{ color: '#fbbf24', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>解析警告</div>
                      {detailData.warnings.map((w, i) => (
                        <div key={i} style={{ color: '#fcd34d', fontSize: '12px' }}>{w.code}: {w.message}</div>
                      ))}
                    </div>
                  )}

                  <div>
                    <h3 style={{ margin: '0 0 14px 0', fontSize: '14px', color: '#e5e7eb', fontWeight: 600, borderBottom: '1px solid #1f2937', paddingBottom: '10px' }}>設備 Contact 列表 ({detailData.parsedContacts?.length || 0})</h3>
                    {!detailData.parsedContacts || detailData.parsedContacts.length === 0 ? (
                      <p style={{ color: '#6b7280', fontSize: '13px', padding: '20px', textAlign: 'center' }}>暫無 Contact 數據</p>
                    ) : (
                      detailData.parsedContacts.map((contact, i) => (
                        <div key={i} style={{ marginBottom: '16px', padding: '16px', background: '#1a2332', border: `1px solid ${contact.valid ? '#065f46' : '#374151'}`, borderRadius: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <span style={{ padding: '2px 10px', borderRadius: '999px', background: contact.valid ? '#065f46' : '#374151', color: contact.valid ? '#6ee7b7' : '#9ca3af', fontSize: '11px', fontWeight: 600 }}>設備 #{i + 1}</span>
                            <span style={{ padding: '2px 10px', borderRadius: '999px', background: '#1f2937', color: '#9ca3af', fontSize: '11px' }}>{contact.valid ? '有效' : '已過期'}</span>
                            {contact.alias && <span style={{ padding: '2px 10px', borderRadius: '999px', background: '#1e3a5f', color: '#60a5fa', fontSize: '11px' }}>別名</span>}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                            {[
                              { label: '設備 ID (脫敏)', value: contact.uniqueId },
                              { label: 'Contact URI', value: contact.contactUri, full: true },
                              { label: '傳輸協議', value: contact.transport },
                              { label: 'User-Agent', value: contact.userAgent },
                              { label: '最後註冊時間', value: contact.lastRegisterAt ? new Date(contact.lastRegisterAt).toLocaleString('zh-CN', { hour12: false }) : '-' },
                              { label: '過期時間', value: contact.expiresAt ? new Date(contact.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '-' },
                              { label: '剩餘 TTL (秒)', value: String(contact.ttlSeconds) },
                              { label: '註冊 IP', value: contact.ip || '-', skip: !contact.ip },
                              { label: '國家/地區', value: contact.geo ? [contact.geo.country, contact.geo.subdivision].filter(Boolean).join(', ') || '-' : null, skip: !contact.geo },
                              { label: '城市', value: contact.geo?.city || null, skip: !contact.geo?.city },
                              { label: '經緯度', value: contact.geo?.latitude != null && contact.geo?.longitude != null ? `${contact.geo.latitude.toFixed(4)}, ${contact.geo.longitude.toFixed(4)}` : null, skip: !contact.geo?.latitude },
                              { label: '時區', value: contact.geo?.timezone || null, skip: !contact.geo?.timezone },
                              { label: 'Accept', value: (contact.accept || []).join(', ') || '-' },
                            ].filter(item => !item.skip).map((item, j) => (
                              <div key={j} style={{ ...(item.full ? { gridColumn: '1 / -1' } : {}), background: '#111827', borderRadius: '6px', padding: '8px 12px' }}>
                                <div style={{ color: '#6b7280', fontSize: '10px', marginBottom: '2px' }}>{item.label}</div>
                                <div style={{ color: '#d1d5db', fontSize: '12px', wordBreak: 'break-all' }}>{item.value || '-'}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {detailData.keyType !== 'hash' && detailData.rawEntries && detailData.rawEntries.length > 0 && (
                    <div style={{ marginTop: '24px' }}>
                      <h3 style={{ margin: '0 0 14px 0', fontSize: '14px', color: '#e5e7eb', fontWeight: 600, borderBottom: '1px solid #1f2937', paddingBottom: '10px' }}>原始 Field/Value</h3>
                      {detailData.rawEntries.map((entry, i) => (
                        <div key={i} style={{ marginBottom: '8px', padding: '10px 14px', background: '#1a2332', borderRadius: '6px', border: '1px solid #1f2937' }}>
                          <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '4px' }}>Field</div>
                          <div style={{ color: '#d1d5db', fontSize: '12px', wordBreak: 'break-all', marginBottom: '6px' }}>{entry.field}</div>
                          <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '4px' }}>Value</div>
                          <div style={{ color: '#9ca3af', fontSize: '11px', wordBreak: 'break-all' }}>{entry.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Flexisip SIP Call Log sub-component
function FlexisipCallLogTable({ logs, total, account, direction, result, dateFrom, dateTo, page, pageSize, onPageChange, onPageSizeChange, expandedCall, onToggleExpand, isLoading, onFetch }) {
  useEffect(() => {
    const params = { includeDevices: 'true', limit: String(pageSize), offset: String((page - 1) * pageSize) };
    if (account) params.accounts = account;
    if (direction !== 'all') params.direction = direction;
    if (result !== 'all') params.result = result;
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    onFetch(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, direction, result, dateFrom, dateTo, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const resultBadge = (r) => {
    const map = {
      answered: { bg: '#065f46', color: '#6ee7b7', text: '已接聽' },
      missed: { bg: '#7f1d1d', color: '#fca5a5', text: '未接' },
      cancelled: { bg: '#1e293b', color: '#9ca3af', text: '已取消' },
      busy: { bg: '#3b1111', color: '#fca5a5', text: '忙線' },
      declined: { bg: '#7f1d1d', color: '#fca5a5', text: '拒絕' },
      timeout: { bg: '#1f2937', color: '#6b7280', text: '超時' },
      failed: { bg: '#7f1d1d', color: '#fca5a5', text: '失敗' },
      unknown: { bg: '#1f2937', color: '#6b7280', text: '未知' },
    };
    const s = map[r] || {};
    return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.color }}>{s.text || r}</span>;
  };

  const directionBadge = (d) => {
    const map = { inbound: '呼入', outbound: '呼出', internal: '內部', unknown: '未知' };
    return map[d] || d;
  };

  const formatTime = (iso) => { try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'); } catch { return '-'; } };
  const formatDuration = (s) => { if (!s && s !== 0) return '-'; const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f2937 transparent' }}>
        <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>日期</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>主叫號碼</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>被叫號碼</th>
              <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>方向</th>
              <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>結果</th>
              <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>通話時長</th>
              <th style={{ width: '60px', padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>詳情</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="7" style={{ padding: '60px', textAlign: 'center', color: '#9ca3af' }}>載入中...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="7" style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>暫無數據</td></tr>
            ) : logs.map(row => (
              <React.Fragment key={row.id}>
                <tr style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '12px 16px', color: '#d1d5db', fontSize: '12px' }}>{formatTime(row.initiatedAt)}</td>
                  <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.fromUser || '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.toUser || '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#d1d5db', fontSize: '12px' }}>{directionBadge(row.direction)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>{resultBadge(row.result)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontFamily: 'monospace' }}>{formatDuration(row.estimatedDurationSeconds)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button onClick={() => onToggleExpand(expandedCall === row.id ? null : row.id)}
                      style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '13px' }}>
                      {expandedCall === row.id ? '收起' : '詳情'}
                    </button>
                  </td>
                </tr>
                {expandedCall === row.id && (
                  <tr><td colSpan="7" style={{ padding: 0, background: '#0f172a' }}>
                    <div style={{ padding: '12px 24px', borderBottom: '1px solid #1f2937', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: '12px', color: '#9ca3af' }}>
                      <span>主叫域：<span style={{ color: '#d1d5db' }}>{row.fromDomain || '—'}</span></span>
                      <span>被叫域：<span style={{ color: '#d1d5db' }}>{row.toDomain || '—'}</span></span>
                      <span>信令碼：<span style={{ color: row.finalCode ? '#fca5a5' : '#d1d5db' }}>{row.finalCode || '—'}</span></span>
                      <span>原因：<span style={{ color: '#d1d5db' }}>{row.finalReason || '—'}</span></span>
                      <span>結束時間：<span style={{ color: '#d1d5db' }}>{formatTime(row.endedAt)}</span></span>
                      <span>設備數：<span style={{ color: '#d1d5db' }}>{row.devicesCount}</span></span>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ flexShrink: 0, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1f2937', background: '#111827' }}>
        <span style={{ color: '#9ca3af', fontSize: '12px' }}>共 {total} 筆記錄</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select value={pageSize} onChange={e => onPageSizeChange(e.target.value === '全部' ? '全部' : Number(e.target.value))}
            style={{ height: '34px', padding: '0 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
            {[10, 20, 50, '全部'].map(o => <option key={o} value={o}>{o === '全部' ? o : `${o} 條/頁`}</option>)}
          </select>
          <button disabled={safePage <= 1} onClick={() => onPageChange(p => p - 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage <= 1 ? '#4b5563' : '#9ca3af', cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <span style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#1e3a5f', color: '#60a5fa', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{safePage}</span>
          <button disabled={safePage >= totalPages} onClick={() => onPageChange(p => p + 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage >= totalPages ? '#4b5563' : '#9ca3af', cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        </div>
      </div>
    </div>
  );
}

// Call Log sub-component
function CallLogTable({ logs, total, search, dateFrom, dateTo, page, pageSize, onPageChange, onPageSizeChange, expandedCall, onToggleExpand, isLoading, extension, onFetch }) {
  // Auto-fetch when extension is selected
  useEffect(() => {
    if (!extension) { onPageChange(1); return; }
    const params = {};
    if (search) { params.source = search; params.destination = search; }
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    params.limit = pageSize;
    params.offset = (page - 1) * pageSize;
    onFetch(extension, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension, page, pageSize, search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const formatTime = (iso) => { try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'); } catch { return '-'; } };
  const formatDuration = (s) => { if (!s && s !== 0) return '-'; const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f2937 transparent' }}>
        <table style={{ width: '100%', minWidth: '620px', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>日期</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>主叫號碼</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>被叫號碼</th>
              <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>通話時長</th>
              <th style={{ width: '60px', padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2 }}>詳情</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: '#9ca3af' }}>載入中...</td></tr>
            ) : !extension ? (
              <tr><td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>請選擇分機號以查詢通話記錄</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="5" style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>暫無數據</td></tr>
            ) : logs.map(row => (
              <React.Fragment key={row.linkedId}>
                <tr style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '12px 16px', color: '#d1d5db', fontSize: '12px' }}>{formatTime(row.eventTime)}</td>
                  <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace' }}>
                    {row.cidName ? <span>{row.cidName}<br/><span style={{ fontSize: '11px', color: '#9ca3af' }}>{row.cidNumber}</span></span> : (row.cidNumber || <span style={{ color: '#6b7280' }}>—</span>)}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.extension || '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontFamily: 'monospace' }}>{formatDuration(row.durationSeconds)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button onClick={() => onToggleExpand(expandedCall === row.linkedId ? null : row.linkedId)}
                      style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '13px' }}>
                      {expandedCall === row.linkedId ? '收起' : '詳情'}
                    </button>
                  </td>
                </tr>
                {expandedCall === row.linkedId && (
                  <tr><td colSpan="5" style={{ padding: 0, background: '#0f172a' }}>
                    <div style={{ padding: '12px 24px', borderBottom: '1px solid #1f2937', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 24px', fontSize: '12px', color: '#9ca3af' }}>
                      <span>開始：<span style={{ color: '#d1d5db' }}>{formatTime(row.eventTime)}</span></span>
                      <span>結束：<span style={{ color: '#d1d5db' }}>{formatTime(row.endTime)}</span></span>
                      <span>事件數：<span style={{ color: '#d1d5db' }}>{row.eventCount}</span></span>
                      <span>Linked ID：<span style={{ color: '#d1d5db', fontFamily: 'monospace', fontSize: '11px' }}>{row.linkedId}</span></span>
                      <span>通道：<span style={{ color: '#d1d5db', fontFamily: 'monospace', fontSize: '11px' }}>{row.channelName}</span></span>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ flexShrink: 0, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #1f2937', background: '#111827' }}>
        <span style={{ color: '#9ca3af', fontSize: '12px' }}>共 {total} 筆記錄</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select value={pageSize} onChange={e => onPageSizeChange(e.target.value === '全部' ? '全部' : Number(e.target.value))}
            style={{ height: '34px', padding: '0 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
            {[10, 20, 50, '全部'].map(o => <option key={o} value={o}>{o === '全部' ? o : `${o} 條/頁`}</option>)}
          </select>
          <button disabled={safePage <= 1} onClick={() => onPageChange(p => p - 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage <= 1 ? '#4b5563' : '#9ca3af', cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <span style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#1e3a5f', color: '#60a5fa', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{safePage}</span>
          <button disabled={safePage >= totalPages} onClick={() => onPageChange(p => p + 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage >= totalPages ? '#4b5563' : '#9ca3af', cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        </div>
      </div>
    </div>
  );
}
