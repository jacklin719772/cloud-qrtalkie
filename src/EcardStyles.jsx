import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Image as ImageIcon, Plus, Upload, Trash2, FileCode, HelpCircle } from 'lucide-react';
import apiClient from './apiClient';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('讀取檔案失敗。'));
    reader.readAsDataURL(file);
  });
}

function getFullImageUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '';
  if (apiUrl && apiUrl.startsWith('http')) {
    return apiUrl.replace(/\/api\/?$/, '') + (url.startsWith('/') ? url : `/${url}`);
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (window.location.port === '5173' || window.location.port === '3000') {
      return `http://127.0.0.1:3001${url.startsWith('/') ? url : `/${url}`}`;
    }
  }
  return url;
}

export default function EcardStyles() {
  const [styles, setStyles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const bgFileInputRef = useRef(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'add' | 'edit'
  const [previewItem, setPreviewItem] = useState(null);
  const [formData, setFormData] = useState({
    id: null,
    styleCode: '',
    styleName: '',
    styleType: 'with_company',
    status: 'active',
    description: '',
    sortOrder: 0,
    samples: [], // 用於存储上傳的範例圖片
    backgrounds: [] // 用於存储名片的可选背景圖片
  });

  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [currentCodeBgId, setCurrentCodeBgId] = useState(null);
  const [jsonConfigs, setJsonConfigs] = useState({ layoutJson: '{}', defaultStyleJson: '{}', displayConfigJson: '{}' });
  const [originalJsonConfigs, setOriginalJsonConfigs] = useState({ layoutJson: '{}', defaultStyleJson: '{}', displayConfigJson: '{}' });
  const [jsonError, setJsonError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [activeJsonType, setActiveJsonType] = useState('layout_json');
  const [previewImgSize, setPreviewImgSize] = useState({ w: 0, h: 0 });
  const [pendingJsonType, setPendingJsonType] = useState(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const jsonFileInputRef = useRef(null);

  async function loadStyles() {
    setIsLoading(true);
    try {
      const data = await apiClient.get('/admin/ecard-styles');
      setStyles(Array.isArray(data.styles) ? data.styles : []);
    } catch (err) {
      console.error('Failed to load ecard styles:', err);
      setStyles([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadStyles();
  }, []);

  const totalCount = styles.length;
  const withCompanyCount = styles.filter(s => s.styleType === 'with_company').length;
  const withoutCompanyCount = styles.filter(s => s.styleType === 'without_company').length;

  const filteredStyles = useMemo(() => {
    return styles.filter(s => {
      const matchKey = !keyword || s.styleName.includes(keyword) || s.styleCode.includes(keyword);
      const matchType = typeFilter === 'all' || s.styleType === typeFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchKey && matchType && matchStatus;
    });
  }, [styles, keyword, typeFilter, statusFilter]);

  // 點击外部關閉下拉菜单
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // 下拉菜单定位，防止超出屏幕
  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 160;
      const viewportPadding = 12;
      let left = rect.left;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, rect.right - menuWidth);
      }
      if (left < viewportPadding) left = viewportPadding;

      let top = rect.bottom + 4;
      const menuHeight = dropdownMenuRef.current?.offsetHeight || 160;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - 4 - menuHeight;
      }
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

  const openAddPage = () => {
    setFormData({
      id: null,
      styleCode: `ECARD-${Date.now().toString().slice(-6)}`, // 系统自动基於时间戳產生，保证唯一
      styleName: '',
      styleType: 'with_company',
      status: 'active',
      description: '',
      sortOrder: 0,
      samples: [],
      backgrounds: []
    });
    setViewMode('add');
  };

  const openPreview = async (item) => {
    setOpenDropdownId(null);
    try {
      const res = await apiClient.get(`/admin/ecard-styles/${item.id}`);
      setPreviewItem(res.style || item);
    } catch (err) {
      alert(err.message || '獲取預覽資訊失敗');
    }
  };

  const openEditPage = async (item) => {
    setOpenDropdownId(null);
    try {
      const res = await apiClient.get(`/admin/ecard-styles/${item.id}`);
      const detail = res.style || item;
      setFormData({
        id: detail.id,
        styleCode: detail.styleCode || '',
        styleName: detail.styleName || '',
        styleType: detail.styleType || 'with_company',
        status: detail.status || 'active',
        description: detail.description || '',
        sortOrder: detail.sortOrder || 0,
        samples: (detail.samples || []).map(s => ({
          id: s.id,
          url: s.imageUrl,
          isCover: s.isCover
        })),
        backgrounds: (detail.backgrounds || []).map(b => ({
          id: b.id,
          url: b.imageUrl,
          backgroundName: b.backgroundName,
          imageWidth: b.imageWidth || null,
          imageHeight: b.imageHeight || null,
          templateCode: b.templateCode || '',
          layoutJson: b.layoutJson || null,
          defaultStyleJson: b.defaultStyleJson || null,
          displayConfigJson: b.displayConfigJson || null
        }))
      });
      setViewMode('edit');
    } catch (err) {
      alert(err.message || '獲取詳情失敗');
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const newSamples = files.map((file, index) => ({
      id: Date.now() + index,
      file,
      url: URL.createObjectURL(file),
      isCover: formData.samples.length === 0 && index === 0 // 預設第一张為封面
    }));
    setFormData(prev => ({ ...prev, samples: [...prev.samples, ...newSamples] }));
  };

  const handleBgFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const newBackgrounds = files.map((file, index) => ({
      id: Date.now() + index + 1000,
      file,
      url: URL.createObjectURL(file),
      backgroundName: file.name.replace(/\.[^/.]+$/, ""),
      imageWidth: null, // 新增圖片时，尺寸未知
      imageHeight: null, // 新增圖片时，尺寸未知
      templateCode: '',
      layoutJson: null,
      defaultStyleJson: null,
      displayConfigJson: null
    }));
    setFormData(prev => ({ ...prev, backgrounds: [...prev.backgrounds, ...newBackgrounds] }));
    // 清空 input 值，允许重复上傳同名文件
    if (bgFileInputRef.current) bgFileInputRef.current.value = '';
  };

  const removeSample = (id) => {
    setFormData(prev => ({ ...prev, samples: prev.samples.filter(s => s.id !== id) }));
  };

  const setCover = (id) => {
    setFormData(prev => ({
      ...prev,
      samples: prev.samples.map(s => ({ ...s, isCover: s.id === id }))
    }));
  };

  const removeBackground = (id) => {
    setFormData(prev => ({ ...prev, backgrounds: prev.backgrounds.filter(bg => bg.id !== id) }));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('確定要刪除该樣式吗？')) return;
    try {
      await apiClient.delete(`/admin/ecard-styles/${id}`);
      loadStyles();
    } catch (err) {
      alert(err.message || '刪除失敗');
    }
  };

  const handleToggleStatus = async (item) => {
    setOpenDropdownId(null);
    const newStatus = item.status === 'active' ? 'disabled' : 'active';
    const actionText = newStatus === 'active' ? '啟用' : '停用';
    if (!window.confirm(`確定要${actionText}樣式「${item.styleName}」吗？`)) return;
    
    setIsLoading(true);
    try {
      await apiClient.put(`/admin/ecard-styles/${item.id}/status`, { status: newStatus });
      loadStyles();
    } catch (err) {
      alert(err.message || `${actionText}失敗`);
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const samplesWithDataUrl = await Promise.all(
        formData.samples.map(async (sample) => {
          if (sample.file) {
            const dataUrl = await readFileAsDataUrl(sample.file);
            return { id: null, isCover: sample.isCover, fileName: sample.file.name, dataUrl };
          }
          return { id: sample.id, isCover: sample.isCover, url: sample.url }; 
        })
      );

      const backgroundsWithDataUrl = await Promise.all(
        formData.backgrounds.map(async (bg) => {
          if (bg.file) {
            const dataUrl = await readFileAsDataUrl(bg.file);
            return { id: null, backgroundName: bg.backgroundName, templateCode: bg.templateCode, layoutJson: bg.layoutJson, defaultStyleJson: bg.defaultStyleJson, displayConfigJson: bg.displayConfigJson, fileName: bg.file.name, dataUrl };
          }
          return { id: bg.id, backgroundName: bg.backgroundName, templateCode: bg.templateCode, layoutJson: bg.layoutJson, defaultStyleJson: bg.defaultStyleJson, displayConfigJson: bg.displayConfigJson, url: bg.url }; 
        })
      );

      const payload = {
        styleCode: formData.styleCode,
        styleName: formData.styleName,
        styleType: formData.styleType,
        status: formData.status,
        description: formData.description,
        sortOrder: formData.sortOrder,
        samples: samplesWithDataUrl,
        backgrounds: backgroundsWithDataUrl,
      };

      if (viewMode === 'edit') {
        await apiClient.put(`/admin/ecard-styles/${formData.id}`, payload);
      } else {
        await apiClient.post('/admin/ecard-styles', payload);
      }
      setViewMode('list');
      loadStyles();
    } catch (err) {
      alert(err.message || '儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };

  if (viewMode === 'add' || viewMode === 'edit') {
    return (
      <section className="view active settings-form-page" id="ecard-styles-form" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <form className="panel" onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#ffffff', fontWeight: '600' }}>{viewMode === 'edit' ? '編輯 Ecard 樣式' : '新增 Ecard 樣式'}</h3>
              <button type="button" onClick={() => setViewMode('list')} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#e5e7eb', border: '1px solid #4b5563', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>返回列表</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#f3f4f6', marginBottom: '16px', marginTop: 0, borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>基础信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>樣式編號 <span style={{ color: '#ef4444' }}>*</span></span>
                  <input required value={formData.styleCode} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} placeholder="系统自动產生" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>樣式名稱 <span style={{ color: '#ef4444' }}>*</span></span>
                  <input required value={formData.styleName} onChange={e => setFormData({ ...formData, styleName: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#4b5563'} placeholder="例如：企业商务蓝卡" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>樣式類型 <span style={{ color: '#ef4444' }}>*</span></span>
                  <select required value={formData.styleType} onChange={e => setFormData({ ...formData, styleType: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#4b5563'}>
                    <option value="with_company">包含企业名稱</option>
                    <option value="without_company">不包含企业名稱</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>狀態 <span style={{ color: '#ef4444' }}>*</span></span>
                  <select required value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#4b5563'}>
                    <option value="active">啟用</option>
                    <option value="disabled">停用</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>描述</span>
                  <input value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#4b5563'} placeholder="简单描述该风格的特點" />
                </label>
              </div>

              <div style={{ borderTop: '1px solid #e2e8f0', margin: '32px 0' }} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#f3f4f6', margin: 0, borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>範例圖片展示</h4>
                <button type="button" className="ghost-btn" onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', color: '#3b82f6', borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
                  <Upload size={14} /> 上傳展示圖片
                </button>
                <input type="file" ref={fileInputRef} hidden multiple accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} />
              </div>

              {formData.samples.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
                  {formData.samples.map(sample => (
                    <div key={sample.id} style={{ border: `2px solid ${sample.isCover ? '#3b82f6' : '#e2e8f0'}`, borderRadius: '8px', overflow: 'hidden', position: 'relative', backgroundColor: '#f8fafc', aspectRatio: '16/9', boxShadow: sample.isCover ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'none' }}>
                      <img src={getFullImageUrl(sample.url)} alt="Ecard Sample" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        {sample.isCover && <span style={{ backgroundColor: '#3b82f6', color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '999px', fontWeight: 600 }}>封面</span>}
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeSample(sample.id); }} style={{ background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', marginLeft: 'auto', display: 'flex' }} title="刪除"><Trash2 size={14} color="#ef4444" /></button>
                      </div>
                      {!sample.isCover && (
                        <button type="button" onClick={() => setCover(sample.id)} style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(15, 23, 42, 0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', backdropFilter: 'blur(4px)', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.background = 'rgba(15, 23, 42, 0.95)'} onMouseOut={e => e.target.style.background = 'rgba(15, 23, 42, 0.75)'}>设為封面</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', border: '1px dashed #cbd5e1', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
                  暫無範例圖片，請點击右上角「上傳展示圖片」。支持 JPG, PNG, WEBP，建议尺寸 1920x1080（横版），单张不超过 5MB。
                </div>
              )}

              <div style={{ borderTop: '1px solid #e2e8f0', margin: '32px 0' }} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#f3f4f6', margin: 0, borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>名片背景图库</h4>
                <button type="button" className="ghost-btn" onClick={() => bgFileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', color: '#3b82f6', borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
                  <Upload size={14} /> 上傳背景圖片
                </button>
                <input type="file" ref={bgFileInputRef} hidden multiple accept="image/jpeg,image/png,image/webp" onChange={handleBgFileSelect} />
              </div>

              {formData.backgrounds.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
                  {formData.backgrounds.map(bg => (
                    <div key={bg.id} style={{ border: '2px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', position: 'relative', backgroundColor: '#f8fafc', aspectRatio: '16/9' }}>
                      <img src={getFullImageUrl(bg.url)} alt="Background" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: '8px' }}>
                        <button type="button" onClick={(e) => { 
                          e.stopPropagation();
                          setCurrentCodeBgId(bg.id);
                          const currentBg = formData.backgrounds.find(b => b.id === bg.id);

                          // 默认 JSON 模板
                          const DEFAULT_LAYOUT = {
                            fields: {
                              name: { x: 60, y: 280, width: 480, height: 50, borderRadius: 0, objectFit: "cover" },
                              title: { x: 60, y: 340, width: 480, height: 30, borderRadius: 0, objectFit: "cover" },
                              phone: { x: 60, y: 450, width: 280, height: 28, borderRadius: 0, objectFit: "cover" },
                              email: { x: 60, y: 485, width: 400, height: 28, borderRadius: 0, objectFit: "cover" },
                              address: { x: 60, y: 520, width: 500, height: 28, borderRadius: 0, objectFit: "cover" },
                              avatar: { x: 430, y: 50, width: 110, height: 110, borderRadius: 999, objectFit: "cover" },
                              companyLogo: { x: 60, y: 70, width: 160, height: 60, borderRadius: 0, objectFit: "contain" },
                              companyNameCn: { x: 60, y: 160, width: 400, height: 36, borderRadius: 0, objectFit: "cover" },
                              companyNameEn: { x: 60, y: 200, width: 400, height: 28, borderRadius: 0, objectFit: "cover" },
                              sloganCn: { x: 60, y: 360, width: 480, height: 28, borderRadius: 0, objectFit: "cover" },
                              sloganEn: { x: 60, y: 390, width: 480, height: 28, borderRadius: 0, objectFit: "cover" },
                              qrCaption: { x: 60, y: 650, width: 200, height: 24, borderRadius: 0, objectFit: "cover" },
                              qrCenterLogo: { x: 472, y: 572, width: 56, height: 56, borderRadius: 8, objectFit: "contain" }
                            }
                          };

                          const DEFAULT_STYLE = {
                            styles: {
                              name: { fontFamily: "sans-serif", fontWeight: "700", fontSize: 42, color: "#ffffff" },
                              title: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 20, color: "#d4af37" },
                              phone: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 18, color: "#cbd5e1" },
                              email: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 18, color: "#cbd5e1" },
                              address: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 18, color: "#cbd5e1" },
                              companyNameCn: { fontFamily: "sans-serif", fontWeight: "700", fontSize: 28, color: "#ffffff" },
                              companyNameEn: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 18, color: "#cbd5e1" },
                              sloganCn: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 20, color: "#94a3b8" },
                              sloganEn: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 18, color: "#94a3b8" },
                              qrCaption: { fontFamily: "sans-serif", fontWeight: "400", fontSize: 14, color: "#94a3b8" },
                              decorLine: { width: "400px", height: "2px", backgroundColor: "#d4af37" },
                              phoneIcon: { fontSize: 20, color: "#d4af37" },
                              emailIcon: { fontSize: 20, color: "#d4af37" },
                              addressIcon: { fontSize: 20, color: "#d4af37" }
                            }
                          };

                          const DEFAULT_DISPLAY = {
                            showQrCode: true,
                            showQrCodeDesc: true,
                            showCompanyInfo: true,
                            showEnCompanyName: true,
                            showSlogan: true
                          };

                          const templateMap = {
                            layout_json: DEFAULT_LAYOUT,
                            default_style_json: DEFAULT_STYLE,
                            display_config_json: DEFAULT_DISPLAY
                          };

                          const safeStringify = (data, type) => {
                            if (data && typeof data === 'object' && Object.keys(data).length > 0) {
                              try { return JSON.stringify(data, null, 2); } catch { return JSON.stringify(templateMap[type], null, 2); }
                            }
                            return JSON.stringify(templateMap[type] || {}, null, 2);
                          };
                          setJsonConfigs({
                            layoutJson: safeStringify(currentBg?.layoutJson, 'layout_json'),
                            defaultStyleJson: safeStringify(currentBg?.defaultStyleJson, 'default_style_json'),
                            displayConfigJson: safeStringify(currentBg?.displayConfigJson, 'display_config_json')
                          });
                          setOriginalJsonConfigs({
                            layoutJson: safeStringify(currentBg?.layoutJson, 'layout_json'),
                            defaultStyleJson: safeStringify(currentBg?.defaultStyleJson, 'default_style_json'),
                            displayConfigJson: safeStringify(currentBg?.displayConfigJson, 'display_config_json')
                          });
                          setActiveJsonType('layout_json');
                          setJsonError('');
                          setCodeModalOpen(true);
                        }} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '4px', padding: '4px', cursor: 'pointer', display: 'flex' }} title="配置 JSON">
                          <FileCode size={14} color="#60a5fa" />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeBackground(bg.id); }} style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '4px', padding: '4px', cursor: 'pointer', display: 'flex' }} title="刪除"><Trash2 size={14} color="#ef4444" /></button>
                      </div>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)' }}>
                        <input
                          type="text"
                          value={bg.backgroundName}
                          onChange={(e) => {
                            const newName = e.target.value;
                            setFormData(prev => ({
                              ...prev,
                              backgrounds: prev.backgrounds.map(b => b.id === bg.id ? { ...b, backgroundName: newName } : b)
                            }));
                          }}
                          style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', color: '#fff', outline: 'none', fontSize: '13px', padding: '4px 8px' }}
                          placeholder="輸入背景名稱"
                          onFocus={e => e.target.style.borderColor = '#fff'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.3)'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', border: '1px dashed #cbd5e1', borderRadius: '8px', backgroundColor: '#f8fafc' }}>
                  暫無背景圖片，請點击右上角「上傳背景圖片」补充图库。用户在使用该模板时可任选其中一张作為背景。
                </div>
              )}
            </div>
            
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setViewMode('list')} disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#e5e7eb', border: '1px solid #4b5563', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500 }}>取消</button>
              <button type="submit" disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500, opacity: isSaving ? 0.7 : 1 }}>{isSaving ? '儲存中...' : (viewMode === 'add' ? '儲存新建' : '儲存修改')}</button>
            </div>
          </form>
        </div>
        {codeModalOpen && createPortal(
          <div className="modal-overlay" onClick={() => setCodeModalOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(960px, 95vw)', height: '80vh', backgroundColor: '#111827', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)', position: 'relative' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a2332' }}>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 600 }}>背景圖 JSON 配置</h3>
                <button type="button" onClick={() => setCodeModalOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: '24px', padding: '0 4px', cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>✕</button>
              </div>

              <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                {/* 左侧 */}
                <div style={{ flex: '0 0 35%', borderRight: '1px solid #1f2937', padding: '24px', display: 'flex', flexDirection: 'column', overflowY: 'auto', backgroundColor: '#111827', flexShrink: 0 }}>
                  <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: '#f3f4f6' }}>背景圖預覽</h4>
                  {(() => {
                    const currentBg = formData.backgrounds.find(b => b.id === currentCodeBgId);
                    return (
                      <>
                        <div style={{ width: '100%', aspectRatio: '16/9', border: '1px solid #1f2937', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#1a2332', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {currentBg?.url || currentBg?.imageUrl ? (
                            <img src={getFullImageUrl(currentBg?.url || currentBg?.imageUrl)} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px' }}>暫無圖片</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: '#9ca3af' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>所屬樣式：</span>
                            <strong style={{ color: '#f3f4f6' }}>{formData.styleName || '-'}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>背景图名稱：</span>
                            <strong style={{ color: '#f3f4f6' }}>{currentBg?.backgroundName || '-'}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>圖片尺寸：</span>
                            <strong style={{ color: '#f3f4f6' }}>
                              {currentBg?.imageWidth && currentBg?.imageHeight ? `${currentBg.imageWidth} × ${currentBg.imageHeight}` : '未記錄'}
                            </strong>
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* 实时预览迷你画布 */}
                  {(() => {
                    const currentBg2 = formData.backgrounds.find(b => b.id === currentCodeBgId);
                    if (!currentBg2?.url && !currentBg2?.imageUrl) return null;
                    try {
                      const layoutParsed = (() => { try { const v = JSON.parse(jsonConfigs.layoutJson || '{}'); return v.fields || v; } catch { return {}; } })();
                      const styleParsed = (() => { try { const v = JSON.parse(jsonConfigs.defaultStyleJson || '{}'); return v.styles || v; } catch { return {}; } })();
                      const displayParsed = (() => { try { return JSON.parse(jsonConfigs.displayConfigJson || '{}'); } catch { return {}; } })();
                      const showQr = displayParsed.showQrCode !== false;
                      const showCompany = displayParsed.showCompanyInfo !== false;
                      const fieldList = Object.keys(layoutParsed).filter(k => k !== 'decorLine' && layoutParsed[k]?.x !== undefined);
                      return (
                        <div style={{ marginTop: '24px', padding: '12px', background: '#111827', border: '1px solid #1f2937', borderRadius: '8px' }}>
                          <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px', fontWeight: 600 }}>即時預覽</div>
                          <div style={{ position: 'relative', width: '100%', aspectRatio: previewImgSize.w && previewImgSize.h ? `${previewImgSize.w}/${previewImgSize.h}` : '16/9', borderRadius: '6px', overflow: 'hidden', border: '1px solid #1f2937' }}>
                            <img
                              src={getFullImageUrl(currentBg2?.url || currentBg2?.imageUrl)}
                              alt=""
                              onLoad={(e) => { setPreviewImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight }); }}
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            {fieldList.map(key => {
                              const layout = layoutParsed[key] || {};
                              const style = styleParsed[key] || {};
                              const testData = {
                                name: '張大明', title: '技術總監 / CTO',
                                phone: '0912-345-678', email: 'daming.zhang@example.com',
                                address: '台北市信義區信義路五段 7 號 101 大樓',
                                companyNameCn: '雲端通訊科技有限公司', companyNameEn: 'CloudQRTalkie Technology Co., Ltd.',
                                sloganCn: '讓每一次通話都安全可靠', sloganEn: 'Making Every Call Safe & Reliable',
                                qrCaption: '掃碼交換名片'
                              };
                              const sampleText = testData[key] || key;
                              if ((key === 'companyNameCn' || key === 'companyNameEn' || key === 'sloganCn' || key === 'sloganEn') && !showCompany) return null;
                              if (key === 'qrCaption' && !showQr) return null;
                              const imgW = previewImgSize.w || currentBg2?.imageWidth || 600;
                              const imgH = previewImgSize.h || currentBg2?.imageHeight || 338;
                              return (
                                <div key={key} style={{
                                  position: 'absolute',
                                  left: `${(layout.x || 0) * 100 / imgW}%`,
                                  top: `${(layout.y || 0) * 100 / imgH}%`,
                                  width: layout.width ? `${layout.width * 100 / imgW}%` : 'auto',
                                  height: layout.height ? `${layout.height * 100 / imgH}%` : 'auto',
                                  fontSize: style.fontSize ? `${Math.max(6, (style.fontSize || 14) * 0.4)}px` : '8px',
                                  fontWeight: style.fontWeight || '400',
                                  color: style.color || '#ffffff',
                                  fontFamily: style.fontFamily || 'sans-serif',
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {sampleText}
                                  <span style={{ fontSize: '5px', opacity: 0.4, display: 'block' }}>{key}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '8px', textAlign: 'center' }}>基於 layout / style / display 三組 JSON 即時渲染</div>
                        </div>
                      );
                    } catch {
                      return (
                        <div style={{ marginTop: '24px', padding: '12px', background: '#3b1111', border: '1px solid #7f1d1d', borderRadius: '8px', color: '#fca5a5', fontSize: '12px', textAlign: 'center' }}>
                          JSON 格式有誤，修正後可即時預覽
                        </div>
                      );
                    }
                  })()}
                </div>
                
                {/* 右侧 */}
                <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', padding: '24px', minHeight: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <select 
                      value={activeJsonType} 
                      onChange={e => {
                        const newType = e.target.value;
                        const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                        if (jsonConfigs[camelKey] !== originalJsonConfigs[camelKey]) {
                          setPendingJsonType(newType);
                          setShowUnsavedConfirm(true);
                        } else {
                          setActiveJsonType(newType);
                          setJsonError('');
                        }
                      }}
                      style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#111827', fontSize: '13px', color: '#f3f4f6', fontWeight: 500, cursor: 'pointer' }}
                    >
                      <option value="layout_json">layout_json (布局配置)</option>
                      <option value="default_style_json">default_style_json (預設樣式)</option>
                      <option value="display_config_json">display_config_json (顯示控制)</option>
                    </select>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" onClick={() => jsonFileInputRef.current?.click()} style={{ padding: '6px 12px', borderRadius: '6px', backgroundColor: '#111827', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '12px' }}>導入 JSON 文件</button>
                      <input type="file" ref={jsonFileInputRef} accept=".json,application/json" style={{ display: 'none' }} onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!file.name.endsWith('.json') && file.type !== 'application/json') {
                          setJsonError('請選擇 JSON 文件');
                          e.target.value = '';
                          return;
                        }
                        try {
                          const text = await file.text();
                          const parsed = JSON.parse(text);
                          const formatted = JSON.stringify(parsed, null, 2);
                          const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                          setJsonConfigs(prev => ({ ...prev, [camelKey]: formatted }));
                          setJsonError('');
                        } catch (error) {
                          if (error instanceof SyntaxError) {
                            setJsonError('JSON 格式错误：' + error.message);
                          } else {
                            setJsonError('JSON 文件讀取失敗');
                          }
                        } finally {
                          e.target.value = '';
                        }
                      }} />
                      <button type="button" onClick={() => {
                          try {
                            const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                            const jsonString = jsonConfigs[camelKey];
                            if (jsonString.trim()) {
                              const parsed = JSON.parse(jsonString);
                              setJsonConfigs(prev => ({ ...prev, [camelKey]: JSON.stringify(parsed, null, 2) }));
                            }
                            setJsonError('');
                          } catch (e) {
                            setJsonError('先修正 JSON 格式后才能格式化。');
                          }
                      }} style={{ padding: '6px 12px', borderRadius: '6px', backgroundColor: '#111827', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '12px' }}>格式化</button>
                    </div>
                  </div>

                  {jsonError && <div style={{ padding: '12px', background: '#3b1111', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: '6px', fontSize: '13px', marginBottom: '16px', flexShrink: 0 }}>{jsonError}</div>}
                  <textarea
                    value={jsonConfigs[{ 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType]]}
                    onChange={(e) => {
                      const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                      setJsonConfigs(prev => ({ ...prev, [camelKey]: e.target.value }));
                    }}
                    rows={15} // 初始行数，但 flex: 1 会使其伸展
                    spellCheck={false}
                    style={{ flex: 1, width: '100%', padding: '18px', borderRadius: '8px', border: '1px solid #374151', outline: 'none', resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '14px', lineHeight: 1.6, backgroundColor: '#1a2332', color: '#e5e7eb', boxSizing: 'border-box', minHeight: '320px' }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = '#374151'}
                  />
                  <div style={{ marginTop: '16px', padding: '10px 16px', backgroundColor: '#1a2332', borderRadius: '8px', border: '1px solid #1f2937', flexShrink: 0 }}>
                    <h5 style={{ margin: '0 0 8px', fontSize: '13px', color: '#f3f4f6', fontWeight: 600 }}>说明</h5>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#9ca3af', lineHeight: 1.6 }}>
                      <li>直接粘贴已经调试好的 JSON 内容</li>
                      <li>支持 layout_json / default_style_json / display_config_json</li>
                      <li>儲存后用於 Ecard 預覽和圖片產生</li>
                      <li>JSON 必须是合法對象格式</li>
                    </ul>
                    <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#9ca3af' }}>直接粘贴已调试好的 JSON，儲存后用於 Ecard 預覽和圖片產生。</p>
                  </div>
                </div>
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', color: '#9ca3af' }}>
                  当前配置：<strong style={{ color: '#f3f4f6' }}>{activeJsonType}</strong>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" onClick={() => setCodeModalOpen(false)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#111827', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>取消</button>
                  <button type="button" onClick={() => {
                    try {
                      const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                      const jsonString = jsonConfigs[camelKey];
                      if (jsonString.trim()) JSON.parse(jsonString);
                      alert('JSON 格式正确');
                      setJsonError('');
                    } catch (e) {
                      setJsonError('JSON 格式错误：' + e.message);
                    }
                  }} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#111827', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>校验 JSON</button>
                  <button type="button" onClick={async () => {
                    try {
                      const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                      const jsonString = jsonConfigs[camelKey];
                      const parsed = jsonString.trim() ? JSON.parse(jsonString) : null;
                      
                      if (typeof currentCodeBgId === 'number' && currentCodeBgId < 1000000000000) {
                        await apiClient.put(`/admin/ecard-style-backgrounds/${currentCodeBgId}/json-config`, {
                          configType: activeJsonType,
                          configJson: parsed
                        });
                      }
                      
                      const formattedSaved = parsed ? JSON.stringify(parsed, null, 2) : '{}';

                      setFormData(prev => ({
                        ...prev,
                        backgrounds: prev.backgrounds.map(b => b.id === currentCodeBgId ? { 
                          ...b, 
                          [camelKey]: parsed
                        } : b)
                      }));
                      setJsonConfigs(prev => ({ ...prev, [camelKey]: formattedSaved }));
                      setOriginalJsonConfigs(prev => ({ ...prev, [camelKey]: formattedSaved }));
                      
                      alert('儲存成功');
                      setJsonError('');
                    } catch (e) {
                      if (e instanceof SyntaxError) {
                        setJsonError('JSON 格式错误：' + e.message);
                      } else {
                        setJsonError('儲存配置失敗：' + (e.response?.data?.message || e.message || '請稍後重試'));
                      }
                    }
                  }} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>儲存配置</button>
                </div>
              </div>
              {showUnsavedConfirm && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
                  <div style={{ backgroundColor: '#111827', padding: '24px', borderRadius: '8px', width: '420px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)', border: '1px solid #1f2937' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#f3f4f6' }}>当前配置未儲存</h3>
                    <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#9ca3af' }}>当前 JSON 内容尚未儲存，是否先儲存当前配置？</p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                      <button type="button" onClick={() => { setShowUnsavedConfirm(false); setPendingJsonType(null); }} style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#111827', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '13px' }}>取消切换</button>
                      <button type="button" onClick={() => {
                        const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                        setJsonConfigs(prev => ({ ...prev, [camelKey]: originalJsonConfigs[camelKey] }));
                        setActiveJsonType(pendingJsonType);
                        setShowUnsavedConfirm(false);
                        setPendingJsonType(null);
                        setJsonError('');
                      }} style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#f1f5f9', color: '#9ca3af', border: '1px solid #1f2937', cursor: 'pointer', fontSize: '13px' }}>不儲存并切换</button>
                      <button type="button" onClick={async () => {
                        try {
                          const camelKey = { 'layout_json': 'layoutJson', 'default_style_json': 'defaultStyleJson', 'display_config_json': 'displayConfigJson' }[activeJsonType];
                          const jsonString = jsonConfigs[camelKey];
                          const parsed = jsonString.trim() ? JSON.parse(jsonString) : null;
                          
                          if (typeof currentCodeBgId === 'number' && currentCodeBgId < 1000000000000) {
                            await apiClient.put(`/admin/ecard-style-backgrounds/${currentCodeBgId}/json-config`, { configType: activeJsonType, configJson: parsed });
                          }
                          const formattedSaved = parsed ? JSON.stringify(parsed, null, 2) : '{}';
                          setFormData(prev => ({ ...prev, backgrounds: prev.backgrounds.map(b => b.id === currentCodeBgId ? { ...b, [camelKey]: parsed } : b) }));
                          setJsonConfigs(prev => ({ ...prev, [camelKey]: formattedSaved }));
                          setOriginalJsonConfigs(prev => ({ ...prev, [camelKey]: formattedSaved }));
                          
                          setActiveJsonType(pendingJsonType);
                          setShowUnsavedConfirm(false);
                          setPendingJsonType(null);
                          setJsonError('');
                        } catch (e) {
                          if (e instanceof SyntaxError) { 
                            setJsonError('JSON 格式错误：' + e.message); 
                          } else { 
                            setJsonError('儲存配置失敗：' + (e.response?.data?.message || e.message || '請稍後重試')); 
                          }
                          setShowUnsavedConfirm(false);
                          setPendingJsonType(null);
                        }
                      }} style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>儲存并切换</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </section>
    );
  }

  return (
    <section className="ecard-page">
      <style>{`
        .ecard-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ecard-page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ecard-page-header h2 {
          margin: 0 0 6px 0;
          font-size: 24px;
          color: #f3f4f6;
          font-weight: 700;
        }
        .ecard-page-header p {
          margin: 0;
          color: #9ca3af;
          font-size: 14px;
        }
        .ecard-primary-btn {
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%);
          color: white;
          border: none;
          padding: 0 18px;
          height: 44px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.22);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: filter 0.2s;
        }
        .ecard-primary-btn:hover {
          filter: brightness(1.1);
        }
        .ecard-card {
          background: #111827;
          border-radius: 16px;
          border: 1px solid #374151;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .ecard-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.2);
          flex-shrink: 0;
        }
        .ecard-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        .ecard-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        .ecard-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        .ecard-search input, .ecard-select {
          height: 46px;
          border: 1px solid #1f2937;
          border-radius: 9px;
          font-size: 12px;
          outline: none;
          background: #111827;
          color: #e5e7eb;
          box-sizing: border-box;
        }
        .ecard-search input {
          width: 100%;
          padding: 0 16px 0 44px;
        }
        .ecard-search input::placeholder { color: #94a3b8; }
        .ecard-search input:focus, .ecard-select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59,130,246,0.1);
        }
        .ecard-select { 
          padding: 0 12px; 
          cursor: pointer; 
          min-width: 112px;
        }
        .ecard-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .ecard-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          background: #1a2332;
          border: 1px solid #e2e8f0;
          color: #9ca3af;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .ecard-stat-pill strong {
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 700;
        }
        @media (max-width: 1100px) {
          .ecard-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          .ecard-toolbar::-webkit-scrollbar { height: 0; }
          .ecard-filter-left { flex-wrap: nowrap; }
          .ecard-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          .ecard-toolbar { padding: 18px; }
        }
        .ecard-table-wrapper {
          flex: 1;
          overflow: auto;
        }
        .ecard-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          min-width: auto;
        }
        .ecard-table th {
          position: sticky;
          top: 0;
          background: #1a2332;
          color: #9ca3af;
          font-weight: 600;
          font-size: 13px;
          padding: 14px 20px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
          z-index: 2;
        }
        .ecard-table td {
          padding: 14px 20px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 14px;
          vertical-align: middle;
          white-space: nowrap;
        }
        .ecard-action-head, .ecard-action-cell {
          position: sticky;
          right: 0;
          box-shadow: -1px 0 0 #1f2937;
          width: 140px;
          min-width: 140px;
          text-align: center;
        }
        .ecard-action-head {
          z-index: 3 !important;
          background: #f8fafc;
        }
        .ecard-action-cell {
          z-index: 1;
          background: #111827;
        }
        .ecard-table tr:hover td { background: #1a2332; }
        .ecard-table tr:hover .ecard-action-cell { background: #1a2332; }
        .ecard-preview-box {
          width: 64px;
          height: 42px;
          background: #f1f5f9;
          border-radius: 6px;
          border: 1px dashed #cbd5e1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
        }
        .ecard-tag {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .ecard-tag-green { background: #0d2818; color: #4ade80; }
        .ecard-tag-blue { background: #1e3a5f; color: #93c5fd; }
        .ecard-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
        }
        .ecard-status::before {
          content: '';
          display: block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .ecard-status-active::before { background: #22c55e; }
        .ecard-status-disabled::before { background: #94a3b8; }
        .ecard-actions {
          display: flex;
          gap: 8px;
        }
        .ecard-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: #111827;
          color: #64748b;
          cursor: pointer;
          transition: all 0.2s;
        }
        .ecard-action-btn:hover {
          border-color: #4b5563;
          color: #0f172a;
          background: #f8fafc;
        }
        .ecard-action-btn.delete:hover {
          color: #ef4444;
          border-color: #fca5a5;
          background: #7f1d1d;
        }
      `}</style>

      <div className="ecard-page-header">
        <div>
          <h2>Ecard樣式管理</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button type="button" onClick={() => setShowHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '42px', width: '42px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
          <button className="ecard-primary-btn" onClick={openAddPage}>
            <Plus size={16} /> 新增Ecard樣式
          </button>
        </div>
      </div>

      <div className="ecard-toolbar">
        <div className="ecard-filter-left">
          <label className="ecard-search">
            <Search size={18} />
            <input 
              type="search"
              value={keyword} 
              onChange={e => setKeyword(e.target.value)} 
              placeholder="搜尋樣式名稱 / 編號" 
            />
          </label>
          <select className="ecard-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">全部類型</option>
            <option value="with_company">包含企业名稱</option>
            <option value="without_company">不包含企业名稱</option>
          </select>
          <select className="ecard-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">全部狀態</option>
            <option value="active">啟用</option>
            <option value="disabled">停用</option>
          </select>
        </div>
        <div className="ecard-stats">
          <span className="ecard-stat-pill">樣式總數<strong>{totalCount}</strong></span>
          <span className="ecard-stat-pill">包含企业名稱<strong style={{ color: '#16a34a' }}>{withCompanyCount}</strong></span>
          <span className="ecard-stat-pill">不包含企业名稱<strong style={{ color: '#3b82f6' }}>{withoutCompanyCount}</strong></span>
        </div>
      </div>

      <div className="ecard-card">
        <div className="ecard-table-wrapper">
          <table className="ecard-table">
            <thead>
              <tr>
                <th>預覽图</th>
                <th>樣式名稱</th>
                <th>狀態</th>
                <th>類型</th>
                <th>範例數量</th>
                <th>新增人</th>
                <th>新增时间</th>
                <th className="ecard-action-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>載入中...</td></tr>
              ) : filteredStyles.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>没有匹配的樣式記錄</td></tr>
              ) : (
                filteredStyles.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div className="ecard-preview-box">
                        {item.coverImageUrl ? (
                          <img src={getFullImageUrl(item.coverImageUrl)} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '5px' }} />
                        ) : (
                          <ImageIcon size={18} />
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600, color: '#f3f4f6' }}>{item.styleName}</td>
                    <td>
                      <span className={`ecard-status ${item.status === 'active' ? 'ecard-status-active' : 'ecard-status-disabled'}`}>
                        {item.status === 'active' ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <span className={`ecard-tag ${item.styleType === 'with_company' ? 'ecard-tag-green' : 'ecard-tag-blue'}`}>
                        {item.styleType === 'with_company' ? '包含企业名稱' : '不包含企业名稱'}
                      </span>
                    </td>
                    <td>{item.sampleCount} 张</td>
                    <td>{item.createdByName}</td>
                    <td style={{ color: '#9ca3af' }}>{item.createdAt}</td>
                    <td className="ecard-action-cell">
                      <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', whiteSpace: 'nowrap', justifyContent: 'center' }}>
                        <button type="button" style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '5px', border: '1px solid #2563eb', background: 'transparent', color: '#60a5fa', cursor: 'pointer' }} onClick={() => openPreview(item)}>預覽</button>
                        <button
                          type="button"
                          style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '5px', border: '1px solid #4b5563', background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          
                            const button = e.currentTarget;
                            dropdownAnchorRef.current = button;
                          
                            const rect = button.getBoundingClientRect();
                            const menuWidth = 160;
                            const menuHeight = 172;
                            const viewportPadding = 12;
                          
                            let left = rect.right - menuWidth;
                            if (left < viewportPadding) {
                              left = viewportPadding;
                            }
                            if (left + menuWidth > window.innerWidth - viewportPadding) {
                              left = window.innerWidth - menuWidth - viewportPadding;
                            }
                          
                            let top = rect.bottom + 6;
                            if (top + menuHeight > window.innerHeight - viewportPadding) {
                              top = rect.top - menuHeight - 6;
                            }
                          
                            setDropdownPosition({ top, left });
                            setOpenDropdownId((current) => (current === item.id ? null : item.id));
                          }}
                        >
                          更多
                        </button>
                        {openDropdownId === item.id ? createPortal(
                          <div
                            ref={dropdownMenuRef}
                            className="dropdown-menu-portal"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'fixed',
                              top: `${dropdownPosition.top}px`,
                              left: `${dropdownPosition.left}px`,
                              zIndex: 2147483647,
                              minWidth: '160px',
                              padding: '6px',
                              background: '#1e293b',
                              border: '1px solid #1f2937',
                              borderRadius: '10px',
                              boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                            }}
                          >
                            <button
                              type="button"
                              className="dropdown-item"
                              style={{
                                width: '100%',
                                height: '34px',
                                padding: '0 12px',
                                border: 'none',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: '#e5e7eb',
                                fontSize: '13px',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                              onClick={() => openPreview(item)}
                            >
                              預覽
                            </button>
                            <button
                              type="button"
                              className="dropdown-item"
                              style={{
                                width: '100%',
                                height: '34px',
                                padding: '0 12px',
                                border: 'none',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: '#e5e7eb',
                                fontSize: '13px',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                              onClick={() => openEditPage(item)}
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              className="dropdown-item"
                              style={{
                                width: '100%',
                                height: '34px',
                                padding: '0 12px',
                                border: 'none',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: '#e5e7eb',
                                fontSize: '13px',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                              onClick={() => handleToggleStatus(item)}
                            >
                              {item.status === 'active' ? '停用' : '啟用'}
                            </button>
                            <button
                              type="button"
                              className="dropdown-item dropdown-item-danger"
                              style={{
                                width: '100%',
                                height: '34px',
                                padding: '0 12px',
                                border: 'none',
                                borderRadius: '8px',
                                background: 'transparent',
                                color: '#dc2626',
                                fontSize: '13px',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                              onClick={() => { setOpenDropdownId(null); handleDelete(item.id); }}
                            >
                              刪除
                            </button>
                          </div>,
                          document.body
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {previewItem && createPortal(
        <div className="modal-overlay" onClick={() => setPreviewItem(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(800px, 90vw)', maxHeight: '90vh', backgroundColor: '#ffffff', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a', fontWeight: 600 }}>「{previewItem.styleName}」預覽</h3>
              <button type="button" onClick={() => setPreviewItem(null)} style={{ border: 'none', background: 'transparent', fontSize: '24px', padding: '0 4px', cursor: 'pointer', color: '#64748b', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <h4 style={{ margin: '0 0 16px', fontSize: '15px', color: '#0f172a', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>範例圖片</h4>
              {previewItem.samples && previewItem.samples.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                  {previewItem.samples.map(s => (
                    <div key={s.id} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0', aspectRatio: '16/9', position: 'relative' }}>
                       <img src={getFullImageUrl(s.imageUrl)} alt="Sample" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                       {s.isCover && <span style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: '#3b82f6', color: '#fff', fontSize: '11px', padding: '2px 8px', borderRadius: '999px', fontWeight: 600 }}>封面</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#64748b', fontSize: '13px', margin: 0, padding: '20px', textAlign: 'center', border: '1px dashed #d8e2ef', borderRadius: '8px' }}>暫無範例圖片</p>
              )}

              <div style={{ borderTop: '1px solid #e2e8f0', margin: '32px 0' }} />

              <h4 style={{ margin: '0 0 16px', fontSize: '15px', color: '#0f172a', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>名片背景图库</h4>
              {previewItem.backgrounds && previewItem.backgrounds.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
                  {previewItem.backgrounds.map(b => (
                    <div key={b.id} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #1f2937', aspectRatio: '16/9', position: 'relative' }}>
                       <img src={getFullImageUrl(b.imageUrl)} alt="Background" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                       <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)', color: '#fff', fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.backgroundName}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0, padding: '20px', textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>暫無背景圖片</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>電子名片樣式 操作說明</h2>
              <button onClick={() => setShowHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127912; 電子名片樣式的作用</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>電子名片樣式庫是平台級別的名片設計模板管理。管理員在此建立並管理名片樣式，每個樣式可設定不同的排版、背景圖片和 JSON 配置。租戶在生成名片時從樣式庫中選擇套用。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增樣式</strong> — 點擊「新增Ecard樣式」按鈕建立新樣式，填寫基本資訊、上傳範例圖片和背景圖庫。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯樣式</strong> — 點擊表格行內的「編輯」按鈕修改現有樣式的所有設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>預覽樣式</strong> — 點擊「預覽」按鈕查看樣式的範例圖片和背景圖庫的完整展示。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>JSON 配置</strong> — 每個背景圖片可設定 layoutJson（佈局）、defaultStyleJson（預設樣式）和 displayConfigJson（顯示配置），點擊「CODE」按鈕編輯 JSON。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>樣式代碼</strong> — 唯一識別碼，用於 API 調用時的樣式參照。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>樣式名稱</strong> — 顯示名稱，租戶選擇樣式時可見。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>樣式類型</strong> — 包含企业名稱 / 不包含企业名稱，決定名片是否顯示公司欄位。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>狀態</strong> — 啟用 / 停用，停用的樣式不會在租戶端顯示。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>描述</strong> — 樣式的文字說明。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>排序</strong> — 數字越小越靠前，控制樣式在選擇列表中的排列順序。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>範例圖片</strong> — 最多 5 張，展示樣式效果。第一張設為封面。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>名片背景图库</strong> — 名片可選用的背景圖片，每張可設定獨立的 JSON 配置。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>樣式列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/ecard-styles</code><br/>建立/更新：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/PUT /api/admin/ecard-styles</code><br/>租戶端取得可用樣式：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/ecard-styles/active</code></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}