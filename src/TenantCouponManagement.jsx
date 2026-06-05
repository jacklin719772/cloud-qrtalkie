import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';
import { Search, Download, Upload, Plus, UserPlus, UserMinus, Trash2, Edit, Eye } from 'lucide-react'; // 引入圖標

const statusOptions = [
  { value: 'all', label: '全部狀態' },
  { value: 'assigned', label: '未使用' },
  { value: 'used', label: '已使用' },
  { value: 'revoked', label: '已撤銷' },
  { value: 'expired', label: '已過期' },
];

function statusText(status) {
  if (status === 'used') return '已使用';
  if (status === 'revoked') return '已撤銷';
  if (status === 'expired') return '已過期';
  return '未使用';
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDiscount(coupon) {
  if (coupon?.discountType === 'fixed_amount') {
    return `${coupon.currency || 'USD'} ${Number(coupon.discountValue || 0).toFixed(2)}`;
  }
  return `${Number(coupon?.discountValue || 0)}%`;
}

function isCouponEffective(coupon) {
  if (coupon.status !== 'active') return false;
  const today = new Date().toISOString().slice(0, 10);
  if (coupon.validFrom && coupon.validFrom > today) return false;
  if (coupon.validUntil && coupon.validUntil < today) return false;
  return true;
}

const TenantCouponManagement = forwardRef(({ onModeChange }, ref) => {
  const [mode, setMode] = useState('list');
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, assigned: 0, used: 0, revoked: 0, expired: 0 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const pageSizeOptions = [10, 20, 50, "全部"];
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const [tenants, setTenants] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [assignMessage, setAssignMessage] = useState({ type: '', text: '' });
  const [isAssignLoading, setIsAssignLoading] = useState(false);
  const [isAssignSaving, setIsAssignSaving] = useState(false);

  const effectivePageSize = pageSize === "全部" ? (total || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const pageEnd = Math.min(total, page * effectivePageSize);

  const statItems = useMemo(() => [
    { key: 'total', label: '已分配總數', value: stats.total || 0 },
    { key: 'assigned', label: '未使用', value: stats.assigned || 0, tone: 'success' },
    { key: 'used', label: '已使用', value: stats.used || 0, tone: 'primary' },
    { key: 'revoked', label: '已撤銷', value: stats.revoked || 0, tone: 'danger' },
    { key: 'expired', label: '已過期', value: stats.expired || 0, tone: 'warning' },
  ], [stats]);

  const selectedCoupon = useMemo(
    () => coupons.find((coupon) => String(coupon.id) === String(selectedCouponId)) || null,
    [coupons, selectedCouponId],
  );

  useImperativeHandle(ref, () => ({
    startAssign: openAssignPage,
    returnToList,
  }));

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  async function loadAssignments(nextPage = page, optionalQuery) {
    const kw = typeof optionalQuery === 'string' ? optionalQuery : query;
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(effectivePageSize),
        status,
        q: kw.trim(),
      });
      const data = await apiClient.get(`/admin/tenant-coupons?${params.toString()}`);
      setItems(Array.isArray(data.items) ? data.items : []);
      setStats(data.stats || { total: 0, assigned: 0, used: 0, revoked: 0, expired: 0 });
      setTotal(Number(data.pagination?.total || 0));
      setPage(Number(data.pagination?.page || nextPage));
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err.message || '無法讀取優惠碼分配列表。');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAssignOptions() {
    setIsAssignLoading(true);
    setAssignMessage({ type: '', text: '' });
    try {
      const [tenantData, couponData] = await Promise.all([
        apiClient.get('/admin/tenants'),
        apiClient.get('/billing/coupon-settings'),
      ]);
      const activeTenants = (tenantData.tenants || [])
        .filter((tenant) => tenant.status === 'active')
        .sort((a, b) => String(a.companyName || '').localeCompare(String(b.companyName || ''), 'zh-CN'));
      const effectiveCoupons = (couponData.coupons || [])
        .filter(isCouponEffective)
        .sort((a, b) => String(a.couponCode || '').localeCompare(String(b.couponCode || ''), 'zh-CN'));

      setTenants(activeTenants);
      setCoupons(effectiveCoupons);
      setSelectedTenantId(String(activeTenants[0]?.id || ''));
      setSelectedCouponId(String(effectiveCoupons[0]?.id || ''));
    } catch (err) {
      setTenants([]);
      setCoupons([]);
      setSelectedTenantId('');
      setSelectedCouponId('');
      setAssignMessage({ type: 'error', text: err.message || '無法讀取可分配資料。' });
    } finally {
      setIsAssignLoading(false);
    }
  }

  useEffect(() => {
    loadAssignments(1);
  }, [status, pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => loadAssignments(1), 300);
    return () => clearTimeout(timer);
  }, [query]);

  function goToPage(nextPage) {
    const boundedPage = Math.min(totalPages, Math.max(1, nextPage));
    loadAssignments(boundedPage);
  }

  function openAssignPage() {
    setMode('assign');
    setAssignMessage({ type: '', text: '' });
    loadAssignOptions();
  }

  function returnToList() {
    setMode('list');
    setAssignMessage({ type: '', text: '' });
    loadAssignments(1);
  }

  async function submitAssignment(event) {
    event.preventDefault();
    if (!selectedTenantId) {
      setAssignMessage({ type: 'error', text: '請選擇啟用中的租戶。' });
      return;
    }
    if (!selectedCouponId) {
      setAssignMessage({ type: 'error', text: '請選擇生效中的優惠碼。' });
      return;
    }

    setIsAssignSaving(true);
    setAssignMessage({ type: '', text: '' });
    try {
      const result = await apiClient.post('/admin/tenant-coupons', {
        tenantId: Number(selectedTenantId),
        couponId: Number(selectedCouponId),
      });
      setAssignMessage({ type: 'success', text: result.message || '優惠碼已分配。' });
      await loadAssignments(1);
    } catch (err) {
      setAssignMessage({ type: 'error', text: err.message || '分配優惠碼失敗。' });
    } finally {
      setIsAssignSaving(false);
    }
  }

  function openDetails(item) {
    setDetailItem(item);
  }

  async function revokeAssignment(item) {
    if (item.status !== 'assigned') {
      window.alert('已使用、已撤銷或已過期的優惠碼不能撤銷。');
      return;
    }
    if (!window.confirm(`確定要撤銷「${item.tenantName || item.tenantNumber}」的優惠碼「${item.couponCode}」嗎？`)) return;

    setIsRevoking(true);
    setError('');
    try {
      await apiClient.post(`/admin/tenant-coupons/${encodeURIComponent(item.id)}/revoke`);
      await loadAssignments(page);
      if (detailItem?.id === item.id) setDetailItem(null);
    } catch (err) {
      setError(err.message || '撤销優惠碼失败。');
    } finally {
      setIsRevoking(false);
    }
  }

  async function enableAssignment(item) {
    if (item.status !== 'revoked') {
      window.alert('只有撤销状态的優惠碼可以启用。');
      return;
    }

    setIsRevoking(true);
    setError('');
    try {
      await apiClient.post(`/admin/tenant-coupons/${encodeURIComponent(item.id)}/enable`);
      await loadAssignments(page);
      if (detailItem?.id === item.id) setDetailItem(null);
    } catch (err) {
      setError(err.message || '启用優惠碼失败。');
    } finally {
      setIsRevoking(false);
    }
  }

  async function deleteAssignment(item) {
    if (item.status !== 'revoked') {
      window.alert('只有撤销状态的優惠碼可以删除。');
      return;
    }
    if (!window.confirm(`确定要删除「${item.tenantName || item.tenantNumber}」的優惠碼「${item.couponCode}」分配記錄嗎？`)) return;

    setIsRevoking(true);
    setError('');
    try {
      await apiClient.delete(`/admin/tenant-coupons/${encodeURIComponent(item.id)}`);
      await loadAssignments(page);
      if (detailItem?.id === item.id) setDetailItem(null);
    } catch (err) {
      setError(err.message || '删除優惠碼分配記錄失败。');
    } finally {
      setIsRevoking(false);
    }
  }

  if (mode === 'assign') {
    return (
      <section className="view active tenant-coupon-page" id="tenant-coupon-management">
        <div className="tenant-coupon-shell">
          <div className="tenant-coupon-scroll-area tenant-coupon-assign-scroll">
            <form className="tenant-coupon-assign-panel" onSubmit={submitAssignment}>
              <div className="tenant-coupon-assign-head">
                <div>
                  <span>優惠碼分配</span>
                  <h3>为租户分配優惠碼</h3>
                </div>
                <button className="ghost-btn" type="button" onClick={returnToList}>返回優惠碼管理</button>
              </div>

              <div className="tenant-coupon-assign-grid">
                <label>
                  启用中的租户
                  <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)} disabled={isAssignLoading || isAssignSaving}>
                    {tenants.length === 0 && <option value="">暫無啟用租戶</option>}
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.companyName || tenant.tenantNumber || tenant.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  生效中的優惠碼
                  <select value={selectedCouponId} onChange={(event) => setSelectedCouponId(event.target.value)} disabled={isAssignLoading || isAssignSaving}>
                    {coupons.length === 0 && <option value="">暫無生效優惠碼</option>}
                    {coupons.map((coupon) => (
                      <option key={coupon.id} value={coupon.id}>
                        {coupon.couponCode} - {coupon.displayName || formatDiscount(coupon)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <section className="tenant-coupon-readonly-card" aria-label="優惠碼基本信息">
                <div className="tenant-coupon-readonly-head">
                  <span>優惠碼基本信息</span>
                  <strong>{selectedCoupon?.couponCode || '-'}</strong>
                </div>
                <div className="tenant-coupon-readonly-grid">
                  <label>
                    显示名称
                    <input value={selectedCoupon?.displayName || ''} readOnly placeholder="-" />
                  </label>
                  <label>
                    优惠类型
                    <input value={selectedCoupon?.discountType === 'fixed_amount' ? '固定金额减免' : selectedCoupon ? '百分比折扣' : ''} readOnly placeholder="-" />
                  </label>
                  <label>
                    优惠内容
                    <input value={selectedCoupon ? formatDiscount(selectedCoupon) : ''} readOnly placeholder="-" />
                  </label>
                  <label>
                    状态
                    <input value={selectedCoupon?.status === 'active' ? '启用' : ''} readOnly placeholder="-" />
                  </label>
                  <label>
                    生效日期
                    <input value={selectedCoupon?.validFrom || '不限'} readOnly />
                  </label>
                  <label>
                    到期日期
                    <input value={selectedCoupon?.validUntil || '-'} readOnly />
                  </label>
                  <label>
                    使用上限
                    <input value={selectedCoupon?.maxRedemptions || '不限'} readOnly />
                  </label>
                  <label>
                    已使用次数
                    <input value={selectedCoupon ? Number(selectedCoupon.redeemedCount || 0) : ''} readOnly placeholder="-" />
                  </label>
                </div>
              </section>

              {isAssignLoading && <p className="form-message">正在載入可分配資料...</p>}
              {assignMessage.text && <p className={`form-message ${assignMessage.type}`}>{assignMessage.text}</p>}

              <menu className="form-actions tenant-coupon-assign-actions">
                <button className="ghost-btn" type="button" onClick={returnToList} disabled={isAssignSaving}>取消</button>
                <button className="primary-btn" type="submit" disabled={isAssignLoading || isAssignSaving || !selectedTenantId || !selectedCouponId}>
                  {isAssignSaving ? '分配中...' : '确认分配'}
                </button>
              </menu>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view active tenant-coupon-page" id="tenant-coupon-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <style>{`
        /* ========================================================
           复刻设备管理页面顶部命令按钮的视觉风格
           严格限定在该页面挂载时生效，通过子选择器仅覆盖工具栏操作按钮组
           ======================================================== */
        .page-heading > button {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 0 18px !important;
          border-radius: 8px !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          white-space: nowrap !important;
        }
        .page-heading > button.ghost-btn {
          background: #fff !important;
          color: #1e3a8a !important;
          border: 1px solid #dbeafe !important;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08) !important;
        }
        .page-heading > button.primary-btn {
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%) !important;
          color: #fff !important;
          border: 0 !important;
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.22) !important;
        }
        .page-heading > button.primary-btn:last-child {
          background: linear-gradient(90deg, #2563eb 0%, #4f46e5 100%) !important;
          box-shadow: 0 6px 14px rgba(79, 70, 229, 0.22) !important;
        }
        .page-heading > button svg {
          width: 14px !important; /* Icon size consistent with DeviceManagement */
          height: 14px !important;
        }
        /* ========================================================
           優惠碼管理页面样式 - 对齐 DeviceManagement.jsx
           ======================================================== */
        #tenant-coupon-management .tenant-coupon-shell {
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e6eef8;
          border-radius: 14px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        }
        #tenant-coupon-management .tenant-coupon-scroll-area {
          padding: 0;
          display: flex;
          flex-direction: column;
        }
        #tenant-coupon-management .tenant-coupon-main-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 24px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e6eef8;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
        }
        #tenant-coupon-management .tenant-coupon-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #tenant-coupon-management .tenant-coupon-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
          border: none; /* 修复：移除外层容器可能存在的边框，解决双边框问题 */
          padding: 0; /* 修复：移除外层容器可能存在的内边距 */
        }
        #tenant-coupon-management .tenant-coupon-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #tenant-coupon-management .tenant-coupon-search input {
          width: 100%;
          height: 46px;
          padding: 0 16px 0 44px;
          border-radius: 9px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #334155;
          font-size: 12px;
          outline: none;
          box-sizing: border-box;
        }
        #tenant-coupon-management .tenant-coupon-search input::placeholder { color: #94a3b8; }
        #tenant-coupon-management .tenant-coupon-search input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #tenant-coupon-management .tenant-coupon-status-select {
          height: 46px;
          min-width: 112px;
          width: 120px;
          padding: 0 12px;
          border-radius: 9px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #334155;
          font-size: 12px;
          outline: none;
          cursor: pointer;
        }
        #tenant-coupon-management .tenant-coupon-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #tenant-coupon-management .tenant-coupon-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 14px;
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
        #tenant-coupon-management .tenant-coupon-stat-pill strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }
        #tenant-coupon-management .tenant-coupon-stat-pill strong.is-success { color: #16a34a; }
        #tenant-coupon-management .tenant-coupon-stat-pill strong.is-primary { color: #2563eb; }
        #tenant-coupon-management .tenant-coupon-stat-pill strong.is-danger { color: #ef4444; }
        #tenant-coupon-management .tenant-coupon-stat-pill strong.is-warning { color: #f59e0b; }
        #tenant-coupon-management .tenant-coupon-table-card {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #e6eef8;
          border-radius: 14px;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        #tenant-coupon-management .tenant-coupon-table-wrap {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #tenant-coupon-management .tenant-coupon-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #tenant-coupon-management .tenant-coupon-table thead { background: #f8fafc; }
        #tenant-coupon-management .tenant-coupon-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #475569;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #tenant-coupon-management .tenant-coupon-table td {
          height: 64px;
          padding: 0 22px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        

#tenant-coupon-management .tenant-coupon-empty {
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
        }
        #tenant-coupon-management .tenant-coupon-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
        }
        #tenant-coupon-management .tenant-coupon-total {
          color: #64748b;
          font-size: 12px;
        }
        #tenant-coupon-management .tenant-coupon-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #tenant-coupon-management .tenant-coupon-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #475569;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #tenant-coupon-management .tenant-coupon-page-btn,
        #tenant-coupon-management .tenant-coupon-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        #tenant-coupon-management .tenant-coupon-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #tenant-coupon-management .tenant-coupon-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #tenant-coupon-management .tenant-coupon-page-btn:disabled {
          color: #cbd5e1;
          cursor: not-allowed;
          background: #f8fafc;
        }
        #tenant-coupon-management .tenant-coupon-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 11px;
        }
        #tenant-coupon-management .tenant-coupon-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          text-align: center;
          outline: none;
          color: #334155;
          font-size: 11px;
        }
        @media (max-width: 1100px) {
          #tenant-coupon-management .tenant-coupon-main-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #tenant-coupon-management .tenant-coupon-main-toolbar::-webkit-scrollbar { height: 0; }
          #tenant-coupon-management .tenant-coupon-filter-left { flex-wrap: nowrap; }
          #tenant-coupon-management .tenant-coupon-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #tenant-coupon-management .tenant-coupon-main-toolbar { padding: 18px; }
          #tenant-coupon-management .tenant-coupon-table-footer {
            padding: 14px 20px;
            flex-wrap: wrap;
            gap: 12px;
          }
          #tenant-coupon-management .tenant-coupon-pagination {
            flex-wrap: wrap;
          }
        }

        /* === Dark theme overrides === */
        #tenant-coupon-management .tenant-content { background: #111827; }
        #tenant-coupon-management .tenant-coupon-shell { background: #111827; border-color: #1f2937; box-shadow: none; }
        #tenant-coupon-management .tenant-coupon-main-toolbar { background: #111827; border-color: #1f2937; box-shadow: none; }
        #tenant-coupon-management .tenant-coupon-search input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #tenant-coupon-management .tenant-coupon-search input::placeholder { color: #6b7280; }
        #tenant-coupon-management .tenant-coupon-search input:focus { border-color: #3b82f6; }
        #tenant-coupon-management .tenant-coupon-status-select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #tenant-coupon-management .tenant-coupon-stat-pill { background: #1a2332; border-color: #374151; color: #9ca3af; }
        #tenant-coupon-management .tenant-coupon-stat-pill strong { color: #ffffff; }
        #tenant-coupon-management .tenant-coupon-table-card { background: #1a2332; border-color: #1f2937; box-shadow: none; border-radius: 14px; overflow: hidden; }
        #tenant-coupon-management .tenant-coupon-table thead { background: #1a2332; }
        #tenant-coupon-management .tenant-coupon-table th { color: #e5e7eb; border-bottom-color: #1f2937; }
        #tenant-coupon-management .tenant-coupon-table td { color: #e5e7eb; border-bottom-color: #1f2937; }
        #tenant-coupon-management .tenant-coupon-table tbody tr { background: #111827; }
        #tenant-coupon-management .tenant-coupon-table tbody tr:hover { background: #1e293b; }
        #tenant-coupon-management .tenant-coupon-table-footer { background: #111827; border-top-color: #1f2937; }
        #tenant-coupon-management .pagination-info { color: #9ca3af; }
        #tenant-coupon-management .pagination-info b { color: #f3f4f6; }
        #tenant-coupon-management .tenant-coupon-page-btn { background: #1f2937; border-color: #4b5563; color: #9ca3af; }
        #tenant-coupon-management .tenant-coupon-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #tenant-coupon-management .tenant-coupon-page-btn:disabled { opacity: 0.4; }
        #tenant-coupon-management .tenant-coupon-page-size { background: #1a2332; border-color: #374151; color: #e5e7eb; cursor: pointer; }
        #tenant-coupon-management .tenant-coupon-page-size:focus { border-color: #3b82f6; }
        #tenant-coupon-management .tenant-coupon-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
        #tenant-coupon-management .tenant-coupon-page-input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #tenant-coupon-management .tenant-coupon-table-wrap { scrollbar-width: none; }
        #tenant-coupon-management .tenant-coupon-table-wrap::-webkit-scrollbar { display: none; }
        #tenant-coupon-management .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #tenant-coupon-management .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #tenant-coupon-management .primary-btn { background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%); }
        #tenant-coupon-management .form-message { color: #d1d5db; }
        #tenant-coupon-management .form-message.error { background: #3b1111; color: #ef4444; }
        #tenant-coupon-management .form-message.success { background: #0d2818; color: #22c55e; }
        #tenant-coupon-management .status-badge.status-assigned { background: #0d2818; color: #4ade80; }
        #tenant-coupon-management .status-badge.status-used { background: #1e3a5f; color: #93c5fd; }
        #tenant-coupon-management .status-badge.status-revoked { background: #3b1111; color: #fca5a5; }
        #tenant-coupon-management .status-badge.status-expired { background: #1f2937; color: #9ca3af; }
        #tenant-coupon-management .assign-modal-content { background: #111827; border: 1px solid #1f2937; }
        #tenant-coupon-management .assign-modal-content select,
        #tenant-coupon-management .assign-modal-content input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #tenant-coupon-management .tenant-coupon-empty { background: #111827; color: #9ca3af; border-bottom-color: #1f2937; width: 100%; }
      `}</style>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>
        <div className="tenant-coupon-main-toolbar">
          <div className="tenant-coupon-filter-left">
            <label className="tenant-coupon-search">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋租戶、優惠碼或顯示名稱"
              />
            </label>
            <select className="tenant-coupon-status-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="篩選狀態">
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          
          <div className="tenant-coupon-stats">
            {statItems.map((item) => (
              <span className="tenant-coupon-stat-pill" key={item.key}>
                {item.label}
                <strong className={item.tone ? `is-${item.tone}` : ''}>{item.value}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="tenant-coupon-table-card">
          {error && <p className="form-message error tenant-coupon-message" style={{ margin: '16px 24px 0' }}>{error}</p>}

          <div className="tenant-coupon-table-wrap">
              <table className="tenant-coupon-table">
                <thead style={{ background: '#1a2332', position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>租戶</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>優惠碼</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>優惠內容</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>分配時間</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>使用狀態</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>使用訂單</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>使用時間</th>
                    <th style={{ background: '#1a2332', position: 'sticky', top: 0 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan="8" style={{ padding: 0 }}>
                        <div className="tenant-coupon-empty">正在載入優惠碼分配列表...</div>
                      </td>
                    </tr>
                  )}
                  {!isLoading && items.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ padding: 0 }}>
                        <div className="tenant-coupon-empty">暫無符合條件的優惠碼分配記錄</div>
                      </td>
                    </tr>
                  )}
                  {!isLoading && items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.tenantName || '-'}</td>
                      <td>{item.couponCode}</td>
                      <td>{formatDiscount(item)}</td>
                      <td>{formatDate(item.assignedAt)}</td>
                      <td><em className={`tenant-coupon-status ${item.status || 'assigned'}`}>{statusText(item.status)}</em></td>
                      <td>{item.usedOrderNo || '-'}</td>
                      <td>{formatDate(item.usedAt)}</td>
                      <td>
                        <div className="tenant-coupon-actions">
                          <button className="ghost-btn" type="button" onClick={() => openDetails(item)}>详情</button>
                          {item.status === 'assigned' && (
                            <button className="ghost-btn danger" type="button" onClick={() => revokeAssignment(item)} disabled={isRevoking}>撤销</button>
                          )}
                          {item.status === 'revoked' && (
                            <>
                              <button className="ghost-btn" type="button" onClick={() => enableAssignment(item)} disabled={isRevoking}>启用</button>
                              <button className="ghost-btn danger" type="button" onClick={() => deleteAssignment(item)} disabled={isRevoking}>删除</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tenant-coupon-table-footer">
              <div className="tenant-coupon-total">共 {total} 條</div>
              <div className="tenant-coupon-pagination">
                <select className="tenant-coupon-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === "全部" ? "全部" : Number(v)); setPage(1); }}>{pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === "全部" ? "全部" : opt + " 條/頁"}</option>)}</select>
                <button className="tenant-coupon-page-btn" type="button" onClick={() => goToPage(page - 1)} disabled={isLoading || page <= 1}>‹</button>
                <span className="tenant-coupon-page-current">{page}</span>
                <button className="tenant-coupon-page-btn" type="button" onClick={() => goToPage(page + 1)} disabled={isLoading || page >= totalPages}>›</button>
                <span className="tenant-coupon-page-jump">
                  前往
                  <input className="tenant-coupon-page-input" value={page} readOnly />
                  页
                </span>
              </div>
            </div>
          </div>
      </div>
      {detailItem && createPortal(
        <div className="tenant-coupon-modal-overlay" onClick={() => setDetailItem(null)}>
          <div className="tenant-coupon-modal" onClick={(event) => event.stopPropagation()}>
            <div className="tenant-coupon-modal-head">
              <div>
                <span>分配详情</span>
                <h3>{detailItem.couponCode}</h3>
              </div>
              <button className="icon-btn" type="button" title="关闭" onClick={() => setDetailItem(null)}>x</button>
            </div>
            <div className="tenant-coupon-modal-body">
              <div className="tenant-coupon-detail-grid">
                <label><span>租户</span><strong>{detailItem.tenantName || '-'}</strong></label>
                <label><span>租户编号</span><strong>{detailItem.tenantNumber || detailItem.tenantId || '-'}</strong></label>
                <label><span>優惠碼</span><strong>{detailItem.couponCode || '-'}</strong></label>
                <label><span>显示名称</span><strong>{detailItem.displayName || '-'}</strong></label>
                <label><span>优惠内容</span><strong>{formatDiscount(detailItem)}</strong></label>
                <label><span>状态</span><strong>{statusText(detailItem.status)}</strong></label>
                <label><span>有效期</span><strong>{detailItem.validFrom || '不限'} 至 {detailItem.validUntil || '-'}</strong></label>
                <label><span>分配时间</span><strong>{formatDate(detailItem.assignedAt)}</strong></label>
                <label><span>使用订单</span><strong>{detailItem.usedOrderNo || '-'}</strong></label>
                <label><span>使用时间</span><strong>{formatDate(detailItem.usedAt)}</strong></label>
                <label className="span-2"><span>备注</span><strong>{detailItem.notes || '-'}</strong></label>
              </div>
            </div>
            <div className="tenant-coupon-modal-actions">
              {detailItem.status === 'assigned' && (
                <button className="ghost-btn danger" type="button" onClick={() => revokeAssignment(detailItem)} disabled={isRevoking}>撤销</button>
              )}
              {detailItem.status === 'revoked' && (
                <>
                  <button className="ghost-btn" type="button" onClick={() => enableAssignment(detailItem)} disabled={isRevoking}>启用</button>
                  <button className="ghost-btn danger" type="button" onClick={() => deleteAssignment(detailItem)} disabled={isRevoking}>删除</button>
                </>
              )}
              <button className="primary-btn" type="button" onClick={() => setDetailItem(null)}>关闭</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
});

export default TenantCouponManagement;








