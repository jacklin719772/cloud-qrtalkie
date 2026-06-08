import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Search, Settings, Eye, Copy } from 'lucide-react';
import apiClient from './apiClient';

const CallCenterConfiguration = forwardRef((props, ref) => {
  const { onEdit, onViewInquiries } = props;
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  // --- 數據和狀態管理 ---
  const [callCenters, setCallCenters] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ total: 0, active: 0, disabled: 0, visitorEnabled: 0, expiringSoon: 0 });

  useImperativeHandle(ref, () => ({
    handleBatchDelete,
  }));

  // --- 獲取真实後台數據 ---
  const fetchCallCenters = async () => {
    setLoading(true);
    try {
      const limit = pageSize === 'all' ? 10000 : parseInt(pageSize, 10);
      const offset = (page - 1) * limit;
      const queryParams = new URLSearchParams({ limit, offset, keyword, status: statusFilter !== 'all' ? statusFilter : '' }).toString();

      const res = await apiClient.get(`/call-centers?${queryParams}`);
      if (res && res.code === 0 && res.data) {
        setCallCenters(res.data.list.map(item => ({
          id: item.id,
          name: item.centerName || item.center_name,
          url: item.centerUrl || item.center_url,
          visitorEnabled: Boolean(item.requireVisitorInfo ?? item.require_visitor_info),
          status: item.status,
          createdBy: item.createdByName || item.created_by_name || '-',
          updatedAt: item.updatedAt || item.updated_at,
          tenantExpiresAt: item.tenantExpiresAt || item.tenant_expires_at || '-'
        })));
        setTotal(res.data.total || 0);
        if (res.data.stats) setStats(res.data.stats);
      }
    } catch (error) {
      console.error('獲取呼叫中心列表失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (item) => {
    const nextStatus = item.status === 'active' ? 'disabled' : 'active';
    const actionText = item.status === 'active' ? '禁用' : '啟用';

    if (nextStatus === 'active') {
      let isExpired = true;
      if (item.tenantExpiresAt && item.tenantExpiresAt !== '-') {
        const expiresDate = new Date(`${item.tenantExpiresAt}T00:00:00Z`);
        const today = new Date();
        const diffTime = expiresDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) {
          isExpired = false;
        }
      }
      if (isExpired) {
        alert('套餐已過期，無法啟用。');
        return;
      }
    }

    if (!window.confirm(`確定要${actionText}呼叫中心「${item.name}」嗎？`)) return;

    try {
      const res = await apiClient.put(`/call-centers/${item.id}/status`, { status: nextStatus });
      if (res && res.code === 0) {
        fetchCallCenters(); // 重新拉取以更新列表與統計数字
      } else {
        alert(res?.message || '狀態更新失敗');
      }
    } catch (error) {
      console.error(error);
      const errMsg = error.response?.data?.message || error.message || '狀態更新失敗';
      alert(errMsg);
    }
  };

  const handleToggleVisitor = async (item) => {
    const nextStatus = !item.visitorEnabled;
    const actionText = nextStatus ? '開啟' : '關閉';
    if (!window.confirm(`確定要${actionText}呼叫中心「${item.name}」的訪客登記功能嗎？`)) return;

    try {
      const res = await apiClient.put(`/call-centers/${item.id}/visitor-info`, { visitorEnabled: nextStatus });
      if (res && res.code === 0) {
        fetchCallCenters();
      } else {
        alert(res?.message || '狀態更新失敗');
      }
    } catch (error) {
      console.error(error);
      const errMsg = error.response?.data?.message || error.message || '狀態更新失敗';
      alert(errMsg);
    }
  };

  const handleEdit = (item) => {
    setOpenDropdownId(null);
    let isExpired = true;
    if (item.tenantExpiresAt && item.tenantExpiresAt !== '-') {
      const expiresDate = new Date(`${item.tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      const diffTime = expiresDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) isExpired = false;
    }
    if (isExpired) {
      alert('套餐已過期，無法編輯。');
      return;
    }
    if (onEdit) onEdit(item.id);
  };

  // --- 刪除逻辑 ---
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      alert('請至少選擇一條記錄進行操作。');
      return;
    }
    if (!window.confirm(`確定要刪除選中的 ${selectedIds.length} 個呼叫中心嗎？\n（將同時清理分類及坐席資訊，且不可恢復）`)) return;

    try {
      const res = await apiClient.delete('/call-centers', { data: { ids: selectedIds } });
      if (res && res.code === 0) {
        setSelectedIds([]);
        fetchCallCenters();
      } else {
        alert(res?.message || '批量刪除失敗');
      }
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || error.message || '批量刪除失敗');
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`確定要刪除呼叫中心「${item.name}」嗎？\n（將同時清理分類及坐席資訊，且不可恢復）`)) return;

    try {
      const res = await apiClient.delete('/call-centers', { data: { ids: [item.id] } });
      if (res && res.code === 0) {
        setSelectedIds(prev => prev.filter(id => id !== item.id));
        fetchCallCenters();
      } else {
        alert(res?.message || '刪除失敗');
      }
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || error.message || '刪除失敗');
    }
  };

  // 下拉菜单點擊外部關閉
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // 下拉菜单定位逻辑 (與 Ecard 完全一致)
  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 140;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - viewportPadding - menuWidth;
      }

      const menuHeight = dropdownMenuRef.current?.offsetHeight || 140;
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - menuHeight - 4;
      }
      if (top < viewportPadding) top = viewportPadding;

      setDropdownPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openDropdownId]);

  // 依赖项变化时重新獲取數據
  useEffect(() => {
    setSelectedIds([]); // 切换分页或筛选条件时清空选中
    fetchCallCenters();
  }, [page, pageSize, keyword, statusFilter]);

  return (
    <section className="cc-config-page">
      <style>{`
        .cc-config-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%; /* 保持高度，但移除固定背景 */
          padding: 0;
          box-sizing: border-box;
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* --- 主面板区 --- */
        .cc-panel {
          background: #fff;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
          overflow: hidden;
        }
        
        /* --- 查詢與統計工具栏 --- */
        .cc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 12px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e6eef8;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
          flex-shrink: 0;
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .cc-toolbar::-webkit-scrollbar { height: 0; }
        .cc-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        .cc-search {
          position: relative;
          width: 220px;
          flex: 0 0 220px;
          max-width: 100%;
        }
        .cc-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        .cc-search input,
        .cc-select {
          height: 46px;
          border: 1px solid #d8e2ef;
          border-radius: 9px;
          font-size: 12px;
          outline: none;
          background: #fff;
          color: #334155;
          box-sizing: border-box;
        }
        .cc-search input { width: 100%; padding: 0 16px 0 44px; }
        .cc-search input::placeholder { color: #94a3b8; }
        .cc-search input:focus, .cc-select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        .cc-select { padding: 0 12px; min-width: 112px; cursor: pointer; flex-shrink: 0; }
        
        .cc-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .cc-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .cc-stat-pill strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }

        /* --- 表格区 --- */
        .cc-table-wrap {
          flex: 1;
          overflow: auto;
        }
        .cc-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1000px;
          text-align: left;
        }
        .cc-table th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          color: #64748b;
          font-weight: 600;
          font-size: 13px;
          padding: 14px 20px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
          z-index: 1;
        }
        .cc-table td {
          padding: 14px 20px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          vertical-align: middle;
        }
        .cc-table tr:hover td { background: #f8fafc; }
        .cc-table tr:hover .cc-action-cell { background: #f8fafc; }
        
        .cc-action-head, .cc-action-cell {
          position: sticky;
          right: 0;
          box-shadow: -1px 0 0 #e2e8f0;
          width: 160px;
          min-width: 160px;
          padding-left: 8px !important;
          padding-right: 8px !important;
          text-align: center;
        }
        .cc-action-head { z-index: 3 !important; background: #f8fafc; }
        .cc-action-cell { z-index: 1; background: #ffffff; }
        
        /* 单元格內容样式 */
        .cc-name { color: #0f172a; font-weight: 600; display: inline-block; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
        .cc-link { color: #2563eb; text-decoration: none; font-size: 13px; }
        .cc-link:hover { text-decoration: underline; }
        .cc-Logo-preview { 
          display: inline-flex; align-items: center; justify-content: center; 
          padding: 4px 8px; background: #f1f5f9; border: 1px solid #e2e8f0; 
          border-radius: 6px; font-size: 12px; color: #64748b; max-width: 120px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        
        /* 狀態标签 */
        .cc-switch { width: 36px; height: 20px; border-radius: 999px; border: none; padding: 0; position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.2s; }
        .cc-switch.on { background: #2563eb; }
        .cc-switch.off { background: #cbd5e1; }
        .cc-switch .dot { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .cc-switch.on .dot { left: 18px; }

        /* 操作按钮 */
        .dropdown-container { position: relative; }
        .dropdown-menu-portal {
          position: fixed;
          background-color: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 2147483647;
          min-width: 140px;
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .dropdown-menu-portal .dropdown-item {
          padding: 8px 16px;
          font-size: 13px;
          color: #334155;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          cursor: pointer;
          font-weight: 400;
        }
        .dropdown-menu-portal .dropdown-item:hover { background-color: #f1f5f9; }
        .dropdown-menu-portal .dropdown-item-danger { color: #ef4444; }
        
        /* --- 分页栏 --- */
        .cc-pagination {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
          border-top: 1px solid #e2e8f0;
        }
        .cc-page-controls { display: flex; align-items: center; gap: 12px; }
        .cc-page-size { height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid #d8e2ef; background: #fff; color: #475569; font-size: 11px; display: inline-flex; align-items: center; }
        .cc-page-btn, .cc-page-current { width: 38px; height: 38px; border-radius: 8px; border: 1px solid #d8e2ef; background: #fff; color: #475569; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
        .cc-page-current { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; font-weight: 600; }
        .cc-page-btn { cursor: pointer; font-size: 18px; line-height: 1; }
        .cc-page-btn:disabled { color: #cbd5e1; cursor: not-allowed; background: #f8fafc; }
        .cc-page-jump { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 11px; }
        .cc-page-input { width: 56px; height: 36px; border-radius: 8px; border: 1px solid #d8e2ef; text-align: center; outline: none; color: #334155; font-size: 11px; }
      `}</style>

      {/* 工具栏 */}
      <div className="cc-toolbar">
        <div className="cc-filter-left">
          <label className="cc-search">
            <Search size={18} />
            <input 
              type="search" 
              placeholder="搜尋呼叫中心名稱或訪問URL"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            />
          </label>
          <select 
            className="cc-select" 
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="all">全部</option>
            <option value="active">啟用中</option>
            <option value="disabled">已禁用</option>
          </select>
        </div>
        <div className="cc-stats">
          <span className="cc-stat-pill">呼叫中心總數<strong>{stats.total}</strong></span>
          <span className="cc-stat-pill">啟用中<strong style={{ color: '#16a34a' }}>{stats.active}</strong></span>
          <span className="cc-stat-pill">已禁用<strong style={{ color: '#f59e0b' }}>{stats.disabled}</strong></span>
          <span className="cc-stat-pill">開啟訪客登記<strong style={{ color: '#3b82f6' }}>{stats.visitorEnabled}</strong></span>
          <span className="cc-stat-pill">即將到期<strong style={{ color: '#ef4444' }}>{stats.expiringSoon || 0}</strong></span>
        </div>
      </div>

      {/* 列表面板 */}
      <div className="cc-panel">
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th style={{ width: '48px', textAlign: 'center', padding: '14px 10px' }}>
                  <input 
                    type="checkbox" 
                    style={{ cursor: 'pointer' }} 
                    checked={callCenters.length > 0 && callCenters.every(item => selectedIds.includes(item.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(callCenters.map(item => item.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th>呼叫中心名稱</th>
                <th>訪問URL</th>
                <th style={{ width: '110px', whiteSpace: 'nowrap' }}>截止日期</th>
                <th>訪客登記</th>
                <th>狀態</th>
                <th>創建人</th>
                <th style={{ width: '110px', whiteSpace: 'nowrap' }}>更新日期</th>
                <th className="cc-action-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>數據加載中...</td>
                </tr>
              ) : callCenters.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>暫無數據</td>
                </tr>
              ) : callCenters.map((item) => (
                <tr key={item.id}>
                  <td style={{ width: '48px', textAlign: 'center', padding: '12px 10px' }}>
                    <input 
                      type="checkbox" 
                      style={{ cursor: 'pointer' }}
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(prev => [...prev, item.id]);
                        } else {
                          setSelectedIds(prev => prev.filter(id => id !== item.id));
                        }
                      }}
                    />
                  </td>
                  <td><span className="cc-name" title={item.name}>{item.name}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <a href={item.url} className="cc-link" target="_blank" rel="noreferrer" title={item.url} style={{ display: 'inline-block', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                        {item.url}
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(item.url);
                          alert('連結已複製！');
                        }}
                        style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                        title="複製連結" onMouseOver={(e) => e.currentTarget.style.color = '#2563eb'} onMouseOut={(e) => e.currentTarget.style.color = '#94a3b8'}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.tenantExpiresAt}</td>
                  <td>
                    <button 
                      type="button" 
                      className={`cc-switch ${item.visitorEnabled ? 'on' : 'off'}`} 
                      tabIndex={-1}
                      onClick={() => handleToggleVisitor(item)}
                    >
                      <span className="dot"></span>
                    </button>
                  </td>
                  <td>
                    <button 
                      type="button" 
                      className={`cc-switch ${item.status === 'active' ? 'on' : 'off'}`} 
                      tabIndex={-1}
                      onClick={() => handleToggleStatus(item)}
                    >
                      <span className="dot"></span>
                    </button>
                  </td>
                  <td>{item.createdBy || '-'}</td>
                <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{String(item.updatedAt).split('T')[0].split(' ')[0]}</td>
                  <td className="cc-action-cell">
                    <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button 
                        className="ghost-btn" 
                        type="button" 
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', padding: '4px 8px' }}
                        onClick={() => window.open(item.url, '_blank')}
                      >
                        <Eye size={14} /> 預覽
                      </button>
                      <button className="ghost-btn" type="button" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', padding: '4px 8px' }} onClick={(e) => {
                        e.stopPropagation();
                        dropdownAnchorRef.current = e.currentTarget;
                        setOpenDropdownId(current => current === item.id ? null : item.id);
                      }}>更多</button>
                      
                      {/* 更多 操作菜单 */}
                      {openDropdownId === item.id && createPortal(
                        <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                          <button 
                            type="button" 
                            className="dropdown-item" 
                            onClick={() => handleEdit(item)}
                          >
                            配置
                          </button>
                          <button 
                            type="button" 
                            className="dropdown-item" 
                            onClick={() => { setOpenDropdownId(null); if (onViewInquiries) onViewInquiries(item.id); }}
                          >
                            訪客日誌
                          </button>
                          <button 
                            type="button" 
                            className="dropdown-item" 
                            onClick={() => { setOpenDropdownId(null); handleToggleStatus(item); }}
                          >
                            {item.status === 'active' ? '禁用' : '啟用'}
                          </button>
                          <button type="button" className="dropdown-item" onClick={async () => {
                            await navigator.clipboard.writeText(item.url);
                            alert('連結已複製！');
                            setOpenDropdownId(null); // 關閉下拉菜单
                          }}>
                            複製連結
                          </button>
                          <button 
                            type="button" 
                            className="dropdown-item dropdown-item-danger"
                            onClick={() => { setOpenDropdownId(null); handleDelete(item); }}
                          >
                            刪除
                          </button>
                        </div>, 
                        document.body
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页栏 */}
        <div className="cc-pagination">
          <div style={{ color: '#64748b', fontSize: '12px' }}>共 {total} 條</div>
          <div className="cc-page-controls">
            <select 
              className="cc-page-size" 
              value={pageSize}
              onChange={(e) => { setPageSize(e.target.value); setPage(1); }}
              style={{ outline: 'none', cursor: 'pointer', paddingRight: '28px', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px 14px' }}
            >
              <option value="10">10 條/頁</option>
              <option value="20">20 條/頁</option>
              <option value="50">50 條/頁</option>
              <option value="all">全部</option>
            </select>
            <button type="button" className="cc-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span className="cc-page-current">{page}</span>
            <button type="button" className="cc-page-btn" disabled={pageSize === 'all' || page * parseInt(pageSize, 10) >= total} onClick={() => setPage(p => p + 1)}>›</button>
            <span className="cc-page-jump">
              前往
              <input 
                className="cc-page-input" 
                defaultValue={page} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val) && val > 0) setPage(val);
                  }
                }} 
              />
              頁
            </span>
          </div>
        </div>
      </div>
    </section>
  );
});

export default CallCenterConfiguration;