import React, { useState, useMemo } from 'react';

const TABS = [
  { key: 'web', label: 'Web 帳號狀態' },
  { key: 'sip', label: 'SIP 帳號狀態' },
];

const MOCK_WEB_ACCOUNTS = [
  { id: 1, extension: '9503', displayName: '訪客9503', domain: 'pbx.qrtalkie.org', status: 'online', statusText: '在線', transport: '0.0.0.0-wss', channelCount: 2, lastSeen: '2026-06-10 14:22' },
  { id: 2, extension: '9504', displayName: '訪客9504', domain: 'pbx.qrtalkie.org', status: 'offline', statusText: '離線', transport: '0.0.0.0-wss', channelCount: 0, lastSeen: '2026-06-09 08:15' },
  { id: 3, extension: '9505', displayName: '大廳接待', domain: 'pbx.qrtalkie.org', status: 'online', statusText: '在線', transport: '0.0.0.0-wss', channelCount: 1, lastSeen: '2026-06-10 14:30' },
  { id: 4, extension: '9506', displayName: '訪客9506', domain: 'pbx.qrtalkie.org', status: 'offline', statusText: '離線', transport: '0.0.0.0-wss', channelCount: 0, lastSeen: '2026-06-08 19:45' },
  { id: 5, extension: '9507', displayName: '管理處', domain: 'pbx.qrtalkie.org', status: 'unreachable', statusText: '不可達', transport: '-', channelCount: 0, lastSeen: '-' },
  { id: 6, extension: '9508', displayName: '訪客9508', domain: 'pbx.qrtalkie.org', status: 'online', statusText: '在線', transport: '0.0.0.0-wss', channelCount: 3, lastSeen: '2026-06-10 14:28' },
  { id: 7, extension: '9509', displayName: '訪客9509', domain: 'pbx.qrtalkie.org', status: 'offline', statusText: '離線', transport: '0.0.0.0-wss', channelCount: 0, lastSeen: '2026-06-07 12:00' },
  { id: 8, extension: '9510', displayName: '訪客9510', domain: 'pbx.qrtalkie.org', status: 'not_found', statusText: '不存在', transport: '-', channelCount: 0, lastSeen: '-' },
  { id: 9, extension: '9520', displayName: '訪客9520-測試', domain: 'pbx.qrtalkie.org', status: 'online', statusText: '在線', transport: '0.0.0.0-wss', channelCount: 0, lastSeen: '2026-06-10 13:55' },
  { id: 10, extension: '9521', displayName: '訪客9521-測試', domain: 'pbx.qrtalkie.org', status: 'offline', statusText: '離線', transport: '0.0.0.0-wss', channelCount: 0, lastSeen: '2026-06-10 10:30' },
];

const MOCK_SIP_ACCOUNTS = [];

const statusBadge = (s) => {
  const map = {
    online: { bg: '#065f46', color: '#6ee7b7', text: '在線' },
    offline: { bg: '#1e293b', color: '#9ca3af', text: '離線' },
    unreachable: { bg: '#3b1111', color: '#fca5a5', text: '不可達' },
    not_found: { bg: '#1f2937', color: '#6b7280', text: '不存在' },
  };
  const style = map[s] || map.offline;
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 500, background: style.bg, color: style.color }}>{style.text}</span>;
};

const pageSizeOptions = [10, 20, 50, '全部'];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('web');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const data = activeTab === 'web' ? MOCK_WEB_ACCOUNTS : MOCK_SIP_ACCOUNTS;

  const filtered = useMemo(() => {
    let list = data;
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      list = list.filter(a => a.extension.includes(kw) || a.displayName.toLowerCase().includes(kw));
    }
    if (statusFilter !== 'all') {
      list = list.filter(a => a.status === statusFilter);
    }
    return list;
  }, [data, searchKeyword, statusFilter]);

  const effectivePageSize = pageSize === '全部' ? filtered.length : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);

  const stats = useMemo(() => {
    const total = data.length;
    const online = data.filter(a => a.status === 'online').length;
    const offline = data.filter(a => a.status === 'offline').length;
    const unreachable = data.filter(a => a.status === 'unreachable').length;
    const notFound = data.filter(a => a.status === 'not_found').length;
    return { total, online, offline, unreachable, notFound };
  }, [data]);

  return (
    <section className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      {/* Tab 栏 */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #1f2937', background: '#111827', padding: '0 24px' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setCurrentPage(1); setSearchKeyword(''); setStatusFilter('all'); }}
            style={{
              padding: '14px 24px', fontSize: '14px', fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#60a5fa' : '#9ca3af', border: 'none', background: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent', cursor: 'pointer',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0, overflow: 'hidden' }}>
        {/* 工具栏：搜索 + 筛选 + 统计 */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 20px', marginBottom: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 1 auto', minWidth: 0 }}>
            <div style={{ position: 'relative', width: '240px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="search" placeholder="搜尋分機號或顯示名稱" value={searchKeyword} onChange={e => { setSearchKeyword(e.target.value); setCurrentPage(1); }}
                style={{ width: '100%', height: '40px', padding: '0 14px 0 38px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' }} />
            </div>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
              <option value="all">全部狀態</option>
              <option value="online">在線</option>
              <option value="offline">離線</option>
              <option value="unreachable">不可達</option>
              <option value="not_found">不存在</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>全部 <strong style={{ color: '#e5e7eb' }}>{stats.total}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#065f46', border: '1px solid #059669', color: '#6ee7b7', fontSize: '12px' }}>在線 <strong>{stats.online}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px' }}>離線 <strong style={{ color: '#e5e7eb' }}>{stats.offline}</strong></span>
            <span style={{ padding: '4px 12px', borderRadius: '999px', background: '#7f1d1d', border: '1px solid #991b1b', color: '#fca5a5', fontSize: '12px' }}>不可達 <strong>{stats.unreachable}</strong></span>
          </div>
        </div>

        {/* 列表卡片 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <table style={{ width: '100%', minWidth: '840px', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#1e293b' }}>
                  <th style={{ width: '40px', padding: '12px 0', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" style={{ cursor: 'pointer', accentColor: '#3b82f6' }} />
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>分機號</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>顯示名稱</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>Domain</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>狀態</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>傳輸</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>頻道數</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#e5e7eb', fontWeight: 600, fontSize: '12px', borderBottom: '2px solid #2d3a4a', background: '#1e293b', position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap' }}>最後上線</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan="8" style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>暫無數據</td></tr>
                ) : paginated.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '12px 0', textAlign: 'center', background: '#111827' }}>
                      <input type="checkbox" style={{ cursor: 'pointer', accentColor: '#3b82f6' }} />
                    </td>
                    <td style={{ padding: '12px 16px', color: '#e5e7eb', fontFamily: 'monospace', fontWeight: 500 }}>{row.extension}</td>
                    <td style={{ padding: '12px 16px', color: '#d1d5db' }}>{row.displayName}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{row.domain}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>{statusBadge(row.status)}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px', fontFamily: 'monospace' }}>{row.transport}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: '#e5e7eb', fontWeight: 500 }}>{row.channelCount}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '12px' }}>{row.lastSeen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
    </section>
  );
}
