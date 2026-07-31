import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Wifi } from 'lucide-react';
import apiClient from './apiClient';

const emptyDeviceForm = {
  id: null,
  uuid: '',
  relayId: 'QRTALKIE/000002',
  subscribeTopic: '000002/QRTALKIE/POST',
  publishTopic: '{"IMEI":"865436072728652","SendID":"02","Sendtype":"Open"}',
  wifiName: '',
  wifiPassword: '',
  notes: '',
};

function generateDeviceUuid(existingUuids = new Set()) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const cryptoApi = globalThis.crypto;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = new Uint8Array(19);
    if (cryptoApi?.getRandomValues) {
      cryptoApi.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    const uuid = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    if (!existingUuids.has(uuid)) return uuid;
  }

  return `mp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 19);
}

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

function getStatusBadge(status) {
  const statusMap = {
    assigned: { label: '已分配', bg: '#0d2818', color: '#4ade80' },
    unassigned: { label: '未分配', bg: '#1f2937', color: '#9ca3af' },
    disabled: { label: '已停用', bg: '#3b1111', color: '#fca5a5' },
  };
  const item = statusMap[status] || { label: status || '未知', bg: '#f1f5f9', color: '#9ca3af' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', backgroundColor: item.bg, color: item.color, whiteSpace: 'nowrap' }}>{item.label}</span>;
}

const DeviceManagement = forwardRef(({ onModeChange }, ref) => {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [viewMode, setViewMode] = useState('list');
  const [viewingDevice, setViewingDevice] = useState(null);
  const [formData, setFormData] = useState(emptyDeviceForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const [batchAddForm, setBatchAddForm] = useState({
    relayId: emptyDeviceForm.relayId,
    subscribeTopic: emptyDeviceForm.subscribeTopic,
    publishTopic: emptyDeviceForm.publishTopic,
    count: '100',
  });
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [batchAddMessage, setBatchAddMessage] = useState({ type: '', text: '' });
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningDevice, setAssigningDevice] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [batchAssignDialogOpen, setBatchAssignDialogOpen] = useState(false);
  const [batchAssignDevices, setBatchAssignDevices] = useState([]);
  const [batchAssignTenantId, setBatchAssignTenantId] = useState('');
  const [batchAssignTenants, setBatchAssignTenants] = useState([]);
  const [isBatchAssigning, setIsBatchAssigning] = useState(false);

  async function loadDevices() {
    setIsLoading(true);
    try {
      const data = await apiClient.get('/admin/gate-devices');
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (error) {
      console.error('Failed to load gate devices:', error);
      setDevices([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  useEffect(() => {
    onModeChange?.(viewMode);
  }, [onModeChange, viewMode]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [searchKeyword, statusFilter, sortConfig]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.dropdown-container') && !event.target.closest('.dropdown-menu-portal')) setOpenDropdownId(null);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return undefined;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 140;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;
      const menuHeight = dropdownMenuRef.current?.offsetHeight || 140;
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - viewportPadding) top = rect.top - 4 - menuHeight;
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

  const filteredDevices = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return devices.filter((device) => {
      const matchesSearch = !keyword
        || String(device.uuid || '').toLowerCase().includes(keyword)
        || String(device.relayId || '').toLowerCase().includes(keyword)
        || String(device.subscribeTopic || '').toLowerCase().includes(keyword)
        || String(device.publishTopic || '').toLowerCase().includes(keyword)
        || String(device.wifiName || '').toLowerCase().includes(keyword);
      const matchesStatus = statusFilter === 'all' || device.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [devices, searchKeyword, statusFilter]);

  const deviceStats = useMemo(() => ({
    total: devices.length,
    assigned: devices.filter((device) => device.status === 'assigned').length,
    unassigned: devices.filter((device) => device.status === 'unassigned').length,
    disabled: devices.filter((device) => device.status === 'disabled').length,
  }), [devices]);

  const sortedDevices = useMemo(() => {
    if (!sortConfig.key) return filteredDevices;
    return [...filteredDevices].sort((left, right) => {
      const result = String(left[sortConfig.key] ?? '').toLowerCase().localeCompare(String(right[sortConfig.key] ?? '').toLowerCase(), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      return sortConfig.direction === 'asc' ? result : -result;
    });
  }, [filteredDevices, sortConfig]);

  const effectivePageSize = pageSize > 0 ? pageSize : sortedDevices.length;
  const totalPages = Math.max(1, Math.ceil(sortedDevices.length / effectivePageSize));
  const paginatedDevices = pageSize > 0 ? sortedDevices.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize) : sortedDevices;
  const isCurrentPageSelected = paginatedDevices.length > 0 && paginatedDevices.every((device) => selectedIds.includes(device.id));

  function handleSort(key) {
    setSortConfig((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function getSortIcon(key) {
    if (sortConfig.key !== key) return <span style={{ color: '#cbd5e1', marginLeft: '4px', fontSize: '10px' }}>↕</span>;
    return <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '10px' }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  }

  function resetForm() {
    setFormData(emptyDeviceForm);
    setFormMessage({ type: '', text: '' });
  }

  function startAdd() {
    const existingUuids = new Set(devices.map((device) => device.uuid).filter(Boolean));
    setViewMode('add');
    setFormData({ ...emptyDeviceForm, uuid: generateDeviceUuid(existingUuids) });
    setFormMessage({ type: '', text: '' });
  }

  function startBatchAdd() {
    setBatchAddForm({
      relayId: emptyDeviceForm.relayId,
      subscribeTopic: emptyDeviceForm.subscribeTopic,
      publishTopic: emptyDeviceForm.publishTopic,
      count: '100',
    });
    setBatchAddMessage({ type: '', text: '' });
    setBatchAddOpen(true);
  }

  function startEdit(device) {
    setFormData({
      id: device.id,
      uuid: device.uuid || '',
      relayId: device.relayId || '',
      subscribeTopic: device.subscribeTopic || '',
      publishTopic: device.publishTopic || '',
      wifiName: device.wifiName || '',
      wifiPassword: device.wifiPassword || '',
      notes: device.notes || '',
    });
    setFormMessage({ type: '', text: '' });
    setViewMode('edit');
  }

  function handleExportCsv() {
    const headers = ['UUID', 'Relay ID', 'Subscribe Topic', 'Publish Topic', 'WiFi Name', 'Status', 'Tenant', 'Created At', 'Creator'];
    const rows = devices.map((device) => [
      device.uuid || '',
      device.relayId || '',
      device.subscribeTopic || '',
      device.publishTopic || '',
      device.wifiName || '',
      device.status || '',
      device.tenantName || '',
      device.createdAt || '',
      device.creatorName || '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gate_devices_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveDevice(event) {
    event.preventDefault();
    if (!formData.uuid.trim() || !formData.subscribeTopic.trim() || !formData.publishTopic.trim()) {
      setFormMessage({ type: 'error', text: '請填寫 UUID、訂閱主題和釋出主題。' });
      return;
    }
    setIsSaving(true);
    setFormMessage({ type: '', text: '' });
    try {
      if (viewMode === 'edit') await apiClient.put(`/admin/gate-devices/${formData.id}`, formData);
      else await apiClient.post('/admin/gate-devices', formData);
      setFormMessage({ type: 'success', text: viewMode === 'edit' ? '裝置已更新。' : '裝置已新增。' });
      await loadDevices();
      window.setTimeout(() => {
        setViewMode('list');
        resetForm();
      }, 600);
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message || '儲存失敗。' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBatchDelete() {
    const selectedDevices = devices.filter((device) => selectedIds.includes(device.id));
    if (selectedDevices.length === 0) {
      window.alert('請選擇要刪除的裝置。');
      return;
    }
    const assignedDevices = selectedDevices.filter((device) => device.status === 'assigned');
    if (assignedDevices.length > 0) {
      window.alert(`所選裝置中有 ${assignedDevices.length} 個已分配給租戶，請先取消分配。`);
      return;
    }
    if (!window.confirm(`確定要刪除選中的 ${selectedDevices.length} 個裝置嗎？`)) return;
    try {
      await Promise.all(selectedDevices.map((device) => apiClient.delete(`/admin/gate-devices/${device.id}`)));
      setSelectedIds([]);
      await loadDevices();
    } catch (error) {
      window.alert(error.message || '批次刪除失敗。');
    }
  }

  async function handleBatchAddSubmit(event) {
    event.preventDefault();
    const count = Number(batchAddForm.count);
    const relayId = String(batchAddForm.relayId || '').trim();
    const subscribeTopic = String(batchAddForm.subscribeTopic || '').trim();
    const publishTopic = String(batchAddForm.publishTopic || '').trim();
    if (!relayId || !subscribeTopic || !publishTopic) {
      setBatchAddMessage({ type: 'error', text: '請填寫繼電器ID、訂閱主題和釋出主題。' });
      return;
    }
    if (!Number.isInteger(count) || count <= 0 || count > 1000) {
      setBatchAddMessage({ type: 'error', text: '新增數量必須在 1 到 1000 之間。' });
      return;
    }

    setIsBatchAdding(true);
    setBatchAddMessage({ type: '', text: '' });
    const existingUuids = new Set(devices.map((device) => device.uuid).filter(Boolean));
    let successCount = 0;
    const errors = [];

    for (let index = 0; index < count; index += 1) {
      const uuid = generateDeviceUuid(existingUuids);
      existingUuids.add(uuid);
      try {
        await apiClient.post('/admin/gate-devices', {
          ...emptyDeviceForm,
          uuid,
          relayId,
          subscribeTopic,
          publishTopic,
        });
        successCount += 1;
      } catch (error) {
        errors.push(`${uuid}: ${error.message || '儲存失敗'}`);
      }
    }

    await loadDevices();
    setIsBatchAdding(false);
    if (errors.length > 0) {
      setBatchAddMessage({ type: 'error', text: `已成功新增 ${successCount} 個，失敗 ${errors.length} 個。${errors.slice(0, 3).join('；')}` });
      return;
    }
    setBatchAddMessage({ type: 'success', text: `已成功批次新增 ${successCount} 個裝置。` });
    window.setTimeout(() => setBatchAddOpen(false), 800);
  }

  async function handleBatchAssign() {
    const unassignedDevices = devices.filter((device) => selectedIds.includes(device.id) && device.status !== 'assigned');
    if (selectedIds.length === 0) {
      window.alert('請選擇要分配的裝置。');
      return;
    }
    if (unassignedDevices.length === 0) {
      window.alert('所選裝置均已分配。');
      return;
    }
    setBatchAssignDevices(unassignedDevices);
    setBatchAssignTenantId('');
    try {
      const tenantsData = await apiClient.get('/admin/tenants/with-active-sip');
      setBatchAssignTenants(Array.isArray(tenantsData.tenants) ? tenantsData.tenants : []);
    } catch (err) {
      setBatchAssignTenants([]);
    }
    setBatchAssignDialogOpen(true);
  }

  async function handleConfirmBatchAssign() {
    if (!batchAssignTenantId || batchAssignDevices.length === 0) return;
    setIsBatchAssigning(true);
    let success = 0;
    for (const d of batchAssignDevices) {
      try {
        await apiClient.post(`/admin/gate-devices/${d.id}/assign`, { tenantId: Number(batchAssignTenantId) });
        success++;
      } catch (err) { console.error(err); }
    }
    setIsBatchAssigning(false);
    setBatchAssignDialogOpen(false);
    setSelectedIds([]);
    await loadDevices();
    window.alert(`已成功分配 ${success} 個裝置。`);
  }

  async function handleBatchUnassign() {
    const assignedDevices = devices.filter((device) => selectedIds.includes(device.id) && device.status === 'assigned');
    if (selectedIds.length === 0) {
      window.alert('請選擇要取消分配的裝置。');
      return;
    }
    if (assignedDevices.length === 0) {
      window.alert('所選裝置均未分配給租戶。');
      return;
    }
    if (!window.confirm(`確定要取消分配選中的 ${assignedDevices.length} 個裝置嗎？`)) return;
    try {
      await Promise.all(assignedDevices.map((device) => apiClient.post(`/admin/gate-devices/${device.id}/unassign`)));
      setSelectedIds([]);
      await loadDevices();
    } catch (error) {
      window.alert(error.message || '批次取消分配失敗。');
    }
  }

  async function handleAction(action, device) {
    setOpenDropdownId(null);
    if (action === 'details') {
      setViewingDevice(device);
      setViewMode('detail');
      return;
    }
    if (action === 'edit') {
      startEdit(device);
      return;
    }
    if (action === 'assign') {
      setAssigningDevice(device);
      setSelectedTenantId('');
      loadTenantsForAssign();
      setAssignDialogOpen(true);
      return;
    }
    if (action === 'unassign') {
      if (device.status !== 'assigned') {
        window.alert('該裝置尚未分配給租戶。');
        return;
      }
      if (!window.confirm(`確定取消裝置 ${device.uuid} 的租戶分配嗎？`)) return;
      try {
        await apiClient.post(`/admin/gate-devices/${device.id}/unassign`);
        await loadDevices();
      } catch (error) {
        window.alert(error.message || '取消分配失敗。');
      }
      return;
    }
    if (action === 'delete') {
      if (device.status === 'assigned') {
        window.alert('已經分配給租戶的裝置不允許刪除。');
        return;
      }
      if (!window.confirm(`確定刪除裝置 ${device.uuid} 嗎？`)) return;
      try {
        await apiClient.delete(`/admin/gate-devices/${device.id}`);
        await loadDevices();
      } catch (error) {
        window.alert(error.message || '刪除失敗。');
      }
    }
  }

  async function loadTenantsForAssign() {
    setIsLoadingTenants(true);
    try {
      const data = await apiClient.get('/admin/tenants/with-active-sip');
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
    } catch (error) {
      console.error('Failed to load tenants:', error);
      window.alert('載入租戶列表失敗：' + (error.message || '未知錯誤'));
      setTenants([]);
    } finally {
      setIsLoadingTenants(false);
    }
  }

  async function handleConfirmAssign() {
    if (!assigningDevice || !selectedTenantId) return;
    setIsAssigning(true);
    try {
      await apiClient.post(`/admin/gate-devices/${assigningDevice.id}/assign`, { tenantId: Number(selectedTenantId) });
      setAssignDialogOpen(false);
      setAssigningDevice(null);
      await loadDevices();
    } catch (error) {
      window.alert(error.message || '分配失敗。');
    } finally {
      setIsAssigning(false);
    }
  }

  useImperativeHandle(ref, () => ({
    returnToList: () => {
      setViewMode('list');
      resetForm();
    },
    handleExportCsv,
    startAdd,
    startBatchAdd,
    handleBatchAssign,
    handleBatchUnassign,
    handleBatchDelete,
  }));

  function toggleCurrentPageSelection(checked) {
    if (checked) {
      const nextIds = new Set(selectedIds);
      paginatedDevices.forEach((device) => nextIds.add(device.id));
      setSelectedIds(Array.from(nextIds));
      return;
    }
    const pageIds = new Set(paginatedDevices.map((device) => device.id));
    setSelectedIds((ids) => ids.filter((id) => !pageIds.has(id)));
  }

  if (viewMode === 'add' || viewMode === 'edit') {
    return (
      <section className="view active settings-form-page" id="device-management-form" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <form className="panel" onSubmit={handleSaveDevice} style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 600 }}>{viewMode === 'edit' ? '編輯裝置' : '新增裝置'}</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              <h4 style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af', marginBottom: '16px', marginTop: 0 }}>基礎設備資訊</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>UUID <RequiredMark /></span>
                  <input value={formData.uuid} readOnly={viewMode === 'edit'} onChange={(event) => setFormData({ ...formData, uuid: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', ...(viewMode === 'edit' ? { backgroundColor: '#0f172a', color: '#6b7280' } : {}) }} required />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>繼電器ID</span>
                  <input value={formData.relayId} onChange={(event) => setFormData({ ...formData, relayId: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>訂閱主題 <RequiredMark /></span>
                  <input value={formData.subscribeTopic} onChange={(event) => setFormData({ ...formData, subscribeTopic: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>發佈主題 <RequiredMark /></span>
                  <input value={formData.publishTopic} onChange={(event) => setFormData({ ...formData, publishTopic: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>Wifi名稱</span>
                  <input value={formData.wifiName} onChange={(event) => setFormData({ ...formData, wifiName: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>Wifi密碼</span>
                  <input value={formData.wifiPassword} onChange={(event) => setFormData({ ...formData, wifiPassword: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>備註</span>
                  <textarea value={formData.notes} onChange={(event) => setFormData({ ...formData, notes: event.target.value })} rows={3} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', resize: 'vertical', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
              </div>
            </div>
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {formMessage.text && <p style={{ marginRight: 'auto', margin: 0, alignSelf: 'center', fontSize: '11px', color: formMessage.type === 'error' ? '#ef4444' : '#10b981' }}>{formMessage.text}</p>}
              <button type="button" onClick={() => { setViewMode('list'); resetForm(); }} disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '11px', fontWeight: 500 }}>取消</button>
              <button type="submit" disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '11px', fontWeight: 500 }}>{isSaving ? '儲存中...' : (viewMode === 'edit' ? '儲存修改' : '提交新增')}</button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (viewMode === 'detail' && viewingDevice) {
    const fieldStyle = { padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#0f172a', color: '#e5e7eb' };
    const details = [
      ['UUID', viewingDevice.uuid || '-'],
      ['繼電器ID', viewingDevice.relayId || '-'],
      ['訂閱主題', viewingDevice.subscribeTopic || '-'],
      ['釋出主題', viewingDevice.publishTopic || '-'],
      ['Wifi名稱', viewingDevice.wifiName || '-'],
      ['Wifi密碼', viewingDevice.wifiPassword || '-'],
      ['分配狀態', viewingDevice.status || '-'],
      ['所屬租戶', viewingDevice.tenantName || '未分配'],
      ['新增人', viewingDevice.creatorName || '-'],
      ['新增時間', viewingDevice.createdAt || '-'],
    ];
    return (
      <section className="view active settings-form-page" id="device-management-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 600 }}>設備詳情</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {details.map(([label, value]) => (
                  <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: ['訂閱主題', '釋出主題'].includes(label) ? '1 / -1' : undefined }}>
                    <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>{label}</span>
                    <input value={value} readOnly style={fieldStyle} />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view active" id="device-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
      <style>{`
        .dropdown-menu-portal {
          position: fixed;
          width: 140px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
          padding: 6px;
          z-index: 2147483647;
        }
        .dropdown-menu-portal .dropdown-item {
          display: block;
          width: 100%;
          border: 0;
          background: transparent;
          color: #334155;
          text-align: left;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .dropdown-menu-portal .dropdown-item:hover { background: #f1f5f9; color: #0f172a; }
        .dropdown-menu-portal .dropdown-item-danger { color: #dc2626; }
        #device-management .device-toolbar {
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
        #device-management .device-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #device-management .device-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        #device-management .device-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #device-management .device-search input {
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
        #device-management .device-search input::placeholder { color: #94a3b8; }
        #device-management .device-search input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #device-management .device-status-select {
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
        #device-management .device-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #device-management .device-stat-pill {
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
        #device-management .device-stat-pill strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }
        #device-management .device-table-card {
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
        #device-management .device-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #device-management .device-table {
          width: 100%;
          min-width: 1300px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #device-management .device-table thead { background: #f8fafc; }
        #device-management .device-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #475569;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #device-management .device-table td {
          height: 64px;
          padding: 0 22px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #device-management .device-empty {
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
        }
        #device-management .device-empty-icon {
          width: 150px;
          height: 120px;
          margin-bottom: 18px;
          border-radius: 24px;
          background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #60a5fa;
        }
        #device-management .device-empty-title {
          margin: 0 0 8px;
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
        }
        #device-management .device-empty-desc {
          margin: 0;
          font-size: 11px;
          color: #64748b;
        }
        #device-management .device-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
        }
        #device-management .device-total {
          color: #64748b;
          font-size: 12px;
        }
        #device-management .device-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #device-management .device-page-size {
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
        #device-management .device-page-btn,
        #device-management .device-page-current {
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
        #device-management .device-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #device-management .device-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #device-management .device-page-btn:disabled {
          color: #cbd5e1;
          cursor: not-allowed;
          background: #f8fafc;
        }
        #device-management .device-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 11px;
        }
        #device-management .device-page-input {
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
          #device-management .device-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #device-management .device-toolbar::-webkit-scrollbar { height: 0; }
          #device-management .device-filter-left { flex-wrap: nowrap; }
          #device-management .device-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #device-management .device-toolbar { padding: 18px; }
          #device-management .device-table-footer { padding: 14px 20px; flex-wrap: wrap; }
          #device-management .device-pagination { flex-wrap: wrap; }
        }

        /* === Dark theme overrides === */
        #device-management .device-toolbar { background: #111827; border: 1px solid #1f2937; box-shadow: none; }
        #device-management .device-search input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #device-management .device-search input::placeholder { color: #6b7280; }
        #device-management .device-search input:focus { border-color: #3b82f6; }
        #device-management .device-status-select { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #device-management .device-stat-pill { background: #1a2332; border: 1px solid #374151; color: #9ca3af; border-radius: 14px; }
        #device-management .device-stat-pill strong { color: #ffffff; }
        #device-management .device-table-card { background: #1a2332; border: 1px solid #1f2937; box-shadow: none; border-radius: 14px; overflow: hidden; }
        #device-management .device-table thead { background: #1a2332; }
        #device-management .device-table th { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #device-management .device-table td { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #device-management .device-table tbody tr { background: #111827; }
        #device-management .device-table tbody tr:hover { background: #1e293b; }
        #device-management .device-table td:last-child { background: #111827; box-shadow: -1px 0 0 #1f2937; }
        #device-management .device-table th:last-child { background: #1a2332; box-shadow: -1px 0 0 #1f2937; }
        #device-management .device-empty { background: #111827; color: #9ca3af; border-bottom: 1px solid #1f2937; }
        #device-management .device-empty-icon { background: linear-gradient(180deg, #1e3a5f 0%, #1a2332 100%); color: #60a5fa; }
        #device-management .device-empty-title { color: #f3f4f6; }
        #device-management .device-empty-desc { color: #9ca3af; }
        #device-management .device-table-footer { background: #111827; border-top: 1px solid #1f2937; }
        #device-management .device-total { color: #9ca3af; }
        #device-management .device-page-size { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; cursor: pointer; }
        #device-management .device-page-size:focus { border-color: #3b82f6; }
        #device-management .device-page-btn { background: #1f2937; border: 1px solid #4b5563; color: #9ca3af; }
        #device-management .device-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #device-management .device-page-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; }
        #device-management .device-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
        #device-management .device-page-input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #device-management .device-page-jump { color: #9ca3af; }
        #device-management .device-table-wrapper { scrollbar-width: none; }
        #device-management .device-table-wrapper::-webkit-scrollbar { display: none; }
        #device-management .device-table input[type="checkbox"] { accent-color: #3b82f6; background: transparent; }
        #device-management .ghost-btn,
        #device-management-detail .ghost-btn,
        #device-management-form .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #device-management .ghost-btn:hover,
        #device-management-detail .ghost-btn:hover,
        #device-management-form .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #device-management .form-message { color: #d1d5db; }
        #device-management .form-message.error { background: #3b1111; color: #ef4444; }
        #device-management .form-message.success { background: #0d2818; color: #22c55e; }
        .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
        .dropdown-menu-portal .dropdown-item { color: #d1d5db; }
        .dropdown-menu-portal .dropdown-item:hover { background: #374151; color: #f3f4f6; }
      `}</style>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>
        <div className="device-toolbar">
          <div className="device-filter-left">
            <label className="device-search">
              <Search size={18} />
              <input type="search" placeholder="搜尋 UUID、繼電器ID或 WiFi" value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)} />
            </label>
            <select className="device-status-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="assigned">已分配</option>
              <option value="unassigned">未分配</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
          <div className="device-stats">
            {[
              ['全部', deviceStats.total],
              ['已分配', deviceStats.assigned],
              ['未分配', deviceStats.unassigned],
              ['已停用', deviceStats.disabled],
            ].map(([label, value]) => (
              <span key={label} className="device-stat-pill">{label}<strong>{value}</strong></span>
            ))}
          </div>
        </div>

        <div className="device-table-card">
          <div className="device-table-wrapper">
            <table className="device-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center', padding: 0, background: '#1a2332' }}><input type="checkbox" checked={isCurrentPageSelected} onChange={(event) => toggleCurrentPageSelection(event.target.checked)} /></th>
                  {[
                    ['uuid', 'UUID', '190px'],
                    ['relayId', '繼電器ID', '170px'],
                    ['status', '分配狀態', '140px'],
                    ['tenantName', '所屬租戶', '140px'],
                    ['expiresAt', '截止日期', '120px'],
                    ['createdAt', '新增時間', '150px'],
                    ['creatorName', '新增人', '170px'],
                  ].map(([key, label, width]) => (
                    <th key={key} style={{ width, background: '#1a2332' }}>
                      <button type="button" onClick={() => handleSort(key)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }}>{label}{getSortIcon(key)}</button>
                    </th>
                  ))}
                  <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDevices.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ padding: 0, textAlign: 'center' }}>
                      <div className="device-empty">
                        <div className="device-empty-icon"><Wifi size={56} /></div>
                        <div className="device-empty-title">{isLoading ? '載入中...' : '暫無裝置'}</div>
                        {!isLoading && <div className="device-empty-desc">當前篩選條件下沒有設備，請調整搜尋條件或新增設備</div>}
                      </div>
                    </td>
                  </tr>
                ) : paginatedDevices.map((device) => (
                  <tr key={device.id}>
                    <td style={{ width: '50px', textAlign: 'center', padding: 0 }}><input type="checkbox" checked={selectedIds.includes(device.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...new Set([...ids, device.id])] : ids.filter((id) => id !== device.id))} /></td>
                    <td style={{ color: '#e5e7eb', fontWeight: 500 }}>{device.uuid}</td>
                    <td>{device.relayId || '-'}</td>
                    <td>{getStatusBadge(device.status)}</td>
                    <td>{device.tenantName || '未分配'}</td>
                    <td>{device.expiresAt || '-'}</td>
                    <td>{device.createdAt || '-'}</td>
                    <td>{device.creatorName || '-'}</td>
                    <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center', padding: '0 12px' }}>
                      <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                        <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => handleAction('details', device)}>詳情</button>
                        <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={(event) => {
                          event.stopPropagation();
                          dropdownAnchorRef.current = event.currentTarget;
                          setOpenDropdownId((current) => current === device.id ? null : device.id);
                        }}>更多</button>
                        {openDropdownId === device.id && createPortal(
                          <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('details', device)}>詳情</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('edit', device)}>編輯</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction(device.status === 'assigned' ? 'unassign' : 'assign', device)}>{device.status === 'assigned' ? '取消分配' : '分配'}</button>
                            <button type="button" className="dropdown-item dropdown-item-danger" onClick={() => handleAction('delete', device)}>刪除</button>
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

          <div className="device-table-footer">
            <div className="device-total">共 {filteredDevices.length} 條</div>
            <div className="device-pagination">
              <select className="device-page-size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10 條/页</option>
                <option value={20}>20 條/页</option>
                <option value={50}>50 條/页</option>
                <option value={-1}>全部</option>
              </select>
              <button className="device-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>‹</button>
              <span className="device-page-current">{currentPage}</span>
              <button className="device-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => page + 1)}>›</button>
              <span className="device-page-jump">前往<input className="device-page-input" value={currentPage} readOnly />頁</span>
            </div>
          </div>
        </div>
      </div>

      {assignDialogOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setAssignDialogOpen(false); }}>
          <div style={{ width: 'min(480px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>分配設備 — {assigningDevice?.uuid}</h3>
            </div>
            <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>選擇租戶 <span style={{ color: '#ef4444' }}>*</span></span>
                <select value={selectedTenantId} onChange={(e) => setSelectedTenantId(e.target.value)}
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', fontSize: '13px', backgroundColor: '#1a2332', color: '#e5e7eb' }}>
                  <option value="">{isLoadingTenants ? '載入中...' : (tenants.length === 0 ? '暫無可用租戶' : '請選擇租戶...')}</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.companyName || t.name}{t.latestSipExpiry ? ` (SIP 到期: ${new Date(t.latestSipExpiry).toLocaleDateString('zh-CN')})` : ''}</option>
                  ))}
                </select>
              </label>
              <p style={{ margin: 0, fontSize: '11px', color: '#9ca3af' }}>
                設備有效期將與租戶 SIP 帳號有效期保持一致。若租戶無明確到期日則設備永久有效。
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isAssigning} onClick={() => setAssignDialogOpen(false)} style={{ background: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="button" disabled={isAssigning || !selectedTenantId} onClick={handleConfirmAssign}>{isAssigning ? '分配中...' : '確認分配'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {batchAssignDialogOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setBatchAssignDialogOpen(false); }}>
          <div style={{ width: 'min(520px, 100%)', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>批量分配設備（{batchAssignDevices.length} 個）</h3>
            </div>
            <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>選擇租戶 <span style={{ color: '#ef4444' }}>*</span></span>
                <select value={batchAssignTenantId} onChange={(e) => setBatchAssignTenantId(e.target.value)}
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', fontSize: '13px' }}>
                  <option value="">{batchAssignTenants.length === 0 ? '暫無可用租戶' : '請選擇租戶...'}</option>
                  {batchAssignTenants.map(t => (
                    <option key={t.id} value={t.id}>{t.companyName || t.name}{t.latestSipExpiry ? ` (SIP 到期: ${new Date(t.latestSipExpiry).toLocaleDateString('zh-CN')})` : ''}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isBatchAssigning} onClick={() => setBatchAssignDialogOpen(false)} style={{ background: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="button" disabled={isBatchAssigning || !batchAssignTenantId} onClick={handleConfirmBatchAssign}>{isBatchAssigning ? '分配中...' : '確認分配'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {batchAddOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setBatchAddOpen(false); }}>
          <form onSubmit={handleBatchAddSubmit} style={{ width: 'min(480px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>批量新增設備</h3>
            </div>
            <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>繼電器ID</span>
                <input value={batchAddForm.relayId} onChange={(event) => setBatchAddForm((form) => ({ ...form, relayId: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>訂閱主題</span>
                <input value={batchAddForm.subscribeTopic} onChange={(event) => setBatchAddForm((form) => ({ ...form, subscribeTopic: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>發佈主題</span>
                <input value={batchAddForm.publishTopic} onChange={(event) => setBatchAddForm((form) => ({ ...form, publishTopic: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>新增數量</span>
                <input value={batchAddForm.count} onChange={(event) => setBatchAddForm((form) => ({ ...form, count: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
              </label>
              <p style={{ margin: 0, fontSize: '10px', color: '#9ca3af' }}>系統會為每條記錄生成唯一 UUID，並使用相同的繼電器ID、訂閱主題和發佈主題。</p>
              {batchAddMessage.text && <p style={{ margin: 0, fontSize: '11px', color: batchAddMessage.type === 'error' ? '#ef4444' : '#22c55e' }}>{batchAddMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isBatchAdding} onClick={() => setBatchAddOpen(false)} style={{ background: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', padding: '8px 18px', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isBatchAdding}>{isBatchAdding ? '新增中...' : '確認新增'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </section>
  );
});

export default DeviceManagement;


