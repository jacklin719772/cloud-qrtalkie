import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Building, Home, DoorOpen, Shield, Plus, Settings,
  Key, Search, ChevronDown, ChevronRight, X, MoreHorizontal
} from 'lucide-react';
import apiClient from './apiClient';
import AddBuildingDialog from './AddBuildingDialog';
import AddEntranceDialog from './AddEntranceDialog';
import AddRoomDialog from './AddRoomDialog';
import AddCommunityDialog from './AddCommunityDialog';

const AccessControl = forwardRef((props, ref) => {
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedCommunity, setExpandedCommunity] = useState(null);
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [showAuthDrawer, setShowAuthDrawer] = useState(false);
  const [selectedEntrance, setSelectedEntrance] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(null); // { id, top, right } or null
  const [entranceDropdownOpen, setEntranceDropdownOpen] = useState(null); // { id, top, right } or null
  const [buildingDropdownOpen, setBuildingDropdownOpen] = useState(null); // { id, top, right } or null
  const [roomDropdownOpen, setRoomDropdownOpen] = useState(null);
  const [viewRoomsBuilding, setViewRoomsBuilding] = useState(null); // { buildingId, buildingName, rooms } or null
  const [roomViewSearch, setRoomViewSearch] = useState('');
  const [roomViewSelected, setRoomViewSelected] = useState(new Set());
  const [entranceSearch, setEntranceSearch] = useState('');
  const [entranceStatusFilter, setEntranceStatusFilter] = useState('all');
  const [entranceLevelFilter, setEntranceLevelFilter] = useState('all');
  const [assignSipRoom, setAssignSipRoom] = useState(null); // { roomId, roomNumber, buildingId, buildingName } or null
  const [sipAccounts, setSipAccounts] = useState([]);
  const [sipLoading, setSipLoading] = useState(false);
  const [sipSearch, setSipSearch] = useState('');
  const [authTab, setAuthTab] = useState('authorized'); // 'authorized' | 'byRoom' | 'byBuilding'
  const [authSearch, setAuthSearch] = useState('');
  const [authSort, setAuthSort] = useState({ field: 'roomNumber', asc: true });
  const [showRoomAuthDrawer, setShowRoomAuthDrawer] = useState(false);
  const [selectedRoomAuth, setSelectedRoomAuth] = useState(null); // { roomId, roomNumber, buildingId, buildingName, communityId }
  const [showBuildingAuthDrawer, setShowBuildingAuthDrawer] = useState(false);
  const [selectedBuildingAuth, setSelectedBuildingAuth] = useState(null); // { buildingId, buildingName, communityId, community }
  const [showCommunityAuthDrawer, setShowCommunityAuthDrawer] = useState(false);
  const [selectedCommunityAuth, setSelectedCommunityAuth] = useState(null); // { communityId, communityName }
  const [authPageSelected, setAuthPageSelected] = useState(null);
  const [authPageSearch, setAuthPageSearch] = useState('');
  const [deviceStats, setDeviceStats] = useState({ assigned: 0, total: 0 });
  const [gateDeviceList, setGateDeviceList] = useState([]);
  const [gateDeviceLoading, setGateDeviceLoading] = useState(false);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceEntrance, setDeviceEntrance] = useState(null);
  const [availableDevices, setAvailableDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [qrDialog, setQrDialog] = useState(null); // { url, title, filename } or null
  const [roomSort, setRoomSort] = useState({}); // { [buildingId]: { field: 'roomNumber', asc: true } }
  const [toast, setToast] = useState(null); // { message, type } or null
  const addBuildingDialogRef = useRef(null);
  const addEntranceDialogRef = useRef(null);
  const addRoomDialogRef = useRef(null);
  const addCommunityDialogRef = useRef(null);

  const fetchCommunities = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (searchTerm) queryParams.set('keyword', searchTerm);
      const res = await apiClient.get(`/access-communities?${queryParams.toString()}`);
      if (res && res.code === 0 && res.data) {
        setCommunities((res.data.list || []).map(c => ({
          ...c,
          buildings: c.buildings || [],
          communityEntrances: c.communityEntrances || [],
          authMatrix: c.authMatrix || {},
        })));
      }
    } catch (error) {
      console.error('獲取社區列表失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommunities();
  }, [searchTerm]);

  useEffect(() => {
    apiClient.get('/tenant/gate-devices?all=1').then(res => {
      const devices = Array.isArray(res?.devices) ? res.devices : [];
      setDeviceStats({ assigned: devices.filter(d => d.status === 'assigned').length, total: devices.length });
    }).catch(() => {});
  }, [communities]);

  useEffect(() => {
    if (activeTab !== 'gateDevices') return;
    setGateDeviceLoading(true);
    apiClient.get('/tenant/gate-devices?all=1').then(res => {
      const devices = Array.isArray(res?.devices) ? res.devices : [];
      const enriched = devices.map(d => {
        let boundEntrance = null;
        communities.forEach(c => {
          (c.communityEntrances || []).forEach(e => { if (e.deviceId === d.id) boundEntrance = { name: e.name, belongName: c.name, type: 'community' }; });
          (c.buildings || []).forEach(b => (b.entrances || []).forEach(e => { if (e.deviceId === d.id) boundEntrance = { name: e.name, belongName: b.name, type: 'building' }; }));
        });
        return { ...d, boundEntrance };
      });
      setGateDeviceList(enriched);
      setGateDeviceLoading(false);
    }).catch(() => setGateDeviceLoading(false));
  }, [activeTab, communities]);

  const boundDeviceCount = communities.reduce((s, c) => s + (c.communityEntrances || []).filter(e => e.deviceStatus !== 'none').length + (c.buildings || []).reduce((a, b) => a + (b.entrances || []).filter(e => e.deviceStatus !== 'none').length, 0), 0);

  useImperativeHandle(ref, () => ({
    showAddCommunityDialog() {
      addCommunityDialogRef.current?.showModal();
    },
    reload() {
      fetchCommunities();
    },
  }));

  const handleCommunityCreated = (data) => {
    setCommunities(prev => [...prev, {
      ...data,
      buildings: [],
      communityEntrances: [],
      authMatrix: {},
    }]);
    setExpandedCommunity(null);
    setExpandedBuilding(null);
  };

  const handleCommunityUpdated = (data) => {
    setCommunities(prev => prev.map(c => {
      if (c.id === data.id) {
        return { ...c, ...data };
      }
      return c;
    }));
  };

  const handleToggleCommunity = async (c) => {
    setDropdownOpen(null);
    const newActive = !(c.isActive !== false);
    try {
      const res = await apiClient.put(`/access-communities/${c.id}/toggle`, { isActive: newActive });
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(item => item.id === c.id ? { ...item, isActive: newActive } : item));
      }
    } catch (error) {
      console.error('切換社區狀態失敗:', error);
    }
  };

  const handleCopyUrl = async (c) => {
    setDropdownOpen(null);
    const url = c.accessUrl;
    if (!url) {
      setToast({ message: '該社區尚未設置訪問鏈接。', type: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast({ message: '訪問鏈接已複製到剪貼板。', type: 'success' });
    } catch {
      setToast({ message: '複製失敗，請手動複製。', type: 'error' });
    }
  };

  const handleDeleteCommunity = async (c) => {
    setDropdownOpen(null);
    if (!window.confirm(`確定要刪除社區「${c.name}」嗎？此操作無法撤銷。`)) return;
    try {
      const res = await apiClient.delete(`/access-communities/${c.id}`);
      if (res && res.code === 0) {
        setCommunities(prev => prev.filter(item => item.id !== c.id));
        if (expandedCommunity === c.id) setExpandedCommunity(null);
      }
    } catch (error) {
      console.error('刪除社區失敗:', error);
    }
  };

  const handleEntranceUpdated = (data) => {
    setCommunities(prev => prev.map(c => {
      if (data.communityId && c.id === data.communityId) {
        return { ...c, communityEntrances: (c.communityEntrances || []).map(e => e.id === data.id ? { ...e, ...data } : e) };
      }
      if (data.buildingId) {
        const updatedBuildings = (c.buildings || []).map(b => {
          if (b.entrances && b.entrances.some(e => e.id === data.id)) {
            return { ...b, entrances: b.entrances.map(e => e.id === data.id ? { ...e, ...data } : e) };
          }
          return b;
        });
        return { ...c, buildings: updatedBuildings };
      }
      return c;
    }));
  };

  const handleToggleEntrance = async (e) => {
    setEntranceDropdownOpen(null);
    const newActive = !(e.isActive !== false);
    try {
      const res = await apiClient.put(`/access-entrances/${e.id}/toggle`, { isActive: newActive });
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(c => {
          if (e.communityId && c.id === e.communityId) {
            return { ...c, communityEntrances: (c.communityEntrances || []).map(ent => ent.id === e.id ? { ...ent, isActive: newActive } : ent) };
          }
          if (e.buildingId) {
            return { ...c, buildings: (c.buildings || []).map(b => ({
              ...b, entrances: (b.entrances || []).map(ent => ent.id === e.id ? { ...ent, isActive: newActive } : ent)
            })) };
          }
          return c;
        }));
      }
    } catch (error) {
      console.error('切換入口狀態失敗:', error);
    }
  };

  const handleDeleteEntrance = async (entrance, communityId, buildingId) => {
    setEntranceDropdownOpen(null);
    if (!window.confirm(`確定要刪除入口「${entrance.name}」嗎？此操作無法撤銷。`)) return;
    try {
      const res = await apiClient.delete(`/access-entrances/${entrance.id}`);
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(c => {
          if (communityId && c.id === communityId) {
            if (buildingId) {
              return { ...c, buildings: (c.buildings || []).map(b => b.id === buildingId ? { ...b, entrances: (b.entrances || []).filter(e => e.id !== entrance.id) } : b) };
            }
            return { ...c, communityEntrances: (c.communityEntrances || []).filter(e => e.id !== entrance.id) };
          }
          return c;
        }));
      }
    } catch (error) {
      console.error('刪除入口失敗:', error);
    }
  };

  const handleBatchDeleteEntrances = async (communityId, buildingId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return;
    let selected;
    if (buildingId) {
      const building = (community.buildings || []).find(b => b.id === buildingId);
      selected = (building?.entrances || []).filter(e => e._selected);
    } else {
      selected = (community.communityEntrances || []).filter(e => e._selected);
    }
    if (selected.length === 0) return;
    if (!window.confirm(`確定要刪除 ${selected.length} 個入口嗎？\n\n${selected.map(e => '· ' + e.name).join('\n')}\n\n此操作無法撤銷。`)) return;

    let errorCount = 0;
    for (const e of selected) {
      try {
        const res = await apiClient.delete(`/access-entrances/${e.id}`);
        if (!res || res.code !== 0) errorCount++;
      } catch { errorCount++; }
    }
    if (errorCount === 0) {
      setCommunities(prev => prev.map(c => {
        if (c.id === communityId) {
          if (buildingId) {
            return { ...c, buildings: (c.buildings || []).map(b => b.id === buildingId ? { ...b, entrances: (b.entrances || []).filter(e => !e._selected) } : b) };
          }
          return { ...c, communityEntrances: (c.communityEntrances || []).filter(e => !e._selected) };
        }
        return c;
      }));
    } else {
      window.alert(`刪除完成，${errorCount} 個入口刪除失敗。`);
      fetchCommunities();
    }
  };

  const handleBuildingCreated = (data) => {
    setCommunities(prev => prev.map(c => {
      if (c.id === data.communityId) {
        return { ...c, buildings: [...(c.buildings || []), data] };
      }
      return c;
    }));
  };

  const handleBuildingUpdated = (data) => {
    setCommunities(prev => prev.map(c => {
      if (c.id === data.communityId) {
        return { ...c, buildings: (c.buildings || []).map(b => b.id === data.id ? { ...b, ...data } : b) };
      }
      return c;
    }));
  };

  const handleDeleteBuilding = async (b, communityId) => {
    setBuildingDropdownOpen(null);
    const roomCount = (b.rooms || []).length;
    const entranceCount = (b.entrances || []).length;
    let warnMsg = `確定要刪除樓宇「${b.name}」嗎？`;
    if (roomCount > 0 || entranceCount > 0) {
      warnMsg += `\n\n請注意：`;
      if (roomCount > 0) warnMsg += `\n· ${roomCount} 個房間`;
      if (entranceCount > 0) warnMsg += `\n· ${entranceCount} 個入口`;
      warnMsg += `\n以上資料將全部被刪除。此操作無法撤銷。`;
    } else {
      warnMsg += `此操作無法撤銷。`;
    }
    if (!window.confirm(warnMsg)) return;
    try {
      const res = await apiClient.delete(`/access-buildings/${b.id}`);
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(c => {
          if (c.id === communityId) {
            return { ...c, buildings: (c.buildings || []).filter(item => item.id !== b.id) };
          }
          return c;
        }));
      }
    } catch (error) {
      console.error('刪除樓宇失敗:', error);
    }
  };

  const handleRoomCreated = (data) => {
    setCommunities(prev => prev.map(c => ({
      ...c,
      buildings: (c.buildings || []).map(b => {
        if (b.id === data.buildingId) {
          return { ...b, rooms: [...(b.rooms || []), data] };
        }
        return b;
      }),
    })));
  };

  const handleRoomUpdated = (data) => {
    setCommunities(prev => prev.map(c => ({
      ...c,
      buildings: (c.buildings || []).map(b => {
        if (b.rooms && b.rooms.some(r => r.id === data.id)) {
          return { ...b, rooms: b.rooms.map(r => r.id === data.id ? { ...r, ...data } : r) };
        }
        return b;
      }),
    })));
    setViewRoomsBuilding(prev => prev ? { ...prev, rooms: (prev.rooms || []).map(r => r.id === data.id ? { ...r, ...data } : r) } : null);
  };

  const openSipAssignDialog = async (room, buildingId, buildingName) => {
    setAssignSipRoom({ roomId: room.id, roomNumber: room.roomNumber, buildingId, buildingName, currentSipUserId: room.sipUserId });
    setSipLoading(true);
    try {
      const res = await apiClient.get(`/sip-users/available?roomId=${room.id}`);
      if (res && res.code === 0) setSipAccounts(res.data.list || []);
    } catch (error) { console.error('獲取 SIP 用戶失敗:', error); }
    setSipLoading(false);
  };

  const openDeviceDialog = async (entrance, communityId) => {
    setDeviceEntrance({ ...entrance, communityId });
    setSelectedDeviceId(entrance.deviceId ? String(entrance.deviceId) : '');
    setDeviceLoading(true);
    try {
      const res = await apiClient.get(`/tenant/gate-devices?entranceId=${entrance.id}`);
      setAvailableDevices(Array.isArray(res?.devices) ? res.devices : []);
    } catch (err) { console.error(err); setAvailableDevices([]); }
    setDeviceLoading(false);
    setDeviceDialogOpen(true);
  };

  const handleBatchAssignDevices = async (communityId) => {
    // Find all community entrances without devices
    const community = communities.find(c => c.id === communityId);
    if (!community) return;
    const entrancesWithoutDevice = (community.communityEntrances || []).filter(e => e.deviceStatus === 'none');
    if (entrancesWithoutDevice.length === 0) {
      window.alert('該社區所有入口均已綁定設備。');
      return;
    }
    if (!window.confirm(`將為 ${entrancesWithoutDevice.length} 個未綁定設備的入口自動分配設備，確定繼續？`)) return;
    try {
      // Get available unassigned devices
      const res = await apiClient.get('/tenant/gate-devices');
      const allDevices = Array.isArray(res?.devices) ? res.devices : [];
      // 後端已篩選：未分配 + 已分配給該租戶的設備
      if (allDevices.length < entrancesWithoutDevice.length) {
        window.alert(`可用設備不足：需要 ${entrancesWithoutDevice.length} 個，目前僅有 ${allDevices.length} 個可用設備。`);
        return;
      }
      let assigned = 0;
      for (let i = 0; i < entrancesWithoutDevice.length; i++) {
        try {
          await apiClient.put(`/access-entrances/${entrancesWithoutDevice[i].id}/device`, { deviceId: allDevices[i].id });
          assigned++;
        } catch (err) { console.error(err); }
      }
      // Update local state
      setCommunities(prev => prev.map(c => {
        if (c.id !== communityId) return c;
        return { ...c, communityEntrances: (c.communityEntrances || []).map(e => {
          const idx = entrancesWithoutDevice.findIndex(ew => ew.id === e.id);
          if (idx < 0) return e;
          const d = allDevices[idx];
          return { ...e, deviceId: d.id, device: d.uuid, deviceStatus: 'unknown', isActive: true };
        }) };
      }));
      window.alert(`已成功為 ${assigned} 個入口分配設備。`);
    } catch (err) { console.error(err); window.alert('操作失敗。'); }
  };

  const handleBatchAssignBuildingDevices = async (communityId, buildingId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return;
    const building = (community.buildings || []).find(b => b.id === buildingId);
    if (!building) return;
    const entrancesWithoutDevice = (building.entrances || []).filter(e => e.deviceStatus === 'none');
    if (entrancesWithoutDevice.length === 0) {
      window.alert('該樓宇所有入口均已綁定設備。');
      return;
    }
    if (!window.confirm(`將為 ${entrancesWithoutDevice.length} 個未綁定設備的入口自動分配設備，確定繼續？`)) return;
    try {
      const res = await apiClient.get('/tenant/gate-devices');
      const allDevices = Array.isArray(res?.devices) ? res.devices : [];
      if (allDevices.length < entrancesWithoutDevice.length) {
        window.alert(`可用設備不足：需要 ${entrancesWithoutDevice.length} 個，目前僅有 ${allDevices.length} 個可用設備。`);
        return;
      }
      let assigned = 0;
      for (let i = 0; i < entrancesWithoutDevice.length; i++) {
        try {
          await apiClient.put(`/access-entrances/${entrancesWithoutDevice[i].id}/device`, { deviceId: allDevices[i].id });
          assigned++;
        } catch (err) { console.error(err); }
      }
      setCommunities(prev => prev.map(c => {
        if (c.id !== communityId) return c;
        return { ...c, buildings: (c.buildings || []).map(b2 => {
          if (b2.id !== buildingId) return b2;
          return { ...b2, entrances: (b2.entrances || []).map(e => {
            const idx = entrancesWithoutDevice.findIndex(ew => ew.id === e.id);
            if (idx < 0) return e;
            const d = allDevices[idx];
            return { ...e, deviceId: d.id, device: d.uuid, deviceStatus: 'unknown', isActive: true };
          }) };
        }) };
      }));
      window.alert(`已成功為 ${assigned} 個入口分配設備。`);
    } catch (err) { console.error(err); window.alert('操作失敗。'); }
  };

  const handleBatchRemoveBuildingDevices = async (communityId, buildingId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return;
    const building = (community.buildings || []).find(b => b.id === buildingId);
    if (!building) return;
    const entrancesWithDevice = (building.entrances || []).filter(e => e.deviceStatus !== 'none');
    if (entrancesWithDevice.length === 0) {
      window.alert('該樓宇沒有已綁定設備的入口。');
      return;
    }
    if (!window.confirm(`將移除 ${entrancesWithDevice.length} 個入口的設備綁定，確定繼續？`)) return;
    let removed = 0;
    for (const e of entrancesWithDevice) {
      try {
        await apiClient.put(`/access-entrances/${e.id}/device`, { deviceId: null });
        removed++;
      } catch (err) { console.error(err); }
    }
    setCommunities(prev => prev.map(c => {
      if (c.id !== communityId) return c;
      return { ...c, buildings: (c.buildings || []).map(b2 => {
        if (b2.id !== buildingId) return b2;
        return { ...b2, entrances: (b2.entrances || []).map(e => e.deviceStatus !== 'none' ? { ...e, deviceId: null, device: null, deviceStatus: 'none', isActive: false } : e) };
      }) };
    }));
    window.alert(`已成功移除 ${removed} 個入口的設備。`);
  };

  const handleBatchRemoveDevices = async (communityId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return;
    const entrancesWithDevice = (community.communityEntrances || []).filter(e => e.deviceStatus !== 'none');
    if (entrancesWithDevice.length === 0) {
      window.alert('該社區沒有已綁定設備的入口。');
      return;
    }
    if (!window.confirm(`將移除 ${entrancesWithDevice.length} 個入口的設備綁定，確定繼續？`)) return;
    let removed = 0;
    for (const e of entrancesWithDevice) {
      try {
        await apiClient.put(`/access-entrances/${e.id}/device`, { deviceId: null });
        removed++;
      } catch (err) { console.error(err); }
    }
    setCommunities(prev => prev.map(c => {
      if (c.id !== communityId) return c;
      return { ...c, communityEntrances: (c.communityEntrances || []).map(e => e.deviceStatus !== 'none' ? { ...e, deviceId: null, device: null, deviceStatus: 'none', isActive: false } : e) };
    }));
    window.alert(`已成功移除 ${removed} 個入口的設備。`);
  };

  const handleMgmtBatchAssignDevices = async (entrances) => {
    const withoutDevice = entrances.filter(e => e.deviceStatus === 'none');
    if (withoutDevice.length === 0) {
      window.alert('所選入口均已綁定設備。');
      return;
    }
    if (!window.confirm(`將為 ${withoutDevice.length} 個未綁定設備的入口自動分配設備，確定繼續？`)) return;
    try {
      const res = await apiClient.get('/tenant/gate-devices');
      const devices = Array.isArray(res?.devices) ? res.devices : [];
      if (devices.length < withoutDevice.length) {
        window.alert(`可用設備不足：需要 ${withoutDevice.length} 個，目前僅有 ${devices.length} 個可用設備。`);
        return;
      }
      let assigned = 0;
      for (let i = 0; i < withoutDevice.length; i++) {
        try {
          await apiClient.put(`/access-entrances/${withoutDevice[i].id}/device`, { deviceId: devices[i].id });
          assigned++;
        } catch (err) { console.error(err); }
      }
      setCommunities(prev => prev.map(c => ({
        ...c,
        communityEntrances: (c.communityEntrances || []).map(e => {
          const idx = withoutDevice.findIndex(ew => ew.id === e.id);
          if (idx < 0) return e;
          return { ...e, deviceId: devices[idx].id, device: devices[idx].uuid, deviceStatus: 'unknown', isActive: true };
        }),
        buildings: (c.buildings || []).map(b => ({
          ...b,
          entrances: (b.entrances || []).map(e => {
            const idx = withoutDevice.findIndex(ew => ew.id === e.id);
            if (idx < 0) return e;
            return { ...e, deviceId: devices[idx].id, device: devices[idx].uuid, deviceStatus: 'unknown', isActive: true };
          }),
        })),
      })));
      window.alert(`已成功為 ${assigned} 個入口分配設備。`);
    } catch (err) { console.error(err); window.alert('操作失敗。'); }
  };

  const handleMgmtBatchRemoveDevices = async (entrances) => {
    const withDevice = entrances.filter(e => e.deviceStatus !== 'none');
    if (withDevice.length === 0) {
      window.alert('所選入口沒有已綁定設備。');
      return;
    }
    if (!window.confirm(`將移除 ${withDevice.length} 個入口的設備綁定，確定繼續？`)) return;
    let removed = 0;
    for (const e of withDevice) {
      try {
        await apiClient.put(`/access-entrances/${e.id}/device`, { deviceId: null });
        removed++;
      } catch (err) { console.error(err); }
    }
    setCommunities(prev => prev.map(c => ({
      ...c,
      communityEntrances: (c.communityEntrances || []).map(e => withDevice.some(w => w.id === e.id) ? { ...e, deviceId: null, device: null, deviceStatus: 'none', isActive: false } : e),
      buildings: (c.buildings || []).map(b => ({
        ...b,
        entrances: (b.entrances || []).map(e => withDevice.some(w => w.id === e.id) ? { ...e, deviceId: null, device: null, deviceStatus: 'none', isActive: false } : e),
      })),
    })));
    window.alert(`已成功移除 ${removed} 個入口的設備。`);
  };

  const handleAssignDevice = async () => {
    if (!deviceEntrance) return;
    const deviceId = selectedDeviceId ? Number(selectedDeviceId) : null;
    try {
      const res = await apiClient.put(`/access-entrances/${deviceEntrance.id}/device`, { deviceId });
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(c => {
          const updEntrance = (list) => (list || []).map(e => e.id === deviceEntrance.id ? { ...e, deviceId, isActive: deviceId ? true : false, device: availableDevices.find(d => d.id === deviceId)?.uuid || null, deviceStatus: deviceId ? 'unknown' : 'none' } : e);
          if (deviceEntrance.buildingId) {
            return { ...c, buildings: (c.buildings || []).map(b => b.id === deviceEntrance.buildingId ? { ...b, entrances: updEntrance(b.entrances) } : b) };
          }
          return { ...c, communityEntrances: updEntrance(c.communityEntrances) };
        }));
        setDeviceDialogOpen(false);
      }
    } catch (err) { console.error(err); }
  };

  const handleAssignSip = async (sipUserId) => {
    if (!assignSipRoom) return;
    const prevSipUserId = assignSipRoom.currentSipUserId;
    try {
      const res = await apiClient.put(`/access-rooms/${assignSipRoom.roomId}/assign-sip`, { sipUserId });
      if (res && res.code === 0) {
        const sipUser = sipUserId ? sipAccounts.find(s => s.id === sipUserId) : null;
        setCommunities(prev => prev.map(c => ({
          ...c,
          buildings: (c.buildings || []).map(b => {
            if (b.id === assignSipRoom.buildingId) {
              return { ...b, rooms: (b.rooms || []).map(r => r.id === assignSipRoom.roomId ? { ...r, sipUserId: sipUserId || null, sipName: sipUser ? (sipUser.displayName || sipUser.username) : null, sipAccount: sipUser ? sipUser.username : null } : r) };
            }
            return b;
          }),
        })));
        // Update sipAccounts cache: old account becomes available, new account becomes assigned
        setSipAccounts(prev => prev.map(s => {
          if (s.id === prevSipUserId) return { ...s, currentRoomId: null };
          if (s.id === sipUserId) return { ...s, currentRoomId: assignSipRoom.roomId };
          return s;
        }));
        setAssignSipRoom(prev => prev ? { ...prev, currentSipUserId: sipUserId || null } : null);
      }
    } catch (error) { console.error('分配 SIP 帳號失敗:', error); }
  };

  const handleDeleteRoom = async (room, buildingId) => {
    if (!window.confirm(`確定要刪除房間「${room.roomNumber}」嗎？此操作無法撤銷。`)) return;
    try {
      const res = await apiClient.delete(`/access-rooms/${room.id}`);
      if (res && res.code === 0) {
        setCommunities(prev => prev.map(c => ({
          ...c,
          buildings: (c.buildings || []).map(b => {
            if (b.id === buildingId) {
              return { ...b, rooms: (b.rooms || []).filter(r => r.id !== room.id) };
            }
            return b;
          }),
        })));
      }
    } catch (error) {
      console.error('刪除房間失敗:', error);
    }
  };

  const handleBatchDeleteRooms = async (buildingId) => {
    const community = communities.find(c => c.buildings?.some(b => b.id === buildingId));
    const building = community?.buildings?.find(b => b.id === buildingId);
    const selected = (building?.rooms || []).filter(r => r._selected);
    if (selected.length === 0) return;
    if (!window.confirm(`確定要刪除 ${selected.length} 個房間嗎？\n\n${selected.map(r => '· ' + r.roomNumber).join('\n')}\n\n此操作無法撤銷。`)) return;

    let errorCount = 0;
    for (const r of selected) {
      try {
        const res = await apiClient.delete(`/access-rooms/${r.id}`);
        if (!res || res.code !== 0) errorCount++;
      } catch { errorCount++; }
    }
    if (errorCount === 0) {
      setCommunities(prev => prev.map(c => ({
        ...c,
        buildings: (c.buildings || []).map(b => {
          if (b.id === buildingId) {
            return { ...b, rooms: (b.rooms || []).filter(r => !r._selected) };
          }
          return b;
        }),
      })));
    } else {
      window.alert(`刪除完成，${errorCount} 個房間刪除失敗。`);
      // Reload to get correct state
      fetchCommunities();
    }
  };

  const handleEntranceCreated = (data) => {
    setCommunities(prev => prev.map(c => {
      if (data.communityId && c.id === data.communityId) {
        return { ...c, communityEntrances: [...(c.communityEntrances || []), data] };
      }
      if (data.buildingId) {
        const updatedBuildings = (c.buildings || []).map(b => {
          if (b.id === data.buildingId) {
            return { ...b, entrances: [...(b.entrances || []), data] };
          }
          return b;
        });
        if (updatedBuildings.some(b => b.id === data.buildingId)) {
          return { ...c, buildings: updatedBuildings };
        }
      }
      return c;
    }));
  };

  const totalStats = {
    communities: communities.length,
    buildings: communities.reduce((s, c) => s + (c.buildings || []).length, 0),
    rooms: communities.reduce((s, c) => s + (c.buildings || []).reduce((a, b) => a + (b.rooms || []).length, 0), 0),
    entrances: communities.reduce((s, c) => s + (c.communityEntrances || []).length + (c.buildings || []).reduce((a, b) => a + (b.entrances || []).length, 0), 0),
  };
  const toggleCommunity = (id) => {
    setExpandedCommunity(expandedCommunity === id ? null : id);
    setExpandedBuilding(null);
  };

  const toggleBuilding = (id) => {
    setExpandedBuilding(expandedBuilding === id ? null : id);
  };

  const openAuthDrawer = (entrance) => {
    setSelectedEntrance(entrance);
    setAuthTab('authorized');
    setAuthSearch('');
    setAuthSort({ field: 'roomNumber', asc: true });
    setShowAuthDrawer(true);
  };

  const getAuthRooms = (entranceId, communityId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return [];
    const authRoomIds = community.authMatrix?.[String(entranceId)] || [];
    const allRooms = [];
    (community.buildings || []).forEach(b => {
      (b.rooms || []).forEach(r => {
        allRooms.push({ ...r, buildingName: b.name, communityName: community.name, communityId: community.id });
      });
    });
    return allRooms.filter(r => authRoomIds.includes(r.id));
  };

  const getUnauthRooms = (entranceId, communityId) => {
    const community = communities.find(c => c.id === communityId);
    if (!community) return [];
    const authRoomIds = community.authMatrix?.[String(entranceId)] || [];
    const allRooms = [];
    (community.buildings || []).forEach(b => {
      (b.rooms || []).forEach(r => {
        allRooms.push({ ...r, buildingName: b.name, communityName: community.name, communityId: community.id });
      });
    });
    return allRooms.filter(r => !authRoomIds.includes(r.id));
  };

  const filteredCommunities = communities;

  return (
    <section className="ac-dashboard">
      <style>{`
        .ac-dashboard {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          padding: 0;
          box-sizing: border-box;
          animation: acFadeIn 0.3s ease-in-out;
        }
        .ac-dashboard * { scrollbar-width: thin; scrollbar-color: #374151 transparent; }
        .ac-dashboard *::-webkit-scrollbar { width: 6px; height: 6px; }
        .ac-dashboard *::-webkit-scrollbar-track { background: transparent; }
        .ac-dashboard *::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        @keyframes acFadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .ac-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(0,0,0,0.18);
          flex-shrink: 0;
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ac-toolbar::-webkit-scrollbar { height: 0; }
        .ac-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        .ac-search {
          position: relative;
          width: 260px;
          flex: 0 0 260px;
        }
        .ac-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #6b7280;
          pointer-events: none;
        }
        .ac-search input {
          height: 46px;
          border: 1px solid #374151;
          border-radius: 9px;
          font-size: 13px;
          outline: none;
          background: #111827;
          color: #e5e7eb;
          box-sizing: border-box;
          width: 100%;
          padding: 0 16px 0 44px;
        }
        .ac-search input::placeholder { color: #6b7280; }
        .ac-search input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }

        .ac-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .ac-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          background: #1a2332;
          border: 1px solid #1f2937;
          color: #9ca3af;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .ac-stat-pill strong {
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 700;
        }

        .ac-panel {
          background: #111827;
          border-radius: 16px;
          border: 1px solid #1f2937;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .ac-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid #1f2937;
          padding: 0 24px;
          flex-shrink: 0;
        }
        .ac-tab {
          padding: 14px 24px;
          font-size: 14px;
          font-weight: 500;
          color: #9ca3af;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: all 0.2s;
          background: none;
          border-top: 0;
          border-left: 0;
          border-right: 0;
        }
        .ac-tab.active { color: #60a5fa; border-bottom-color: #60a5fa; }

        .ac-list-wrap {
          flex: 1;
          overflow: auto;
          padding: 24px;
        }

        .ac-community-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          margin-bottom: 16px;
          overflow: hidden;
          transition: box-shadow 0.2s;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
        .ac-community-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.2); }

        .ac-community-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s;
        }
        .ac-community-header:hover { background: #1a2332; }
        .ac-community-info {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .ac-community-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #1e293b;
          color: #60a5fa;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .ac-community-name { font-size: 16px; font-weight: 600; color: #f3f4f6; }
        .ac-community-address { font-size: 13px; color: #9ca3af; margin-top: 2px; }

        .ac-community-meta {
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .ac-meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: #9ca3af;
        }

        .ac-expand-body {
          border-top: 1px solid #1f2937;
          background: #0d1117;
        }
        .ac-section-label {
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 18px 24px 10px;
        }

        .ac-building-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          margin: 0 24px 14px;
          overflow: hidden;
        }
        .ac-building-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .ac-building-header:hover { background: #1a2332; }
        .ac-building-name {
          font-size: 15px;
          font-weight: 600;
          color: #f3f4f6;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ac-table-wrap {
          overflow: auto;
          max-height: 360px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ac-table-wrap::-webkit-scrollbar { display: none; }
        .ac-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .ac-table thead th {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #1a2332;
          color: #9ca3af;
          font-weight: 600;
          font-size: 12px;
          padding: 10px 16px;
          white-space: nowrap;
          letter-spacing: 0.03em;
        }
        .ac-table td {
          padding: 10px 16px;
          border-top: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 13px;
          background: #111827;
        }
        .ac-table tr:hover td { background: #1a2332; }
        .ac-table th:last-child {
          position: sticky;
          right: 0;
          z-index: 3;
          box-shadow: -2px 0 4px rgba(0,0,0,0.15);
        }
        .ac-table td:last-child {
          position: sticky;
          right: 0;
          z-index: 1;
          box-shadow: -2px 0 4px rgba(0,0,0,0.15);
        }
        .ac-table tr:hover td:last-child { background: #1a2332; }

        .ac-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }
        .ac-badge.online { background: #0f2818; color: #22c55e; }
        .ac-badge.offline { background: #2d1111; color: #ef4444; }
        .ac-badge.unknown { background: #1a2332; color: #9ca3af; }
        .ac-badge.none { background: #1a2332; color: #9ca3af; }
        .ac-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .ac-badge.online .ac-badge-dot { background: #22c55e; }
        .ac-badge.offline .ac-badge-dot { background: #ef4444; }
        .ac-badge.unknown .ac-badge-dot { background: #6b7280; }
        .ac-badge.none .ac-badge-dot { background: #6b7280; }

        .ac-btn-sm {
          height: 32px;
          padding: 0 14px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid #374151;
          background: #111827;
          color: #9ca3af;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .ac-btn-sm:hover { background: #1a2332; color: #e5e7eb; }

        .ac-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 10px 14px;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 13px;
          color: #e5e7eb;
          white-space: nowrap;
        }
        .ac-dropdown-item:hover { background: #111827; }

        .ac-empty {
          text-align: center;
          padding: 40px;
          color: #9ca3af;
          font-size: 14px;
        }

        .ac-drawer-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0,0,0,0.6);
          animation: acOverlayIn 0.2s ease-out;
        }
        @keyframes acOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        .ac-drawer {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          width: 640px;
          max-width: 90vw;
          background: #111827;
          z-index: 1001;
          box-shadow: -8px 0 32px rgba(0,0,0,0.3);
          display: flex;
          flex-direction: column;
          animation: acDrawerIn 0.25s ease-out;
          border-left: 1px solid #1f2937;
        }
        @keyframes acDrawerIn {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .ac-drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid #1f2937;
          flex-shrink: 0;
        }
        .ac-drawer-header h3 {
          font-size: 18px;
          font-weight: 600;
          color: #f3f4f6;
          margin: 0;
        }
        .ac-drawer-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
        }
        .ac-drawer-body h4 {
          font-size: 14px;
          font-weight: 600;
          color: #f3f4f6;
          margin: 0 0 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ac-room-check-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 8px;
        }
        .ac-room-check-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border: 1px solid #1f2937;
          border-radius: 8px;
          font-size: 13px;
          color: #e5e7eb;
          cursor: pointer;
          transition: all 0.15s;
          background: #111827;
        }
        .ac-room-check-item:hover { border-color: #60a5fa; background: #1a2332; }
        .ac-room-check-item input[type="checkbox"] {
          accent-color: #3b82f6;
          cursor: pointer;
        }
        .ac-room-meta {
          font-size: 11px;
          color: #9ca3af;
        }

        @media (max-width: 1200px) {
          .ac-stats { flex-wrap: wrap; }
        }
        @media (max-width: 768px) {
          .ac-drawer { width: 100vw; max-width: 100vw; }
          .ac-room-check-grid { grid-template-columns: 1fr; }
          .ac-toolbar { flex-wrap: wrap; }
          .ac-stats { justify-content: flex-start; }
        }
      `}</style>

      {/* 查询与统计工具栏 */}
      <div className="ac-toolbar">
        <div className="ac-filter-left">
          <label className="ac-search">
            <Search size={18} />
            <input
              type="search"
              placeholder="搜尋社區名稱或地址..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </label>
        </div>
        <div className="ac-stats">
          <span className="ac-stat-pill">社區總數<strong>{totalStats.communities}</strong></span>
          <span className="ac-stat-pill">樓宇總數<strong style={{ color: '#16a34a' }}>{totalStats.buildings}</strong></span>
          <span className="ac-stat-pill">房間總數<strong style={{ color: '#ca8a04' }}>{totalStats.rooms}</strong></span>
          <span className="ac-stat-pill">入口總數<strong style={{ color: '#3b82f6' }}>{boundDeviceCount}/{totalStats.entrances}</strong></span>
          <span className="ac-stat-pill">設備數量<strong style={{ color: '#16a34a' }}>{boundDeviceCount}/{deviceStats.total}</strong></span>
        </div>
      </div>

      {/* 主面板 */}
      <div className="ac-panel">
        <div className="ac-tabs">
          {[
            { id: 'overview', label: '社區列表' },
            { id: 'buildings', label: '樓宇管理' },
            { id: 'entrances', label: '入口管理' },
            { id: 'auth', label: '權限設置' },
            { id: 'gateDevices', label: '門控設備' },
          ].map(tab => (
            <button
              key={tab.id}
              className={`ac-tab${activeTab === tab.id ? ' active' : ''}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ac-list-wrap">
          {loading ? (
            <div className="ac-empty">數據加載中...</div>
          ) : filteredCommunities.length === 0 ? (
            <div className="ac-empty">暫無社區數據，請點擊右上角「新增社區」按鈕添加</div>
          ) : activeTab === 'buildings' ? (
            /* 樓宇管理標籤頁 */
            (() => {
              const allBuildings = communities.flatMap(c => (c.buildings || []).map(b => ({ ...b, communityName: c.name, communityId: c.id, community: c })));
              return allBuildings.length === 0 ? (
                <div className="ac-empty">暫無樓宇數據，請在社區列表中添加樓宇</div>
              ) : (
                <>
                  <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="ac-stat-pill">樓宇總數<strong style={{ color: '#16a34a' }}>{allBuildings.length}</strong></span>
                  </div>
                  {communities.filter(c => (c.buildings || []).length > 0 || (activeTab === 'buildings')).map(c => (
                    <div key={c.id} style={{ marginBottom: '20px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Building size={16} color="#2563eb" /> {c.name}
                          <span style={{ fontSize: '12px', fontWeight: 400, color: '#9ca3af' }}>{(c.buildings || []).length} 棟樓宇</span>
                        </div>
                        <button className="ac-btn-sm" type="button" onClick={() => addBuildingDialogRef.current?.showModal({ id: c.id, community: { name: c.name, address: c.address, latitude: c.latitude, longitude: c.longitude, serviceScope: c.serviceScope, contactPerson: c.contactPerson, contactPhone: c.contactPhone, contactEmail: c.contactEmail } })}><Plus size={12} /> 新增樓宇</button>
                      </div>
                      {(c.buildings || []).length === 0 && (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', background: '#1a2332', borderRadius: '10px' }}>暫無樓宇</div>
                      )}
                      {(c.buildings || []).length > 0 && (
                        <div className="ac-table-wrap" style={{ maxHeight: 'none' }}>
                          <table className="ac-table" style={{ minWidth: '700px' }}>
                            <thead>
                              <tr>
                                <th>樓宇名稱</th>
                                <th>地址</th>
                                <th style={{ width: '80px' }}>房間</th>
                                <th style={{ width: '80px' }}>入口</th>
                                <th style={{ width: '150px' }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(c.buildings || []).map(b => (
                                <tr key={b.id}>
                                  <td style={{ fontWeight: 600 }}>{b.name}</td>
                                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.address || ''}>{b.address || '—'}</td>
                                  <td style={{ textAlign: 'center' }}>{(b.rooms || []).length}</td>
                                  <td style={{ textAlign: 'center' }}>{(b.entrances || []).length}</td>
                                  <td>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => { addBuildingDialogRef.current?.showModal({ id: c.id, community: { name: c.name, address: c.address, latitude: c.latitude, longitude: c.longitude, serviceScope: c.serviceScope, contactPerson: c.contactPerson, contactPhone: c.contactPhone, contactEmail: c.contactEmail } }, { id: b.id, name: b.name, address: b.address, latitude: b.latitude, longitude: b.longitude, serviceScope: b.serviceScope, contactPerson: b.contactPerson, contactPhone: b.contactPhone, contactEmail: b.contactEmail }); }}>✎ 編輯</button>
                                      <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => setViewRoomsBuilding({ buildingId: b.id, buildingName: b.name, rooms: b.rooms || [] })}>🏠 房間</button>
                                      <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626' }} onClick={() => handleDeleteBuilding(b, c.id)}>✕ 刪除</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              );
            })()
          ) : activeTab === 'entrances' ? (
            /* 入口管理標籤頁 */
            (() => {
              const allEntrances = communities.flatMap(c => {
                const communityEntrances = (c.communityEntrances || []).map(e => ({ ...e, belongType: 'community', belongName: c.name, communityId: c.id, buildingId: null }));
                const buildingEntrances = (c.buildings || []).flatMap(b => (b.entrances || []).map(e => ({ ...e, belongType: 'building', belongName: b.name, communityId: c.id, buildingId: b.id })));
                return [...communityEntrances, ...buildingEntrances];
              });
              const filtered = allEntrances.filter(e => {
                if (entranceLevelFilter !== 'all' && e.belongType !== entranceLevelFilter) return false;
                if (entranceStatusFilter !== 'all') {
                  if (entranceStatusFilter === 'none' && e.deviceStatus !== 'none') return false;
                  if (entranceStatusFilter === 'active' && (e.deviceStatus === 'none' || e.isActive === false)) return false;
                  if (entranceStatusFilter === 'inactive' && (e.deviceStatus === 'none' || e.isActive !== false)) return false;
                }
                if (entranceSearch) {
                  const q = entranceSearch.toLowerCase();
                  return (e.name || '').toLowerCase().includes(q) ||
                    (e.belongName || '').toLowerCase().includes(q) ||
                    (e.device || '').toLowerCase().includes(q);
                }
                return true;
              });
              if (allEntrances.length === 0) return (<div className="ac-empty">暫無入口數據，請在社區或樓宇中添加入口</div>);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="ac-stat-pill">總計<strong style={{ color: '#3b82f6' }}>{allEntrances.length}</strong></span>
                      <span className="ac-stat-pill">在線<strong style={{ color: '#16a34a' }}>{allEntrances.filter(e => e.deviceStatus === 'online').length}</strong></span>
                      {(entranceSearch || entranceStatusFilter !== 'all' || entranceLevelFilter !== 'all') && (
                        <span className="ac-stat-pill">篩選<strong style={{ color: '#8b5cf6' }}>{filtered.length}</strong></span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <select value={entranceStatusFilter} onChange={(e) => setEntranceStatusFilter(e.target.value)}
                        style={{ height: '34px', padding: '0 10px', border: '1px solid #d8e2ef', borderRadius: '7px', fontSize: '12px', color: '#475569', background: '#fff', outline: 'none', cursor: 'pointer' }}>
                        <option value="all">全部狀態</option>
                        <option value="active">已啟用</option>
                        <option value="inactive">已停用</option>
                        <option value="none">未綁定</option>
                      </select>
                      <select value={entranceLevelFilter} onChange={(e) => setEntranceLevelFilter(e.target.value)}
                        style={{ height: '34px', padding: '0 10px', border: '1px solid #d8e2ef', borderRadius: '7px', fontSize: '12px', color: '#475569', background: '#fff', outline: 'none', cursor: 'pointer' }}>
                        <option value="all">全部層級</option>
                        <option value="community">社區級</option>
                        <option value="building">樓宇級</option>
                      </select>
                      <button className="ac-btn-sm" type="button" style={{ whiteSpace: 'nowrap' }} onClick={() => handleMgmtBatchAssignDevices(filtered)}>📡 批量分配設備</button>
                      <button className="ac-btn-sm" type="button" style={{ whiteSpace: 'nowrap', color: '#dc2626' }} onClick={() => handleMgmtBatchRemoveDevices(filtered)}>📡 批量取消設備</button>
                      <div className="ac-search" style={{ width: '200px', flex: 'none' }}>
                        <Search size={16} />
                        <input type="search" placeholder="搜尋入口名稱..." value={entranceSearch} onChange={(e) => setEntranceSearch(e.target.value)}
                          style={{ height: '36px', padding: '0 16px 0 40px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '13px', outline: 'none', color: '#e5e7eb', boxSizing: 'border-box', width: '100%' }} />
                      </div>
                    </div>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="ac-empty">無匹配入口</div>
                  ) : (
                  <div style={{ flex: 1, overflow: 'auto', minHeight: 0, scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                    <style>{`.entrance-mgmt-table::-webkit-scrollbar { width: 6px; height: 6px; } .entrance-mgmt-table::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }`}</style>
                    <table className="ac-table" style={{ minWidth: '940px' }}>
                      <thead>
                        <tr>
                          <th>入口名稱</th>
                          <th>所屬</th>
                          <th>所屬樓宇/社區</th>
                          <th>綁定設備</th>
                          <th style={{ width: '90px', whiteSpace: 'nowrap' }}>狀態</th>
                          <th style={{ width: '80px' }}>授權用戶</th>
                          <th style={{ width: '200px' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(e => (
                          <tr key={`${e.belongType}-${e.id}`}>
                            <td style={{ fontWeight: 600, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                            <td style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>{e.belongType === 'building' ? '樓宇級' : '社區級'}</td>
                            <td style={{ fontSize: '12px', color: '#9ca3af', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.belongName}>{e.belongName}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.device || ''}>{e.device || '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {e.deviceStatus === 'none' ? (
                                <span className="ac-badge none"><span className="ac-badge-dot" />未綁定</span>
                              ) : (
                                <span className={`ac-badge ${e.isActive !== false ? 'online' : 'offline'}`}>
                                  <span className="ac-badge-dot" />
                                  {e.isActive !== false ? '啟用' : '停用'}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 500 }}>{e.authCount ?? 0}</td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => {
                                  const ctx = e.belongType === 'building' ? { type: 'building', id: e.buildingId, label: e.belongName, community: (communities.find(c => c.id === e.communityId) || {}) }
                                    : { type: 'community', id: e.communityId, label: e.belongName, community: (communities.find(c => c.id === e.communityId) || {}) };
                                  addEntranceDialogRef.current?.showModal(ctx, e);
                                }}>✎ 編輯</button>
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => openAuthDrawer({ ...e, communityId: e.communityId })}>🔑 授權</button>
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => openDeviceDialog({ ...e, buildingId: e.buildingId || undefined }, e.communityId)}>📡 設備</button>
                                {e.device && <>
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => { var type = e.buildingId ? '02' : '01'; window.open((import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin) + '/access/visitor?type=' + type + '&lockId=' + encodeURIComponent(e.device), '_blank'); }}>🌐 預覽</button>
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => { var type = e.buildingId ? '02' : '01'; var url = (import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin) + '/access/visitor?type=' + type + '&lockId=' + encodeURIComponent(e.device); setQrDialog({ url: url, title: e.name, filename: (e.belongName || 'community') + '-' + e.name + '-' + (e.device || 'device') + '-qrcode' }); }}>🔗 鏈接</button>
                                </>}
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626' }} onClick={() => handleDeleteEntrance(e, e.communityId, e.buildingId)}>✕ 刪除</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              );
            })()
          ) : activeTab === 'auth' ? (
            /* 權限設置標籤頁 */
            (() => {
              const allEntrances = communities.flatMap(c => {
                const communityEntrances = (c.communityEntrances || []).map(e => ({ ...e, belongType: 'community', belongName: c.name, communityId: c.id, community: c }));
                const buildingEntrances = (c.buildings || []).flatMap(b => (b.entrances || []).map(e => ({ ...e, belongType: 'building', belongName: b.name, communityId: c.id, buildingId: b.id, community: c })));
                return [...communityEntrances, ...buildingEntrances];
              });
              const filteredEntrances = authPageSearch
                ? allEntrances.filter(e => (e.name || '').toLowerCase().includes(authPageSearch.toLowerCase()) || (e.belongName || '').toLowerCase().includes(authPageSearch.toLowerCase()))
                : allEntrances;
              const selectedEntrance = authPageSelected ? allEntrances.find(e => `${e.belongType}-${e.id}` === `${authPageSelected.belongType}-${authPageSelected.id}`) : null;
              const community = selectedEntrance ? communities.find(c => c.id === selectedEntrance.communityId) : null;
              const authRoomIds = selectedEntrance ? new Set((community?.authMatrix?.[String(selectedEntrance.id)] || [])) : new Set();
              const allRooms = selectedEntrance ? (community?.buildings || []).flatMap(b => (b.rooms || []).map(r => ({ ...r, buildingName: b.name, buildingId: b.id }))) : [];
              const authRooms = allRooms.filter(r => authRoomIds.has(r.id));
              const unauthRooms = allRooms.filter(r => !authRoomIds.has(r.id));
              const handleAuthRoomToggle = async (roomId, authorize) => {
                if (!selectedEntrance) return;
                try {
                  if (authorize) {
                    await apiClient.post(`/access-entrances/${selectedEntrance.id}/auth/rooms`, { roomIds: [roomId] });
                  } else {
                    await apiClient.delete(`/access-entrances/${selectedEntrance.id}/auth/rooms`, { data: { roomIds: [roomId] } });
                  }
                  setCommunities(prev => prev.map(c2 => {
                    if (c2.id === selectedEntrance.communityId) {
                      const auth = { ...(c2.authMatrix || {}) };
                      const key = String(selectedEntrance.id);
                      if (authorize) {
                        auth[key] = [...new Set([...(auth[key] || []), roomId])];
                      } else {
                        auth[key] = (auth[key] || []).filter(id => id !== roomId);
                      }
                      return { ...c2, authMatrix: auth };
                    }
                    return c2;
                  }));
                } catch (err) { console.error(err); }
              };
              return (
                <div style={{ display: 'flex', gap: '16px', height: '100%', minHeight: 0 }}>
                  {/* 左側：入口列表 */}
                  <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6', marginBottom: '10px' }}>入口列表 ({allEntrances.length})</div>
                      <div className="ac-search" style={{ width: '100%', flex: 'none' }}>
                        <Search size={14} />
                        <input type="search" placeholder="搜尋入口..." value={authPageSearch} onChange={(e) => setAuthPageSearch(e.target.value)}
                          style={{ height: '34px', padding: '0 12px 0 36px', border: '1px solid #d8e2ef', borderRadius: '7px', fontSize: '12px', outline: 'none', color: '#e5e7eb', boxSizing: 'border-box', width: '100%' }} />
                      </div>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      {filteredEntrances.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>{authPageSearch ? '無匹配入口' : '暫無入口'}</div>
                      ) : (
                        filteredEntrances.map(e => {
                          const isSel = authPageSelected && authPageSelected.belongType === e.belongType && authPageSelected.id === e.id;
                          const authCount = (e.community?.authMatrix?.[String(e.id)] || []).length;
                          return (
                            <div key={`${e.belongType}-${e.id}`}
                              style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isSel ? '#eff6ff' : '#fff', transition: 'background 0.1s' }}
                              onClick={() => setAuthPageSelected(e)}
                              onMouseEnter={(ev) => { if (!isSel) ev.currentTarget.style.background = '#f8fafc'; }}
                              onMouseLeave={(ev) => { if (!isSel) ev.currentTarget.style.background = '#fff'; }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                                {e.belongName} · {e.belongType === 'building' ? '樓宇級' : '社區級'} · {authCount} 授權
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  {/* 右側：房間列表 */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', background: '#fff', minWidth: 0 }}>
                    {!selectedEntrance ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '14px' }}>
                        請從左側選擇一個入口
                      </div>
                    ) : (
                      <>
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6', minWidth: 0 }}>
                              {selectedEntrance.name}
                              <span style={{ fontSize: '12px', fontWeight: 400, color: '#9ca3af', marginLeft: '8px' }}>
                                {selectedEntrance.belongName} · 已授權 {authRooms.length}/{allRooms.length} 房間
                              </span>
                            </div>
                            {allRooms.length > 0 && (
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }}
                                  onClick={async () => {
                                    const ids = unauthRooms.map(r => r.id);
                                    if (ids.length === 0) return;
                                    try {
                                      await apiClient.post(`/access-entrances/${selectedEntrance.id}/auth/rooms`, { roomIds: ids });
                                      setCommunities(prev => prev.map(c2 => {
                                        if (c2.id === selectedEntrance.communityId) {
                                          const auth = { ...(c2.authMatrix || {}) };
                                          const key = String(selectedEntrance.id);
                                          auth[key] = [...new Set([...(auth[key] || []), ...ids])];
                                          return { ...c2, authMatrix: auth };
                                        }
                                        return c2;
                                      }));
                                    } catch (err) { console.error(err); }
                                  }}>✓ 全部授權</button>
                                <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626' }}
                                  onClick={async () => {
                                    const ids = authRooms.map(r => r.id);
                                    if (ids.length === 0) return;
                                    try {
                                      await apiClient.delete(`/access-entrances/${selectedEntrance.id}/auth/rooms`, { data: { roomIds: ids } });
                                      setCommunities(prev => prev.map(c2 => {
                                        if (c2.id === selectedEntrance.communityId) {
                                          const auth = { ...(c2.authMatrix || {}) };
                                          const key = String(selectedEntrance.id);
                                          auth[key] = (auth[key] || []).filter(id => !ids.includes(id));
                                          return { ...c2, authMatrix: auth };
                                        }
                                        return c2;
                                      }));
                                    } catch (err) { console.error(err); }
                                  }}>✕ 全部取消</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
                          {allRooms.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>暫無房間</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {allRooms.map(r => {
                                const isAuth = authRoomIds.has(r.id);
                                return (
                                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '8px', border: '1px solid #1f2937', background: isAuth ? '#f0fdf4' : '#fff' }}>
                                    <div>
                                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{r.roomNumber}</span>
                                      <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>{r.buildingName}</span>
                                      <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '6px' }}>{r.sipName || ''}</span>
                                    </div>
                                    <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '26px', color: isAuth ? '#dc2626' : '#2563eb' }}
                                      onClick={() => handleAuthRoomToggle(r.id, !isAuth)}>
                                      {isAuth ? '✕ 取消' : '+ 授權'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()
          ) : activeTab === 'gateDevices' ? (
            /* 門控設備標籤頁 */
            gateDeviceLoading ? <div className="ac-empty">載入中...</div> : gateDeviceList.length === 0 ? <div className="ac-empty">暫無設備數據</div> : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span className="ac-stat-pill">設備總數<strong>{gateDeviceList.length}</strong></span>
                  <span className="ac-stat-pill">已分配<strong style={{ color: '#2563eb' }}>{gateDeviceList.filter(d => d.status === 'assigned').length}</strong></span>
                  <span className="ac-stat-pill">未分配<strong style={{ color: '#9ca3af' }}>{gateDeviceList.filter(d => d.status === 'unassigned').length}</strong></span>
                  <span className="ac-stat-pill">已綁定入口<strong style={{ color: '#16a34a' }}>{gateDeviceList.filter(d => d.boundEntrance).length}</strong></span>
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  <table className="ac-table" style={{ minWidth: '900px' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '200px' }}>設備 UUID</th>
                        <th style={{ width: '90px', whiteSpace: 'nowrap' }}>狀態</th>
                        <th style={{ width: '110px', whiteSpace: 'nowrap' }}>分配日期</th>
                        <th style={{ width: '90px', whiteSpace: 'nowrap' }}>在線狀態</th>
                        <th style={{ width: '110px', whiteSpace: 'nowrap' }}>到期日期</th>
                        <th style={{ width: '160px' }}>綁定入口</th>
                        <th style={{ width: '160px' }}>所屬樓宇/社區</th>
                        <th style={{ width: '100px' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gateDeviceList.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.uuid}>{d.uuid}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`ac-badge ${d.status === 'assigned' ? 'online' : 'none'}`}>
                              <span className="ac-badge-dot" />
                              {d.status === 'assigned' ? '已分配' : '未分配'}
                            </span>
                          </td>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{d.assignedAt || '—'}</td>
                          <td style={{ whiteSpace: 'nowrap', color: '#9ca3af' }}>—</td>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{d.expiresAt || '—'}</td>
                          <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.boundEntrance?.name || ''}>{d.boundEntrance ? d.boundEntrance.name : '—'}</td>
                          <td style={{ fontSize: '12px', color: '#9ca3af', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.boundEntrance?.belongName || ''}>{d.boundEntrance ? d.boundEntrance.belongName : '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => {
                                // Find entrance and open device dialog for this device
                                let ent = null, cid = null;
                                communities.forEach(c => {
                                  (c.communityEntrances || []).forEach(e => { if (e.deviceId === d.id) { ent = e; cid = c.id; } });
                                  (c.buildings || []).forEach(b => (b.entrances || []).forEach(e => { if (e.deviceId === d.id) { ent = e; cid = c.id; } }));
                                });
                                if (ent) openDeviceDialog(ent, cid);
                              }}>📡 分配</button>
                              <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => {
                                let ent = null, cid = null;
                                communities.forEach(c => {
                                  (c.communityEntrances || []).forEach(e => { if (e.deviceId === d.id) { ent = e; cid = c.id; } });
                                  (c.buildings || []).forEach(b => (b.entrances || []).forEach(e => { if (e.deviceId === d.id) { ent = e; cid = c.id; } }));
                                });
                                if (ent) openAuthDrawer({ ...ent, communityId: cid });
                              }}>🔑 權限</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          ) : (
            filteredCommunities.map(c => (
              <div key={c.id} className="ac-community-card">
                <div className="ac-community-header" onClick={() => toggleCommunity(c.id)}>
                  <div className="ac-community-info">
                    <div className="ac-community-icon"><Building size={22} /></div>
                    <div>
                      <div className="ac-community-name">{c.name}{c.isActive === false && <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af', background: '#f1f5f9', padding: '2px 8px', borderRadius: '10px', marginLeft: '8px', verticalAlign: 'middle' }}>已停用</span>}</div>
                      <div className="ac-community-address">{c.address || '—'}</div>
                    </div>
                  </div>
                  <div className="ac-community-meta">
                    <div style={{ position: 'relative' }}>
                      <button ref={(el) => { if (el) el._dropdownTrigger = el; }} className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); const rect = ev.currentTarget.getBoundingClientRect(); const menuHeight = 185; const showAbove = rect.bottom + 4 + menuHeight > window.innerHeight; setDropdownOpen(dropdownOpen && dropdownOpen.id === c.id ? null : { id: c.id, top: showAbove ? undefined : rect.bottom + 4, bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined, right: window.innerWidth - rect.right }); }} style={{ marginRight: '4px' }}><MoreHorizontal size={14} /></button>
                    </div>
                    <span className="ac-meta-item"><Home size={14} />{(c.buildings || []).length} 棟樓宇</span>
                    <span className="ac-meta-item"><DoorOpen size={14} />{(c.buildings || []).reduce((a,b) => a + (b.rooms || []).length, 0)} 房間</span>
                    <span className="ac-meta-item"><Shield size={14} />{(c.communityEntrances || []).length + (c.buildings || []).reduce((a,b) => a + (b.entrances || []).length, 0)} 入口</span>
                    {expandedCommunity === c.id ? <ChevronDown size={18} color="#94a3b8" /> : <ChevronRight size={18} color="#94a3b8" />}
                  </div>
                </div>

                {expandedCommunity === c.id && (
                  <div className="ac-expand-body">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '24px' }}>
                      <div className="ac-section-label">社區級入口</div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => addEntranceDialogRef.current?.showModal({ type: 'community', id: c.id, label: c.name, community: { address: c.address, latitude: c.latitude, longitude: c.longitude, serviceScope: c.serviceScope, contactPerson: c.contactPerson, contactPhone: c.contactPhone, contactEmail: c.contactEmail } })}><Plus size={12} /> 添加入口</button>
                        <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => handleBatchAssignDevices(c.id)}>📡 批量分配設備</button>
                        <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px', color: '#dc2626' }} onClick={() => handleBatchRemoveDevices(c.id)}>📡 批量取消設備</button>
                        <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => window.alert('開發中')}>🧪 測試</button>
                      </div>
                    </div>
                    {(c.communityEntrances || []).length > 0 && (
                      <div style={{ padding: '0 24px 8px' }}>
                          <div className="ac-table-wrap">
                            <table className="ac-table">
                              <thead>
                                <tr>
                                  <th>入口名稱</th>
                                  <th>綁定設備</th>
                                  <th>設備狀態</th>
                                  <th style={{ width: '90px', whiteSpace: 'nowrap' }}>狀態</th>
                                  <th style={{ width: '80px' }}>授權用戶</th>
                                  <th style={{ width: '100px' }}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.communityEntrances.map(e => (
                                  <tr key={e.id}>
                                    <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                                    <td>{e.device}</td>
                                    <td>
                                      <span className={`ac-badge ${e.deviceStatus}`}>
                                        <span className="ac-badge-dot" />
                                        {e.deviceStatus === 'online' ? '在線' : e.deviceStatus === 'offline' ? '離線' : '—'}
                                      </span>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap' }}>
                                      {e.deviceStatus === 'none' ? (
                                        <span className="ac-badge none"><span className="ac-badge-dot" />未綁定</span>
                                      ) : (
                                        <span className={`ac-badge ${e.isActive !== false ? 'online' : 'offline'}`}>
                                          <span className="ac-badge-dot" />
                                          {e.isActive !== false ? '啟用' : '停用'}
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ textAlign: 'center', fontWeight: 500 }}>{e.authCount ?? 0}</td>
                                    <td>
                                      <div style={{ position: 'relative' }}>
                                        <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); const rect = ev.currentTarget.getBoundingClientRect(); const menuHeight = 185; const showAbove = rect.bottom + 4 + menuHeight > window.innerHeight; setEntranceDropdownOpen(entranceDropdownOpen && entranceDropdownOpen.id === e.id ? null : { id: e.id, communityId: c.id, buildingId: null, top: showAbove ? undefined : rect.bottom + 4, bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined, right: window.innerWidth - rect.right }); }}>
                                          <MoreHorizontal size={14} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '24px' }}>
                      <div className="ac-section-label">樓宇</div>
                      <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => addBuildingDialogRef.current?.showModal({ id: c.id, community: { name: c.name, address: c.address, latitude: c.latitude, longitude: c.longitude, serviceScope: c.serviceScope, contactPerson: c.contactPerson, contactPhone: c.contactPhone, contactEmail: c.contactEmail } })}><Plus size={12} /> 添加樓宇</button>
                    </div>
                    {(c.buildings || []).map(b => (
                      <div key={b.id} className="ac-building-card">
                        <div className="ac-building-header" onClick={() => toggleBuilding(b.id)}>
                          <span className="ac-building-name">
                            <Home size={16} color="#2563eb" /> {b.name}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <span style={{ fontSize: '12px', color: '#9ca3af' }}>{(b.rooms || []).length} 房間 · {(b.entrances || []).length} 入口</span>
                              <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); const rect = ev.currentTarget.getBoundingClientRect(); const menuHeight = 185; const showAbove = rect.bottom + 4 + menuHeight > window.innerHeight; setBuildingDropdownOpen(buildingDropdownOpen && buildingDropdownOpen.id === b.id ? null : { id: b.id, communityId: c.id, top: showAbove ? undefined : rect.bottom + 4, bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined, right: window.innerWidth - rect.right }); }}>
                                <MoreHorizontal size={14} />
                              </button>
                            {expandedBuilding === b.id ? <ChevronDown size={16} color="#94a3b8" /> : <ChevronRight size={16} color="#94a3b8" />}
                          </div>
                        </div>

                        {expandedBuilding === b.id && (
                          <div style={{ borderTop: '1px solid #e2e8f0', padding: '12px 20px 16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}><DoorOpen size={14} /> 房間列表</h4>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    {(() => { const selCount = (b.rooms || []).filter(r => r._selected).length; return (
                                      <button className="ac-btn-sm" type="button" disabled={selCount === 0} style={{ opacity: selCount === 0 ? 0.4 : 1, color: selCount > 0 ? '#dc2626' : undefined }} onClick={(ev) => { ev.stopPropagation(); handleBatchDeleteRooms(b.id); }}>✕ 批量刪除{selCount > 0 ? ` (${selCount})` : ''}</button>
                                    ); })()}
                                    <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); addRoomDialogRef.current?.showModal({ buildingId: b.id, buildingLabel: b.name }); }}><Plus size={12} /> 添加房間</button>
                                  </div>
                                </div>
                                <style>{`.room-table-wrap::-webkit-scrollbar { width: 6px; height: 6px; } .room-table-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; } .room-table-wrap::-webkit-scrollbar-track { background: transparent; }`}</style>
                                <div className="room-table-wrap" style={{ width: '100%', overflow: 'auto', maxHeight: '280px', scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                                  <table className="ac-table" style={{ minWidth: '540px' }}>
                                    <thead>
                                      <tr>
                                        <th style={{ width: '36px' }}><input type="checkbox" style={{ accentColor: '#2563eb' }} onChange={(e) => { const checked = e.target.checked; setCommunities(prev => prev.map(c => ({ ...c, buildings: (c.buildings || []).map(b2 => b2.id === b.id ? { ...b2, rooms: (b2.rooms || []).map(r => ({ ...r, _selected: checked })) } : b2) }))); }} /></th>
                                        {['roomNumber','floor','sipAccount','sipName'].map(field => {
                                          const label = { roomNumber: '房間號', floor: '樓層', sipAccount: 'SIP 帳號', sipName: '住戶' }[field];
                                          const cur = roomSort[b.id] || { field: 'roomNumber', asc: true };
                                          const active = cur.field === field;
                                          return <th key={field} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setRoomSort(prev => ({ ...prev, [b.id]: { field, asc: active ? !cur.asc : true } }))}>{label} {active ? (cur.asc ? '▲' : '▼') : '⇅'}</th>;
                                        })}
                                        <th style={{ width: '60px' }}>操作</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...(b.rooms || [])].sort((a, b2) => {
                                        const cur = roomSort[b.id] || { field: 'roomNumber', asc: true };
                                        const va = (a[cur.field] || '').toString().toLowerCase();
                                        const vb = (b2[cur.field] || '').toString().toLowerCase();
                                        return cur.asc ? va.localeCompare(vb) : vb.localeCompare(va);
                                      }).map(r => (
                                        <tr key={r.id}>
                                          <td><input type="checkbox" checked={!!r._selected} style={{ accentColor: '#2563eb' }} onChange={(e) => { const checked = e.target.checked; setCommunities(prev => prev.map(c => ({ ...c, buildings: (c.buildings || []).map(b2 => b2.id === b.id ? { ...b2, rooms: (b2.rooms || []).map(r2 => r2.id === r.id ? { ...r2, _selected: checked } : r2) } : b2) }))); }} /></td>
                                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.roomNumber}</td>
                                          <td style={{ whiteSpace: 'nowrap' }}>{r.floor || '—'}</td>
                                          <td style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap' }}>{r.sipAccount || '—'}</td>
                                          <td style={{ whiteSpace: 'nowrap' }}>{r.sipName || '—'}</td>
                                          <td>
                                            <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); const rect = ev.currentTarget.getBoundingClientRect(); const menuHeight = 185; const showAbove = rect.bottom + 4 + menuHeight > window.innerHeight; setRoomDropdownOpen(roomDropdownOpen && roomDropdownOpen.id === r.id ? null : { id: r.id, buildingId: b.id, top: showAbove ? undefined : rect.bottom + 4, bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined, right: window.innerWidth - rect.right }); }}>
                                              <MoreHorizontal size={14} />
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                      {(!b.rooms || b.rooms.length === 0) && (
                                        <tr><td colSpan="6" style={{ textAlign: 'center', color: '#9ca3af' }}>暫無房間</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}><Shield size={14} /> 入口列表</h4>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    {(() => { const selCount = (b.entrances || []).filter(e => e._selected).length; return (
                                      <button className="ac-btn-sm" type="button" disabled={selCount === 0} style={{ opacity: selCount === 0 ? 0.4 : 1, color: selCount > 0 ? '#dc2626' : undefined }} onClick={(ev) => { ev.stopPropagation(); handleBatchDeleteEntrances(c.id, b.id); }}>✕ 批量刪除{selCount > 0 ? ` (${selCount})` : ''}</button>
                                    ); })()}
                                    <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); addEntranceDialogRef.current?.showModal({ type: 'building', id: b.id, label: b.name, community: { address: c.address, latitude: c.latitude, longitude: c.longitude, serviceScope: c.serviceScope, contactPerson: c.contactPerson, contactPhone: c.contactPhone, contactEmail: c.contactEmail } }); }}><Plus size={12} /> 添加入口</button>
                                    <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => handleBatchAssignBuildingDevices(c.id, b.id)}>📡 批量分配設備</button>
                                    <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px', color: '#dc2626' }} onClick={() => handleBatchRemoveBuildingDevices(c.id, b.id)}>📡 批量取消設備</button>
                                    <button className="ac-btn-sm" type="button" style={{ marginBottom: '4px' }} onClick={() => window.alert('開發中')}>🧪 測試</button>
                                  </div>
                                </div>
                                <div className="entrance-table-wrap" style={{ width: '100%', overflow: 'auto', maxHeight: '280px', scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                                  <style>{`.entrance-table-wrap::-webkit-scrollbar { width: 6px; height: 6px; } .entrance-table-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; } .entrance-table-wrap::-webkit-scrollbar-track { background: transparent; }`}</style>
                                  <table className="ac-table" style={{ minWidth: '580px' }}>
                                    <thead>
                                      <tr>
                                        <th style={{ width: '36px' }}><input type="checkbox" style={{ accentColor: '#2563eb' }} onChange={(ev) => { const checked = ev.target.checked; setCommunities(prev => prev.map(c2 => ({ ...c2, buildings: (c2.buildings || []).map(b2 => b2.id === b.id ? { ...b2, entrances: (b2.entrances || []).map(e => ({ ...e, _selected: checked })) } : b2) }))); }} /></th>
                                        <th>入口名稱</th>
                                        <th>綁定設備</th>
                                        <th style={{ width: '90px', whiteSpace: 'nowrap' }}>狀態</th>
                                        <th style={{ width: '80px' }}>授權用戶</th>
                                        <th style={{ width: '60px' }}>操作</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(b.entrances || []).map(e => (
                                        <tr key={e.id}>
                                          <td><input type="checkbox" checked={!!e._selected} style={{ accentColor: '#2563eb' }} onChange={(ev) => { const checked = ev.target.checked; setCommunities(prev => prev.map(c2 => ({ ...c2, buildings: (c2.buildings || []).map(b2 => b2.id === b.id ? { ...b2, entrances: (b2.entrances || []).map(e2 => e2.id === e.id ? { ...e2, _selected: checked } : e2) } : b2) }))); }} /></td>
                                          <td style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                                          <td style={{ fontFamily: 'monospace', fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.device || ''}>{e.device || '—'}</td>
                                          <td style={{ whiteSpace: 'nowrap' }}>
                                            {e.deviceStatus === 'none' ? (
                                              <span className="ac-badge none"><span className="ac-badge-dot" />未綁定</span>
                                            ) : (
                                              <span className={`ac-badge ${e.isActive !== false ? 'online' : 'offline'}`}>
                                                <span className="ac-badge-dot" />
                                                {e.isActive !== false ? '啟用' : '停用'}
                                              </span>
                                            )}
                                          </td>
                                          <td style={{ textAlign: 'center', fontWeight: 500 }}>{e.authCount ?? 0}</td>
                                          <td>
                                              <button className="ac-btn-sm" type="button" onClick={(ev) => { ev.stopPropagation(); const rect = ev.currentTarget.getBoundingClientRect(); const menuHeight = 185; const showAbove = rect.bottom + 4 + menuHeight > window.innerHeight; setEntranceDropdownOpen(entranceDropdownOpen && entranceDropdownOpen.id === e.id ? null : { id: e.id, communityId: c.id, buildingId: b.id, top: showAbove ? undefined : rect.bottom + 4, bottom: showAbove ? window.innerHeight - rect.top + 4 : undefined, right: window.innerWidth - rect.right }); }}>
                                                <MoreHorizontal size={14} />
                                              </button>
                                          </td>
                                        </tr>
                                      ))}
                                      {(!b.entrances || b.entrances.length === 0) && (
                                        <tr><td colSpan="6" style={{ textAlign: 'center', color: '#9ca3af' }}>暫無入口</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {(!c.buildings || c.buildings.length === 0) && (
                      <div className="ac-empty" style={{ margin: '0 24px 16px' }}>暫無樓宇，請添加</div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 权限抽屉 */}
      {showAuthDrawer && selectedEntrance && (() => {
        const cId = selectedEntrance.communityId;
        const authRooms = getAuthRooms(selectedEntrance.id, cId);
        const unauthRooms = getUnauthRooms(selectedEntrance.id, cId);
        const tabs = [
          { id: 'authorized', label: '已授權房間' },
          { id: 'byRoom', label: '按房間授權' },
          { id: 'byBuilding', label: '按樓宇授權' },
        ];

        // Tab 1: filtered & sorted authorized rooms
        const filtered = authSearch
          ? authRooms.filter(r => (r.roomNumber || '').toLowerCase().includes(authSearch.toLowerCase()) || (r.buildingName || '').toLowerCase().includes(authSearch.toLowerCase()) || (r.sipName || '').toLowerCase().includes(authSearch.toLowerCase()) || (r.sipAccount || '').toLowerCase().includes(authSearch.toLowerCase()))
          : authRooms;
        const sorted = [...filtered].sort((a, b) => {
          const va = (a[authSort.field] || '').toString().toLowerCase();
          const vb = (b[authSort.field] || '').toString().toLowerCase();
          return authSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
        });

        return (
          <>
            <div className="ac-drawer-overlay" onClick={() => setShowAuthDrawer(false)} />
            <div className="ac-drawer" style={{ width: '700px' }}>
              <div className="ac-drawer-header">
                <h3>權限設置 — {selectedEntrance.name}</h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px' }} onClick={() => setShowAuthDrawer(false)}><X size={20} /></button>
              </div>
              <div className="ac-drawer-body" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid #e2e8f0', marginBottom: '16px', flexShrink: 0 }}>
                  {tabs.map(t => (
                    <button key={t.id} type="button"
                      style={{ padding: '10px 18px', fontSize: '13px', fontWeight: authTab === t.id ? 600 : 400, color: authTab === t.id ? '#2563eb' : '#64748b', border: 'none', borderBottom: authTab === t.id ? '2px solid #2563eb' : '2px solid transparent', background: 'none', cursor: 'pointer', marginBottom: '-1px' }}
                      onClick={() => setAuthTab(t.id)}>{t.label}</button>
                  ))}
                </div>

                {/* Tab 1: Authorized Rooms */}
                {authTab === 'authorized' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="ac-stat-pill">已授權<strong style={{ color: '#2563eb' }}>{authRooms.length}</strong></span>
                        {authSearch && <span className="ac-stat-pill">篩選<strong style={{ color: '#8b5cf6' }}>{filtered.length}</strong></span>}
                        <span className="ac-stat-pill">未授權<strong style={{ color: '#9ca3af' }}>{unauthRooms.length}</strong></span>
                      </div>
                      <div className="ac-search" style={{ width: '200px', flex: 'none' }}>
                        <Search size={16} />
                        <input type="search" placeholder="搜尋房間..." value={authSearch} onChange={(e) => setAuthSearch(e.target.value)}
                          style={{ height: '34px', padding: '0 16px 0 38px', border: '1px solid #d8e2ef', borderRadius: '7px', fontSize: '12px', outline: 'none', color: '#e5e7eb', boxSizing: 'border-box', width: '100%' }} />
                      </div>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                      {sorted.length === 0 ? (
                        <div className="ac-empty" style={{ padding: '20px' }}>{authSearch ? '無匹配房間' : '暫無已授權房間'}</div>
                      ) : (
                        <table className="ac-table" style={{ minWidth: '550px' }}>
                          <thead>
                            <tr>
                              {['buildingName','roomNumber','sipName','sipAccount'].map(f => {
                                const labels = { buildingName: '樓宇', roomNumber: '房間號', sipName: '顯示名', sipAccount: 'SIP 帳號' };
                                const active = authSort.field === f;
                                return <th key={f} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setAuthSort(prev => ({ field: f, asc: prev.field === f ? !prev.asc : true }))}>{labels[f]} {active ? (authSort.asc ? '▲' : '▼') : '⇅'}</th>;
                              })}
                              <th style={{ width: '70px' }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map(r => (
                              <tr key={r.id}>
                                <td>{r.buildingName}</td>
                                <td style={{ fontWeight: 600 }}>{r.roomNumber}</td>
                                <td>{r.sipName || '—'}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.sipAccount || '—'}</td>
                                <td>
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 8px', height: '26px', color: '#dc2626' }} onClick={() => {
                                    // Remove auth for this room
                                    apiClient.delete(`/access-entrances/${selectedEntrance.id}/auth/${r.id}`).then(() => {
                                      setCommunities(prev => prev.map(c => {
                                        if (c.id === cId) {
                                          const auth = { ...(c.authMatrix || {}) };
                                          const key = String(selectedEntrance.id);
                                          auth[key] = (auth[key] || []).filter(id => id !== r.id);
                                          return { ...c, authMatrix: auth };
                                        }
                                        return c;
                                      }));
                                    }).catch(err => console.error('取消授權失敗:', err));
                                  }}>✕ 移除</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )}

                {/* Tab 3: Authorize by Building */}
                {authTab === 'byBuilding' && (() => {
                  const community = communities.find(c => c.id === cId);
                  const buildings = community?.buildings || [];
                  const buildingStats = buildings.map(b => {
                    const totalRooms = (b.rooms || []).length;
                    const authCount = (b.rooms || []).filter(r => authRooms.some(ar => ar.id === r.id)).length;
                    return { ...b, totalRooms, authCount };
                  });
                  const selBuildings = buildingStats.filter(b => b._sel).length;
                  const allSel = buildingStats.length > 0 && buildingStats.every(b => b._sel);
                  const handleBatchAuth = (authorize) => {
                    const selected = buildingStats.filter(b => b._sel && b.totalRooms > 0);
                    const ops = selected.map(b =>
                      authorize
                        ? apiClient.put(`/access-entrances/${selectedEntrance.id}/auth/building/${b.id}`)
                        : apiClient.delete(`/access-entrances/${selectedEntrance.id}/auth/building/${b.id}`)
                    );
                    Promise.all(ops).then(() => {
                      setCommunities(prev => prev.map(c2 => {
                        if (c2.id === cId) {
                          const auth = { ...(c2.authMatrix || {}) };
                          const key = String(selectedEntrance.id);
                          selected.forEach(b => {
                            const ids = (b.rooms || []).map(r => r.id);
                            if (authorize) {
                              auth[key] = [...new Set([...(auth[key] || []), ...ids])];
                            } else {
                              auth[key] = (auth[key] || []).filter(id => !ids.includes(id));
                            }
                          });
                          return { ...c2, authMatrix: auth };
                        }
                        return c2;
                      }));
                    }).catch(err => console.error(err));
                  };
                  const toggleSel = (bId, checked) => {
                    setCommunities(prev => prev.map(c2 => {
                      if (c2.id === cId) {
                        return { ...c2, buildings: (c2.buildings || []).map(b2 => b2.id === bId ? { ...b2, _sel: checked } : b2) };
                      }
                      return c2;
                    }));
                  };
                  const toggleAll = (checked) => {
                    setCommunities(prev => prev.map(c2 => {
                      if (c2.id === cId) {
                        return { ...c2, buildings: (c2.buildings || []).map(b2 => ({ ...b2, _sel: checked })) };
                      }
                      return c2;
                    }));
                  };
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="ac-stat-pill">樓宇<strong>{buildings.length}</strong></span>
                          <span className="ac-stat-pill">已授權<strong style={{ color: '#2563eb' }}>{authRooms.length}</strong></span>
                          <span className="ac-stat-pill">未授權<strong style={{ color: '#9ca3af' }}>{unauthRooms.length}</strong></span>
                          {selBuildings > 0 && <span className="ac-stat-pill">已選<strong style={{ color: '#8b5cf6' }}>{selBuildings}</strong></span>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="ac-btn-sm" type="button" disabled={selBuildings === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', opacity: selBuildings === 0 ? 0.4 : 1 }}
                            onClick={() => handleBatchAuth(true)}>✓ 授權所選</button>
                          <button className="ac-btn-sm" type="button" disabled={selBuildings === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626', opacity: selBuildings === 0 ? 0.4 : 1 }}
                            onClick={() => handleBatchAuth(false)}>✕ 取消所選</button>
                        </div>
                      </div>
                      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                        {buildingStats.length === 0 ? (
                          <div className="ac-empty" style={{ padding: '20px' }}>暫無樓宇</div>
                        ) : (
                          <table className="ac-table" style={{ minWidth: '550px' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '36px' }}><input type="checkbox" checked={allSel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleAll(e.target.checked)} /></th>
                                <th>樓宇名稱</th>
                                <th style={{ width: '70px' }}>總房間</th>
                                <th style={{ width: '70px' }}>已授權</th>
                                <th style={{ width: '80px' }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {buildingStats.map(b => {
                                const isAll = b.totalRooms > 0 && b.authCount === b.totalRooms;
                                const updateAuth = (authorize) => {
                                  const op = authorize
                                    ? apiClient.put(`/access-entrances/${selectedEntrance.id}/auth/building/${b.id}`)
                                    : apiClient.delete(`/access-entrances/${selectedEntrance.id}/auth/building/${b.id}`);
                                  op.then(() => {
                                    setCommunities(prev => prev.map(c2 => {
                                      if (c2.id === cId) {
                                        const auth = { ...(c2.authMatrix || {}) };
                                        const key = String(selectedEntrance.id);
                                        const bRoomIds = (b.rooms || []).map(r => r.id);
                                        if (authorize) {
                                          auth[key] = [...new Set([...(auth[key] || []), ...bRoomIds])];
                                        } else {
                                          auth[key] = (auth[key] || []).filter(id => !bRoomIds.includes(id));
                                        }
                                        return { ...c2, authMatrix: auth };
                                      }
                                      return c2;
                                    }));
                                  }).catch(err => console.error(err));
                                };
                                return (
                                  <tr key={b.id}>
                                    <td><input type="checkbox" checked={!!b._sel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleSel(b.id, e.target.checked)} /></td>
                                    <td style={{ fontWeight: 600 }}>{b.name}</td>
                                    <td style={{ textAlign: 'center' }}>{b.totalRooms}</td>
                                    <td style={{ textAlign: 'center' }}>{b.authCount}</td>
                                    <td>
                                      {b.totalRooms > 0 && (
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                          {isAll ? (
                                            <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px', color: '#dc2626' }} onClick={() => updateAuth(false)}>取消</button>
                                          ) : (
                                            <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => updateAuth(true)}>授權</button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Tab 2: Authorize by Room */}
                {authTab === 'byRoom' && (() => {
                  const community = communities.find(c => c.id === cId);
                  const allRooms = (community?.buildings || []).flatMap(b => (b.rooms || []).map(r => ({ ...r, buildingName: b.name, buildingId: b.id })));
                  const authRoomIds = new Set(authRooms.map(r => r.id));
                  const roomsWithAuth = allRooms.map(r => ({ ...r, _authorized: authRoomIds.has(r.id) }));
                  const sorted = [...roomsWithAuth].sort((a, b) => (a.roomNumber || '').toLowerCase().localeCompare((b.roomNumber || '').toLowerCase()));
                  const selRooms = roomsWithAuth.filter(r => r._sel);
                  const allSel = roomsWithAuth.length > 0 && roomsWithAuth.every(r => r._sel);
                  const toggleRoom = (id, checked) => {
                    setCommunities(prev => prev.map(c2 => {
                      if (c2.id === cId) {
                        return { ...c2, buildings: (c2.buildings || []).map(b2 => ({ ...b2, rooms: (b2.rooms || []).map(r2 => r2.id === id ? { ...r2, _sel: checked } : r2) })) };
                      }
                      return c2;
                    }));
                  };
                  const toggleAll = (checked) => {
                    setCommunities(prev => prev.map(c2 => {
                      if (c2.id === cId) {
                        return { ...c2, buildings: (c2.buildings || []).map(b2 => ({ ...b2, rooms: (b2.rooms || []).map(r2 => ({ ...r2, _sel: checked })) })) };
                      }
                      return c2;
                    }));
                  };
                  const handleRoomAuth = (authorize, roomIds) => {
                    const url = `/access-entrances/${selectedEntrance.id}/auth/rooms`;
                    const op = authorize ? apiClient.post(url, { roomIds }) : apiClient.delete(url, { data: { roomIds } });
                    op.then(() => {
                      setCommunities(prev => prev.map(c2 => {
                        if (c2.id === cId) {
                          const auth = { ...(c2.authMatrix || {}) };
                          const key = String(selectedEntrance.id);
                          if (authorize) {
                            auth[key] = [...new Set([...(auth[key] || []), ...roomIds])];
                          } else {
                            auth[key] = (auth[key] || []).filter(id => !roomIds.includes(id));
                          }
                          return { ...c2, authMatrix: auth };
                        }
                        return c2;
                      }));
                    }).catch(err => console.error(err));
                  };
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="ac-stat-pill">總房間<strong>{allRooms.length}</strong></span>
                          <span className="ac-stat-pill">已授權<strong style={{ color: '#2563eb' }}>{authRooms.length}</strong></span>
                          <span className="ac-stat-pill">未授權<strong style={{ color: '#9ca3af' }}>{unauthRooms.length}</strong></span>
                          {selRooms.length > 0 && <span className="ac-stat-pill">已選<strong style={{ color: '#8b5cf6' }}>{selRooms.length}</strong></span>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="ac-btn-sm" type="button" disabled={selRooms.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', opacity: selRooms.length === 0 ? 0.4 : 1 }}
                            onClick={() => handleRoomAuth(true, selRooms.filter(r => !r._authorized).map(r => r.id))}>✓ 授權所選</button>
                          <button className="ac-btn-sm" type="button" disabled={selRooms.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626', opacity: selRooms.length === 0 ? 0.4 : 1 }}
                            onClick={() => handleRoomAuth(false, selRooms.filter(r => r._authorized).map(r => r.id))}>✕ 取消所選</button>
                        </div>
                      </div>
                      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                        {allRooms.length === 0 ? (
                          <div className="ac-empty" style={{ padding: '20px' }}>暫無房間</div>
                        ) : (
                          <table className="ac-table" style={{ minWidth: '500px' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '36px' }}><input type="checkbox" checked={allSel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleAll(e.target.checked)} /></th>
                                <th>樓宇</th>
                                <th>房間號</th>
                                <th>SIP 帳號</th>
                                <th>顯示名</th>
                                <th style={{ width: '80px' }}>狀態</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map(r => (
                                <tr key={r.id}>
                                  <td><input type="checkbox" checked={!!r._sel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleRoom(r.id, e.target.checked)} /></td>
                                  <td style={{ fontSize: '12px', color: '#9ca3af' }}>{r.buildingName}</td>
                                  <td style={{ fontWeight: 600 }}>{r.roomNumber}</td>
                                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.sipAccount || '—'}</td>
                                  <td>{r.sipName || '—'}</td>
                                  <td>
                                    {r._authorized ? (
                                      <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px', color: '#dc2626' }} onClick={() => handleRoomAuth(false, [r.id])}>取消</button>
                                    ) : (
                                      <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => handleRoomAuth(true, [r.id])}>授權</button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        );
      })()}

      {toast && (
        <div style={{ position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, background: toast.type === 'success' ? '#166534' : '#991b1b', color: '#fff', padding: '12px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', animation: 'toastIn 0.25s ease-out' }} onAnimationEnd={() => { setTimeout(() => setToast(null), 2000); }}>
          {toast.message}
        </div>
      )}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <AddBuildingDialog ref={addBuildingDialogRef} onCreated={handleBuildingCreated} onUpdated={handleBuildingUpdated} />
      <AddEntranceDialog ref={addEntranceDialogRef} onCreated={handleEntranceCreated} onUpdated={handleEntranceUpdated} />
      <AddRoomDialog ref={addRoomDialogRef} onCreated={handleRoomCreated} onUpdated={handleRoomUpdated} />
      <AddCommunityDialog ref={addCommunityDialogRef} onCreated={handleCommunityCreated} onUpdated={handleCommunityUpdated} />

      {/* 查看房間對話框 */}
      {viewRoomsBuilding && (() => {
        const allRooms = viewRoomsBuilding.rooms || [];
        const filtered = roomViewSearch ? allRooms.filter(r =>
          (r.roomNumber || '').toLowerCase().includes(roomViewSearch.toLowerCase()) ||
          (r.floor || '').toLowerCase().includes(roomViewSearch.toLowerCase()) ||
          (r.contactPerson || '').toLowerCase().includes(roomViewSearch.toLowerCase()) ||
          (r.sipName || '').toLowerCase().includes(roomViewSearch.toLowerCase()) ||
          (r.sipAccount || '').toLowerCase().includes(roomViewSearch.toLowerCase())
        ) : allRooms;
        const selCount = roomViewSelected.size;
        const allSelected = filtered.length > 0 && filtered.every(r => roomViewSelected.has(r.id));
        return (
        <dialog ref={(el) => { if (el && !el.open) el.showModal(); }} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '900px', width: '90vw', boxShadow: '0 20px 60px rgba(15,23,42,0.18)', background: '#fff', color: '#e5e7eb' }} onClose={() => { setViewRoomsBuilding(null); setRoomViewSearch(''); setRoomViewSelected(new Set()); }}>
          <style>{`dialog::backdrop { background: rgba(15,23,42,0.5); backdrop-filter: blur(4px); }`}</style>
          <div style={{ display: 'flex', flexDirection: 'column', height: '75vh', maxHeight: '650px' }}>
            <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>{viewRoomsBuilding.buildingName} — 房間列表</h2>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={() => { setViewRoomsBuilding(null); setRoomViewSearch(''); setRoomViewSelected(new Set()); }}>&#x2715;</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ac-stat-pill">總房間<strong>{allRooms.length}</strong></span>
                  {roomViewSearch && <span className="ac-stat-pill">篩選結果<strong style={{ color: '#3b82f6' }}>{filtered.length}</strong></span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="ac-search" style={{ width: '200px', flex: 'none' }}>
                    <Search size={16} />
                    <input type="search" placeholder="搜尋房間..." value={roomViewSearch} onChange={(e) => { setRoomViewSearch(e.target.value); setRoomViewSelected(new Set()); }}
                      style={{ height: '36px', padding: '0 16px 0 40px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '13px', outline: 'none', color: '#e5e7eb', boxSizing: 'border-box', width: '100%' }} />
                  </div>
                  <button className="ac-btn-sm" type="button" disabled={selCount === 0} style={{ opacity: selCount === 0 ? 0.4 : 1, color: selCount > 0 ? '#dc2626' : undefined, whiteSpace: 'nowrap' }} onClick={() => {
                    const names = allRooms.filter(r => roomViewSelected.has(r.id)).map(r => r.roomNumber);
                    if (!window.confirm(`確定要刪除 ${selCount} 個房間嗎？\n\n${names.map(n => '· ' + n).join('\n')}\n\n此操作無法撤銷。`)) return;
                    Promise.all(allRooms.filter(r => roomViewSelected.has(r.id)).map(r => apiClient.delete(`/access-rooms/${r.id}`))).then(() => {
                      const deletedIds = new Set(allRooms.filter(r => roomViewSelected.has(r.id)).map(r => r.id));
                      setViewRoomsBuilding(prev => prev ? { ...prev, rooms: (prev.rooms || []).filter(r => !deletedIds.has(r.id)) } : null);
                      setRoomViewSelected(new Set());
                      setCommunities(prev => prev.map(c => ({ ...c, buildings: (c.buildings || []).map(b => b.id === viewRoomsBuilding.buildingId ? { ...b, rooms: (b.rooms || []).filter(r => !deletedIds.has(r.id)) } : b) })));
                    });
                  }}>✕ 批量刪除{selCount > 0 ? ` (${selCount})` : ''}</button>
                </div>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 28px 24px', scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent', minHeight: 0 }}>
              <style>{`.room-view-body::-webkit-scrollbar { width: 6px; height: 6px; } .room-view-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }`}</style>
              {filtered.length === 0 ? (
                <div className="ac-empty">{roomViewSearch ? '無匹配房間' : '暫無房間'}</div>
              ) : (
                <table className="ac-table" style={{ minWidth: '760px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '36px' }}><input type="checkbox" checked={allSelected} style={{ accentColor: '#2563eb' }} onChange={() => { const next = new Set(roomViewSelected); if (allSelected) filtered.forEach(r => next.delete(r.id)); else filtered.forEach(r => next.add(r.id)); setRoomViewSelected(next); }} /></th>
                      <th>房間號</th>
                      <th>樓層</th>
                      <th>聯絡人</th>
                      <th>聯絡電話</th>
                      <th>SIP 帳號</th>
                      <th>顯示名</th>
                      <th style={{ width: '100px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                        <tr key={r.id}>
                          <td><input type="checkbox" checked={roomViewSelected.has(r.id)} style={{ accentColor: '#2563eb' }} onChange={() => { const next = new Set(roomViewSelected); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); setRoomViewSelected(next); }} /></td>
                          <td style={{ fontWeight: 600 }}>{r.roomNumber}</td>
                          <td>{r.floor || '—'}</td>
                          <td>{r.contactPerson || '—'}</td>
                          <td>{r.contactPhone || '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.sipAccount || '—'}</td>
                          <td>{r.sipName || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => { addRoomDialogRef.current?.showModal({ buildingId: viewRoomsBuilding.buildingId, buildingLabel: viewRoomsBuilding.buildingName }, { id: r.id, roomNumber: r.roomNumber, floor: r.floor, contactPerson: r.contactPerson, contactPhone: r.contactPhone, contactEmail: r.contactEmail }); }}>✎ 編輯</button>
                              <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626' }} onClick={() => { handleDeleteRoom(r, viewRoomsBuilding.buildingId); setViewRoomsBuilding(prev => prev ? { ...prev, rooms: (prev.rooms || []).filter(r2 => r2.id !== r.id) } : null); }}>✕ 刪除</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 28px', borderTop: '1px solid #e2e8f0', background: '#1a2332', borderRadius: '0 0 16px 16px' }}>
              <button type="button" onClick={() => { setViewRoomsBuilding(null); setRoomViewSearch(''); setRoomViewSelected(new Set()); }} style={{ height: '40px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer' }}>關閉</button>
            </div>
          </div>
        </dialog>
      );})()}

      {/* SIP 帳號分配對話框 */}
      {assignSipRoom && (
        <dialog ref={(el) => { if (el && !el.open) el.showModal(); }} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '700px', width: '90vw', boxShadow: '0 20px 60px rgba(15,23,42,0.18)', background: '#fff', color: '#e5e7eb' }}
          onClose={() => { setAssignSipRoom(null); setSipSearch(''); }}>
          <style>{`dialog::backdrop { background: rgba(15,23,42,0.5); backdrop-filter: blur(4px); }`}</style>
          <div style={{ display: 'flex', flexDirection: 'column', height: '65vh', maxHeight: '520px' }}>
            <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  分配 SIP 帳號 — {assignSipRoom.roomNumber}
                  <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', marginLeft: '8px' }}>{assignSipRoom.buildingName}</span>
                </h2>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={() => { setAssignSipRoom(null); setSipSearch(''); }}>&#x2715;</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ac-stat-pill">可用帳號<strong style={{ color: '#16a34a' }}>{sipAccounts.length}</strong></span>
                  {sipSearch && (
                    <span className="ac-stat-pill">篩選<strong style={{ color: '#3b82f6' }}>{sipAccounts.filter(s => (s.username || '').toLowerCase().includes(sipSearch.toLowerCase()) || (s.displayName || '').toLowerCase().includes(sipSearch.toLowerCase())).length}</strong></span>
                  )}
                </div>
                <div className="ac-search" style={{ width: '220px', flex: 'none' }}>
                  <Search size={16} />
                  <input type="search" placeholder="搜尋帳號或名稱..." value={sipSearch} onChange={(e) => setSipSearch(e.target.value)}
                    style={{ height: '36px', padding: '0 16px 0 40px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '13px', outline: 'none', color: '#e5e7eb', boxSizing: 'border-box', width: '100%' }} />
                </div>
              </div>
            </div>
            <div style={{ padding: '0 28px 0', flexShrink: 0 }}>
              <table className="ac-table" style={{ minWidth: '500px', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th>SIP 帳號</th>
                    <th>Web 帳號</th>
                    <th>顯示名</th>
                    <th style={{ width: '130px' }}>有效期至</th>
                    <th style={{ width: '80px' }}>操作</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 28px 24px', scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent', minHeight: 0 }}>
              {sipLoading ? (
                <div className="ac-empty">加載中...</div>
              ) : (() => {
                const filtered = sipSearch ? sipAccounts.filter(s => (s.username || '').toLowerCase().includes(sipSearch.toLowerCase()) || (s.displayName || '').toLowerCase().includes(sipSearch.toLowerCase())) : sipAccounts;
                return filtered.length === 0 ? (
                  <div className="ac-empty">{sipSearch ? '無匹配帳號' : '暫無可用的 SIP 帳號'}</div>
                ) : (
                <table className="ac-table" style={{ minWidth: '600px', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col /><col /><col /><col style={{ width: '130px' }} /><col style={{ width: '80px' }} />
                  </colgroup>
                  <tbody>
                    {filtered.map(s => {
                      const isAssigned = s.currentRoomId === assignSipRoom.roomId;
                      return (
                      <tr key={s.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 500 }}>{s.username}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.webAccount || '—'}</td>
                        <td>{s.displayName || '—'}</td>
                        <td style={{ fontSize: '12px', color: '#9ca3af' }}>
                          {s.serviceExpiresAt ? new Date(s.serviceExpiresAt).toLocaleDateString('zh-CN') : '永久有效'}
                        </td>
                        <td>
                          {isAssigned ? (
                            <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626' }} onClick={() => handleAssignSip(null)}>取消分配</button>
                          ) : !s.webAccount ? (
                            <span style={{ fontSize: '11px', color: '#9ca3af' }}>未配置 Web 帳號</span>
                          ) : (
                            <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 10px', height: '28px' }} onClick={() => handleAssignSip(s.id)}>分配</button>
                          )}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              );
            })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 28px', borderTop: '1px solid #e2e8f0', background: '#1a2332', borderRadius: '0 0 16px 16px' }}>
              <button type="button" onClick={() => { setAssignSipRoom(null); setSipSearch(''); }} style={{ height: '40px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer' }}>關閉</button>
            </div>
          </div>
        </dialog>
      )}
      {/* 社區授權抽屜 */}
      {showCommunityAuthDrawer && selectedCommunityAuth && (() => {
        const community = communities.find(c => c.id === selectedCommunityAuth.communityId);
        const allEntrances = [
          ...(community?.communityEntrances || []).map(e => ({ ...e, belongName: community?.name || '', belongType: 'community' })),
          ...(community?.buildings || []).flatMap(b => (b.entrances || []).map(e => ({ ...e, belongName: b.name, belongType: 'building' }))),
        ];
        const allRoomIds = new Set((community?.buildings || []).flatMap(b => (b.rooms || []).map(r => r.id)));
        const authMatrix = community?.authMatrix || {};
        const entrancesWithAuth = allEntrances.map(e => {
          const authRooms = authMatrix[String(e.id)] || [];
          const authCount = authRooms.filter(id => allRoomIds.has(id)).length;
          const total = allRoomIds.size;
          return { ...e, authCount, total, isAll: total > 0 && authCount === total };
        })
        const handleCommAuth = async (entranceId, authorize) => {
          try {
            const roomIdsArr = [...allRoomIds];
            if (authorize) {
              await apiClient.post(`/access-entrances/${entranceId}/auth/rooms`, { roomIds: roomIdsArr });
            } else {
              // Only unauthorize rooms that belong to this community
              await apiClient.delete(`/access-entrances/${entranceId}/auth/rooms`, { data: { roomIds: roomIdsArr } });
            }
            setCommunities(prev => prev.map(c2 => {
              if (c2.id === selectedCommunityAuth.communityId) {
                const auth = { ...(c2.authMatrix || {}) };
                const key = String(entranceId);
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), ...roomIdsArr])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => !roomIdsArr.includes(id));
                }
                return { ...c2, authMatrix: auth };
              }
              return c2;
            }));
          } catch (err) { console.error(err); }
        };
        const selEnts = entrancesWithAuth.filter(e => e._sel4).length;
        const allSel = entrancesWithAuth.length > 0 && entrancesWithAuth.every(e => e._sel4);
        const toggleEnt4 = (id, checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedCommunityAuth.communityId) {
              const upd = (list) => (list || []).map(e => e.id === id ? { ...e, _sel4: checked } : e);
              return { ...c2, communityEntrances: upd(c2.communityEntrances), buildings: (c2.buildings || []).map(b => ({ ...b, entrances: upd(b.entrances) })) };
            }
            return c2;
          }));
        };
        const toggleAll4 = (checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedCommunityAuth.communityId) {
              const upd = (list) => (list || []).map(e => ({ ...e, _sel4: checked }));
              return { ...c2, communityEntrances: upd(c2.communityEntrances), buildings: (c2.buildings || []).map(b => ({ ...b, entrances: upd(b.entrances) })) };
            }
            return c2;
          }));
        };
        const handleCommBatch = async (authorize) => {
          const selected = entrancesWithAuth.filter(e => e._sel4);
          const roomIdsArr = [...allRoomIds];
          for (const e of selected) {
            try {
              if (authorize) {
                await apiClient.post(`/access-entrances/${e.id}/auth/rooms`, { roomIds: roomIdsArr });
              } else {
                await apiClient.delete(`/access-entrances/${e.id}/auth/rooms`, { data: { roomIds: roomIdsArr } });
              }
            } catch (err) { console.error(err); }
          }
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedCommunityAuth.communityId) {
              const auth = { ...(c2.authMatrix || {}) };
              selected.forEach(e => {
                const key = String(e.id);
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), ...roomIdsArr])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => !roomIdsArr.includes(id));
                }
              });
              return { ...c2, authMatrix: auth };
            }
            return c2;
          }));
        };
        return (
          <>
            <div className="ac-drawer-overlay" onClick={() => setShowCommunityAuthDrawer(false)} />
            <div className="ac-drawer" style={{ width: '650px' }}>
              <div className="ac-drawer-header">
                <h3>社區授權 — {selectedCommunityAuth.communityName}
                  <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', marginLeft: '8px' }}>{allRoomIds.size} 個房間 · {entrancesWithAuth.length} 個入口</span>
                </h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px' }} onClick={() => setShowCommunityAuthDrawer(false)}><X size={20} /></button>
              </div>
              <div className="ac-drawer-body" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ac-stat-pill">可用入口<strong>{entrancesWithAuth.length}</strong></span>
                    <span className="ac-stat-pill">全部已授權<strong style={{ color: '#2563eb' }}>{entrancesWithAuth.filter(e => e.isAll).length}</strong></span>
                    {selEnts > 0 && <span className="ac-stat-pill">已選<strong style={{ color: '#8b5cf6' }}>{selEnts}</strong></span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="ac-btn-sm" type="button" disabled={selEnts === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', opacity: selEnts === 0 ? 0.4 : 1 }}
                      onClick={() => handleCommBatch(true)}>✓ 授權所選</button>
                    <button className="ac-btn-sm" type="button" disabled={selEnts === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626', opacity: selEnts === 0 ? 0.4 : 1 }}
                      onClick={() => handleCommBatch(false)}>✕ 取消所選</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  {entrancesWithAuth.length === 0 ? (
                    <div className="ac-empty" style={{ padding: '20px' }}>暫無入口</div>
                  ) : (
                    <table className="ac-table" style={{ minWidth: '500px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '36px' }}><input type="checkbox" checked={allSel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleAll4(e.target.checked)} /></th>
                          <th>入口名稱</th>
                          <th>所屬</th>
                          <th style={{ width: '90px' }}>授權進度</th>
                          <th style={{ width: '80px' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entrancesWithAuth.map(e => (
                          <tr key={`${e.belongType}-${e.id}`}>
                            <td><input type="checkbox" checked={!!e._sel4} style={{ accentColor: '#2563eb' }} onChange={(ev) => toggleEnt4(e.id, ev.target.checked)} /></td>
                            <td style={{ fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                            <td style={{ fontSize: '12px', color: '#9ca3af' }}>{e.belongName} ({e.belongType === 'building' ? '樓宇級' : '社區級'})</td>
                            <td style={{ fontSize: '12px' }}>
                              {e.total === 0 ? <span style={{ color: '#9ca3af' }}>無房間</span> :
                               e.isAll ? <span style={{ color: '#16a34a' }}>全部 ({e.authCount}/{e.total})</span> :
                               <span style={{ color: '#b45309' }}>部分 ({e.authCount}/{e.total})</span>}
                            </td>
                            <td>
                              {e.total > 0 && (
                                e.isAll ? (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px', color: '#dc2626' }} onClick={() => handleCommAuth(e.id, false)}>全部取消</button>
                                ) : (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => handleCommAuth(e.id, true)}>全部授權</button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
      {/* 樓宇授權抽屜 */}
      {showBuildingAuthDrawer && selectedBuildingAuth && (() => {
        const { buildingId, buildingName, communityId } = selectedBuildingAuth;
        const community = communities.find(c => c.id === communityId); // read from live state
        const allEntrances = [
          ...(community?.communityEntrances || []).map(e => ({ ...e, belongName: community?.name || '', belongType: 'community' })),
          ...(community?.buildings || []).flatMap(b => (b.entrances || []).map(e => ({ ...e, belongName: b.name, belongType: 'building' }))),
        ];
        const roomIds = new Set((community?.buildings?.find(b => b.id === buildingId)?.rooms || []).map(r => r.id));
        const authMatrix = community?.authMatrix || {};
        const entrancesWithAuth = allEntrances.map(e => {
          const authRooms = authMatrix[String(e.id)] || [];
          const authInBld = authRooms.filter(id => roomIds.has(id)).length;
          const totalInBld = roomIds.size;
          return { ...e, authInBld, totalInBld, isAll: totalInBld > 0 && authInBld === totalInBld };
        });
        const handleBldAuth = async (entranceId, authorize) => {
          try {
            if (authorize) {
              await apiClient.put(`/access-entrances/${entranceId}/auth/building/${buildingId}`);
            } else {
              await apiClient.delete(`/access-entrances/${entranceId}/auth/building/${buildingId}`);
            }
            setCommunities(prev => prev.map(c2 => {
              if (c2.id === communityId) {
                const auth = { ...(c2.authMatrix || {}) };
                const key = String(entranceId);
                const ids = [...roomIds];
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), ...ids])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => !ids.includes(id));
                }
                return { ...c2, authMatrix: auth };
              }
              return c2;
            }));
          } catch (err) { console.error(err); }
        };
        const handleBldBatch = async (authorize) => {
          const selected = entrancesWithAuth.filter(e => e._sel3);
          for (const e of selected) {
            try {
              if (authorize) {
                await apiClient.put(`/access-entrances/${e.id}/auth/building/${buildingId}`);
              } else {
                await apiClient.delete(`/access-entrances/${e.id}/auth/building/${buildingId}`);
              }
            } catch (err) { console.error(err); }
          }
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === communityId) {
              const auth = { ...(c2.authMatrix || {}) };
              const ids = [...roomIds];
              selected.forEach(e => {
                const key = String(e.id);
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), ...ids])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => !ids.includes(id));
                }
              });
              return { ...c2, authMatrix: auth };
            }
            return c2;
          }));
        };
        const toggleEnt3 = (id, checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === communityId) {
              const upd = (list) => (list || []).map(e => e.id === id ? { ...e, _sel3: checked } : e);
              return { ...c2, communityEntrances: upd(c2.communityEntrances), buildings: (c2.buildings || []).map(b => ({ ...b, entrances: upd(b.entrances) })) };
            }
            return c2;
          }));
        };
        const toggleAll3 = (checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === communityId) {
              const upd = (list) => (list || []).map(e => ({ ...e, _sel3: checked }));
              return { ...c2, communityEntrances: upd(c2.communityEntrances), buildings: (c2.buildings || []).map(b => ({ ...b, entrances: upd(b.entrances) })) };
            }
            return c2;
          }));
        };
        const selEnts3 = entrancesWithAuth.filter(e => e._sel3);
        const allSel3 = entrancesWithAuth.length > 0 && entrancesWithAuth.every(e => e._sel3);
        return (
          <>
            <div className="ac-drawer-overlay" onClick={() => setShowBuildingAuthDrawer(false)} />
            <div className="ac-drawer" style={{ width: '650px' }}>
              <div className="ac-drawer-header">
                <h3>樓宇授權 — {buildingName}
                  <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', marginLeft: '8px' }}>{roomIds.size} 個房間</span>
                </h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px' }} onClick={() => setShowBuildingAuthDrawer(false)}><X size={20} /></button>
              </div>
              <div className="ac-drawer-body" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ac-stat-pill">總入口<strong>{allEntrances.length}</strong></span>
                    <span className="ac-stat-pill">已全部授權<strong style={{ color: '#2563eb' }}>{entrancesWithAuth.filter(e => e.isAll).length}</strong></span>
                    {selEnts3.length > 0 && <span className="ac-stat-pill">已選<strong style={{ color: '#8b5cf6' }}>{selEnts3.length}</strong></span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="ac-btn-sm" type="button" disabled={selEnts3.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', opacity: selEnts3.length === 0 ? 0.4 : 1 }}
                      onClick={() => handleBldBatch(true)}>✓ 授權所選</button>
                    <button className="ac-btn-sm" type="button" disabled={selEnts3.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626', opacity: selEnts3.length === 0 ? 0.4 : 1 }}
                      onClick={() => handleBldBatch(false)}>✕ 取消所選</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  {entrancesWithAuth.length === 0 ? (
                    <div className="ac-empty" style={{ padding: '20px' }}>暫無入口</div>
                  ) : (
                    <table className="ac-table" style={{ minWidth: '500px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '36px' }}><input type="checkbox" checked={allSel3} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleAll3(e.target.checked)} /></th>
                          <th>入口名稱</th>
                          <th>所屬</th>
                          <th style={{ width: '90px' }}>授權進度</th>
                          <th style={{ width: '80px' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entrancesWithAuth.map(e => (
                          <tr key={`${e.belongType}-${e.id}`}>
                            <td><input type="checkbox" checked={!!e._sel3} style={{ accentColor: '#2563eb' }} onChange={(ev) => toggleEnt3(e.id, ev.target.checked)} /></td>
                            <td style={{ fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                            <td style={{ fontSize: '12px', color: '#9ca3af' }}>{e.belongName}</td>
                            <td style={{ fontSize: '12px' }}>
                              {e.totalInBld === 0 ? <span style={{ color: '#9ca3af' }}>無房間</span> :
                               e.isAll ? <span style={{ color: '#16a34a' }}>全部 ({e.authInBld}/{e.totalInBld})</span> :
                               <span style={{ color: '#b45309' }}>部分 ({e.authInBld}/{e.totalInBld})</span>}
                            </td>
                            <td>
                              {e.totalInBld > 0 && (
                                e.isAll ? (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px', color: '#dc2626' }} onClick={() => handleBldAuth(e.id, false)}>全部取消</button>
                                ) : (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => handleBldAuth(e.id, true)}>全部授權</button>
                                )
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
      {/* 房間授權抽屜 */}
      {showRoomAuthDrawer && selectedRoomAuth && (() => {
        const community = communities.find(c => c.id === selectedRoomAuth.communityId);
        const allEntrances = [
          ...(community?.communityEntrances || []).map(e => ({ ...e, belongName: community.name, belongType: 'community' })),
          ...(community?.buildings || []).flatMap(b => (b.entrances || []).map(e => ({ ...e, belongName: b.name, belongType: 'building' }))),
        ];
        const roomId = selectedRoomAuth.roomId;
        const authEntranceIds = new Set();
        Object.entries(community?.authMatrix || {}).forEach(([entranceId, roomIds]) => {
          if (roomIds.includes(roomId)) authEntranceIds.add(Number(entranceId));
        });
        const selEntrances = allEntrances.filter(e => e._sel2);
        const allSel = allEntrances.length > 0 && allEntrances.every(e => e._sel2);
        const toggleEnt = (id, checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedRoomAuth.communityId) {
              const updateEntrances = (list) => (list || []).map(e => e.id === id ? { ...e, _sel2: checked } : e);
              return { ...c2, communityEntrances: updateEntrances(c2.communityEntrances), buildings: (c2.buildings || []).map(b2 => ({ ...b2, entrances: updateEntrances(b2.entrances) })) };
            }
            return c2;
          }));
        };
        const toggleAll2 = (checked) => {
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedRoomAuth.communityId) {
              const updateAll = (list) => (list || []).map(e => ({ ...e, _sel2: checked }));
              return { ...c2, communityEntrances: updateAll(c2.communityEntrances), buildings: (c2.buildings || []).map(b2 => ({ ...b2, entrances: updateAll(b2.entrances) })) };
            }
            return c2;
          }));
        };
        const handleRoomAuthOp = async (entranceId, authorize) => {
          try {
            if (authorize) {
              await apiClient.post(`/access-entrances/${entranceId}/auth/rooms`, { roomIds: [roomId] });
            } else {
              await apiClient.delete(`/access-entrances/${entranceId}/auth/rooms`, { data: { roomIds: [roomId] } });
            }
            setCommunities(prev => prev.map(c2 => {
              if (c2.id === selectedRoomAuth.communityId) {
                const auth = { ...(c2.authMatrix || {}) };
                const key = String(entranceId);
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), roomId])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => id !== roomId);
                }
                return { ...c2, authMatrix: auth };
              }
              return c2;
            }));
          } catch (err) { console.error(err); }
        };
        const handleBatchRoomAuth = async (authorize) => {
          const selected = selEntrances.map(e => e.id);
          if (selected.length === 0) return;
          for (const eid of selected) {
            try {
              if (authorize) {
                await apiClient.post(`/access-entrances/${eid}/auth/rooms`, { roomIds: [roomId] });
              } else {
                await apiClient.delete(`/access-entrances/${eid}/auth/rooms`, { data: { roomIds: [roomId] } });
              }
            } catch (err) { console.error(err); }
          }
          setCommunities(prev => prev.map(c2 => {
            if (c2.id === selectedRoomAuth.communityId) {
              const auth = { ...(c2.authMatrix || {}) };
              selected.forEach(eid => {
                const key = String(eid);
                if (authorize) {
                  auth[key] = [...new Set([...(auth[key] || []), roomId])];
                } else {
                  auth[key] = (auth[key] || []).filter(id => id !== roomId);
                }
              });
              return { ...c2, authMatrix: auth };
            }
            return c2;
          }));
        };
        return (
          <>
            <div className="ac-drawer-overlay" onClick={() => setShowRoomAuthDrawer(false)} />
            <div className="ac-drawer" style={{ width: '650px' }}>
              <div className="ac-drawer-header">
                <h3>入口授權 — {selectedRoomAuth.roomNumber}
                  <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', marginLeft: '8px' }}>{selectedRoomAuth.buildingName}</span>
                </h3>
                <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px' }} onClick={() => setShowRoomAuthDrawer(false)}><X size={20} /></button>
              </div>
              <div className="ac-drawer-body" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ac-stat-pill">總入口<strong>{allEntrances.length}</strong></span>
                    <span className="ac-stat-pill">已授權<strong style={{ color: '#2563eb' }}>{authEntranceIds.size}</strong></span>
                    {selEntrances.length > 0 && <span className="ac-stat-pill">已選<strong style={{ color: '#8b5cf6' }}>{selEntrances.length}</strong></span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="ac-btn-sm" type="button" disabled={selEntrances.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', opacity: selEntrances.length === 0 ? 0.4 : 1 }}
                      onClick={() => handleBatchRoomAuth(true)}>✓ 授權所選</button>
                    <button className="ac-btn-sm" type="button" disabled={selEntrances.length === 0} style={{ fontSize: '11px', padding: '0 10px', height: '28px', color: '#dc2626', opacity: selEntrances.length === 0 ? 0.4 : 1 }}
                      onClick={() => handleBatchRoomAuth(false)}>✕ 取消所選</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  {allEntrances.length === 0 ? (
                    <div className="ac-empty" style={{ padding: '20px' }}>暫無入口</div>
                  ) : (
                    <table className="ac-table" style={{ minWidth: '480px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '36px' }}><input type="checkbox" checked={allSel} style={{ accentColor: '#2563eb' }} onChange={(e) => toggleAll2(e.target.checked)} /></th>
                          <th>入口名稱</th>
                          <th>所屬</th>
                          <th style={{ width: '80px' }}>狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allEntrances.map(e => {
                          const isAuth = authEntranceIds.has(e.id);
                          return (
                            <tr key={`${e.belongType}-${e.id}`}>
                              <td><input type="checkbox" checked={!!e._sel2} style={{ accentColor: '#2563eb' }} onChange={(ev) => toggleEnt(e.id, ev.target.checked)} /></td>
                              <td style={{ fontWeight: 600, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.name}>{e.name}</td>
                              <td style={{ fontSize: '12px', color: '#9ca3af' }}>{e.belongName} ({e.belongType === 'building' ? '樓宇級' : '社區級'})</td>
                              <td>
                                {isAuth ? (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px', color: '#dc2626' }} onClick={() => handleRoomAuthOp(e.id, false)}>取消</button>
                                ) : (
                                  <button className="ac-btn-sm" type="button" style={{ fontSize: '11px', padding: '0 6px', height: '24px' }} onClick={() => handleRoomAuthOp(e.id, true)}>授權</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
      {/* 樓宇下拉菜單 (root level rendering to avoid overflow clipping) */}
      {buildingDropdownOpen && (() => {
        let buildingData = null, communityData = null;
        communities.forEach(c => (c.buildings || []).forEach(b => { if (b.id === buildingDropdownOpen.id) { buildingData = b; communityData = c; } }));
        if (!buildingData || !communityData) return null;
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={(ev) => { ev.stopPropagation(); setBuildingDropdownOpen(null); }} />
            <div style={{ position: 'fixed', top: buildingDropdownOpen.top, bottom: buildingDropdownOpen.bottom, right: buildingDropdownOpen.right, background: '#fff', border: '1px solid #1f2937', borderRadius: '10px', boxShadow: '0 10px 30px rgba(15,23,42,0.12)', zIndex: 1000, minWidth: '120px', overflow: 'hidden' }}>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); const ctx = { id: communityData.id, community: { name: communityData.name, address: communityData.address, latitude: communityData.latitude, longitude: communityData.longitude, serviceScope: communityData.serviceScope, contactPerson: communityData.contactPerson, contactPhone: communityData.contactPhone, contactEmail: communityData.contactEmail } }; addBuildingDialogRef.current?.showModal(ctx, { id: buildingData.id, name: buildingData.name, address: buildingData.address, latitude: buildingData.latitude, longitude: buildingData.longitude, serviceScope: buildingData.serviceScope, contactPerson: buildingData.contactPerson, contactPhone: buildingData.contactPhone, contactEmail: buildingData.contactEmail }); setBuildingDropdownOpen(null); }}>✎ 編輯</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); setSelectedBuildingAuth({ buildingId: buildingData.id, buildingName: buildingData.name, communityId: communityData.id, community: communityData }); setShowBuildingAuthDrawer(true); setBuildingDropdownOpen(null); }}>🔐 授權</button>
              <div style={{ height: '1px', background: '#e2e8f0' }} />
              <button className="ac-dropdown-item" type="button" style={{ color: '#dc2626' }} onClick={(ev) => { ev.stopPropagation(); handleDeleteBuilding(buildingData, communityData.id); }}>✕ 刪除</button>
            </div>
          </>
        );
      })()}
      {/* 入口下拉菜單 (root level rendering to avoid overflow clipping) */}
      {entranceDropdownOpen && (() => {
        let entranceData = null, communityData = null, buildingData = null;
        communities.forEach(c => {
          (c.communityEntrances || []).forEach(e => { if (e.id === entranceDropdownOpen.id) { entranceData = e; communityData = c; } });
          (c.buildings || []).forEach(b => (b.entrances || []).forEach(e => { if (e.id === entranceDropdownOpen.id) { entranceData = e; communityData = c; buildingData = b; } }));
        });
        if (!entranceData || !communityData) return null;
        const cId = entranceDropdownOpen.communityId;
        const bId = entranceDropdownOpen.buildingId;
        const ctx = bId ? { type: 'building', id: bId, label: buildingData?.name || '', community: { address: communityData.address, latitude: communityData.latitude, longitude: communityData.longitude, serviceScope: communityData.serviceScope, contactPerson: communityData.contactPerson, contactPhone: communityData.contactPhone, contactEmail: communityData.contactEmail } }
          : { type: 'community', id: cId, label: communityData.name, community: { address: communityData.address, latitude: communityData.latitude, longitude: communityData.longitude, serviceScope: communityData.serviceScope, contactPerson: communityData.contactPerson, contactPhone: communityData.contactPhone, contactEmail: communityData.contactEmail } };
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={(ev) => { ev.stopPropagation(); setEntranceDropdownOpen(null); }} />
            <div style={{ position: 'fixed', top: entranceDropdownOpen.top, bottom: entranceDropdownOpen.bottom, right: entranceDropdownOpen.right, background: '#fff', border: '1px solid #1f2937', borderRadius: '10px', boxShadow: '0 10px 30px rgba(15,23,42,0.12)', zIndex: 1000, minWidth: '120px', overflow: 'hidden' }}>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); addEntranceDialogRef.current?.showModal(ctx, entranceData); setEntranceDropdownOpen(null); }}>✎ 編輯</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); openAuthDrawer({ ...entranceData, communityId: cId }); setEntranceDropdownOpen(null); }}>🔑 權限</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); openDeviceDialog({ ...entranceData, buildingId: bId || undefined }, cId); setEntranceDropdownOpen(null); }}>📡 設備</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); window.alert('開發中'); setEntranceDropdownOpen(null); }}>🧪 測試</button>
              {entranceData.deviceStatus !== 'none' && (
                <button className="ac-dropdown-item" type="button" style={{ color: entranceData.isActive !== false ? '#94a3b8' : '#16a34a' }} onClick={(ev) => { ev.stopPropagation(); handleToggleEntrance({ id: entranceData.id, isActive: entranceData.isActive, communityId: cId, buildingId: bId }); }}>{entranceData.isActive !== false ? '◯ 停用' : '✓ 啟用'}</button>
              )}
              <div style={{ height: '1px', background: '#e2e8f0' }} />
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); if (!entranceData.device) { window.alert('該入口尚未綁定設備，無法生成訪問鏈接。'); setEntranceDropdownOpen(null); return; } var type = bId ? '02' : '01'; var url = (import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin) + '/access/visitor?type=' + type + '&lockId=' + encodeURIComponent(entranceData.device); window.open(url, '_blank'); setEntranceDropdownOpen(null); }}>🌐 預覽</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); if (!entranceData.device) { window.alert('該入口尚未綁定設備，無法生成訪問鏈接。'); setEntranceDropdownOpen(null); return; } var type = bId ? '02' : '01'; var url = (import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin) + '/access/visitor?type=' + type + '&lockId=' + encodeURIComponent(entranceData.device); setQrDialog({ url: url, title: entranceData.name, filename: (communityData?.name || 'community') + '-' + entranceData.name + '-' + (entranceData.device || 'device') + '-qrcode' }); setEntranceDropdownOpen(null); }}>🔗 鏈接</button>
              <button className="ac-dropdown-item" type="button" style={{ color: '#dc2626' }} onClick={(ev) => { ev.stopPropagation(); handleDeleteEntrance(entranceData, cId, bId); }}>✕ 刪除</button>
            </div>
          </>
        );
      })()}
      {/* QR Code 對話框 */}
      {qrDialog && (() => {
        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(qrDialog.url);
        return (
        <dialog ref={(el) => { if (el && !el.open) el.showModal(); }} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '400px', width: '90vw', boxShadow: '0 20px 60px rgba(15,23,42,0.18)', background: '#fff', color: '#e5e7eb' }} onClose={() => setQrDialog(null)}>
          <style>{`dialog::backdrop { background: rgba(15,23,42,0.5); backdrop-filter: blur(4px); }`}</style>
          <div style={{ padding: '28px 24px 20px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>{qrDialog.title} — 訪問鏈接</h2>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={() => setQrDialog(null)}>&#x2715;</button>
            </div>
            <img src={qrUrl} alt="QR Code" style={{ width: '220px', height: '220px', borderRadius: '8px', border: '1px solid #1f2937' }} />
            <div style={{ marginTop: '12px', fontSize: '11px', color: '#9ca3af', wordBreak: 'break-all' }}>{qrDialog.url}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={async () => { try { var r = await fetch(qrUrl); var b = await r.blob(); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (qrDialog.filename || 'qrcode') + '.png'; a.click(); URL.revokeObjectURL(a.href); } catch(e) { window.alert('下載失敗'); } }} style={{ height: '36px', padding: '0 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, border: '1px solid #d8e2ef', background: '#fff', color: '#475569', cursor: 'pointer' }}>⬇ 下載 QR</button>
              <button type="button" onClick={async () => { try { var resp = await fetch(qrUrl); var blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({[blob.type]: blob})]); window.alert('QR Code 已複製'); } catch(e) { try { await navigator.clipboard.writeText(qrDialog.url); window.alert('圖片複製失敗，已複製鏈接'); } catch(e2) { window.alert('複製失敗'); } } }} style={{ height: '36px', padding: '0 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, border: '1px solid #d8e2ef', background: '#fff', color: '#475569', cursor: 'pointer' }}>📋 複製 QR</button>
              <button type="button" onClick={() => { navigator.clipboard.writeText(qrDialog.url).then(() => window.alert('鏈接已複製')).catch(() => window.alert('複製失敗')); }} style={{ height: '36px', padding: '0 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer' }}>📋 複製鏈接</button>
            </div>
          </div>
        </dialog>
      );})()}
      {/* 設備分配對話框 */}
      {deviceDialogOpen && deviceEntrance && (
        <dialog ref={(el) => { if (el && !el.open) el.showModal(); }} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '520px', width: '90vw', boxShadow: '0 20px 60px rgba(15,23,42,0.18)', background: '#fff', color: '#e5e7eb' }} onClose={() => setDeviceDialogOpen(false)}>
          <style>{`dialog::backdrop { background: rgba(15,23,42,0.5); backdrop-filter: blur(4px); }`}</style>
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 0', flexShrink: 0 }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>綁定設備 — {deviceEntrance.name}</h2>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={() => setDeviceDialogOpen(false)}>&#x2715;</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px 24px' }}>
              {deviceLoading ? (
                <div className="ac-empty">載入中...</div>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#e5e7eb' }}>選擇設備</span>
                  <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d8e2ef', fontSize: '13px', color: '#e5e7eb', outline: 'none' }}>
                    <option value="">{deviceEntrance.deviceId ? '清除已綁定設備' : '請選擇門控設備'}</option>
                    {availableDevices.map(d => (
                      <option key={d.id} value={d.id}>{d.uuid}{d.tenantName ? ` (已分配: ${d.tenantName})` : ''}</option>
                    ))}
                  </select>
                  {availableDevices.length === 0 && !selectedDeviceId && (
                    <p style={{ fontSize: '12px', color: '#9ca3af', margin: '8px 0 0' }}>暫無可用設備</p>
                  )}
                </label>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 28px', borderTop: '1px solid #e2e8f0', background: '#1a2332', borderRadius: '0 0 16px 16px' }}>
              <button type="button" onClick={() => setDeviceDialogOpen(false)} style={{ height: '40px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '1px solid #d8e2ef', background: '#fff', color: '#475569', cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={handleAssignDevice} style={{ height: '40px', padding: '0 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer' }}>確認綁定</button>
            </div>
          </div>
        </dialog>
      )}
      {/* 社區下拉菜單 (root level rendering to avoid overflow clipping) */}
      {dropdownOpen && (() => {
        const c = communities.find(c2 => c2.id === dropdownOpen.id);
        if (!c) return null;
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={(ev) => { ev.stopPropagation(); setDropdownOpen(null); }} />
            <div style={{ position: 'fixed', top: dropdownOpen.top, bottom: dropdownOpen.bottom, right: dropdownOpen.right, background: '#fff', border: '1px solid #1f2937', borderRadius: '10px', boxShadow: '0 10px 30px rgba(15,23,42,0.12)', zIndex: 1000, minWidth: '140px', overflow: 'hidden' }}>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); addCommunityDialogRef.current?.showModal(c); setDropdownOpen(null); }}>✎ 編輯</button>
              {c.isActive !== false && (
                <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); setSelectedCommunityAuth({ communityId: c.id, communityName: c.name }); setShowCommunityAuthDrawer(true); setDropdownOpen(null); }}>🔐 授權</button>
              )}
              <button className="ac-dropdown-item" type="button" style={{ color: c.isActive === false ? '#16a34a' : '#94a3b8' }} onClick={(ev) => { ev.stopPropagation(); handleToggleCommunity(c); }}>{c.isActive === false ? '✓' : '◯'} {c.isActive === false ? '啟用' : '停用'}</button>
              <div style={{ height: '1px', background: '#e2e8f0' }} />
              <button className="ac-dropdown-item" type="button" style={{ color: '#dc2626' }} onClick={(ev) => { ev.stopPropagation(); handleDeleteCommunity(c); }}>✕ 刪除</button>
            </div>
          </>
        );
      })()}
      {/* 房間下拉菜單 (root level rendering to avoid overflow clipping) */}
      {roomDropdownOpen && (() => {
        let roomData = null, bName = '';
        communities.forEach(c => (c.buildings || []).forEach(b => {
          if (b.id === roomDropdownOpen.buildingId) {
            const r = (b.rooms || []).find(r => r.id === roomDropdownOpen.id);
            if (r) { roomData = r; bName = b.name; }
          }
        }));
        if (!roomData) return null;
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={(ev) => { ev.stopPropagation(); setRoomDropdownOpen(null); }} />
            <div style={{ position: 'fixed', top: roomDropdownOpen.top, bottom: roomDropdownOpen.bottom, right: roomDropdownOpen.right, background: '#fff', border: '1px solid #1f2937', borderRadius: '10px', boxShadow: '0 10px 30px rgba(15,23,42,0.12)', zIndex: 1000, minWidth: '120px', overflow: 'hidden' }}>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); addRoomDialogRef.current?.showModal({ buildingId: roomDropdownOpen.buildingId, buildingLabel: bName }, { id: roomData.id, roomNumber: roomData.roomNumber, floor: roomData.floor, contactPerson: roomData.contactPerson, contactPhone: roomData.contactPhone, contactEmail: roomData.contactEmail }); setRoomDropdownOpen(null); }}>✎ 編輯</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); openSipAssignDialog(roomData, roomDropdownOpen.buildingId, bName); setRoomDropdownOpen(null); }}>🔑 帳號</button>
              <button className="ac-dropdown-item" type="button" onClick={(ev) => { ev.stopPropagation(); const community = communities.find(c => (c.buildings || []).some(b2 => b2.id === roomDropdownOpen.buildingId)); setSelectedRoomAuth({ roomId: roomData.id, roomNumber: roomData.roomNumber, buildingId: roomDropdownOpen.buildingId, buildingName: bName, communityId: community?.id }); setShowRoomAuthDrawer(true); setRoomDropdownOpen(null); }}>🔐 授權</button>
              <div style={{ height: '1px', background: '#e2e8f0' }} />
              <button className="ac-dropdown-item" type="button" style={{ color: '#dc2626' }} onClick={(ev) => { ev.stopPropagation(); handleDeleteRoom(roomData, roomDropdownOpen.buildingId); setRoomDropdownOpen(null); }}>✕ 刪除</button>
            </div>
          </>
        );
      })()}
    </section>
  );
});

export default AccessControl;
