import React, { useState, useEffect } from 'react';
import { Eye, ExternalLink, UploadCloud, ChevronRight, Plus, User, RefreshCw, Edit, Trash2 } from 'lucide-react';
import apiClient from './apiClient';

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

export default function CallCenterAdd({ onReturn, tenant, context }) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [slug, setSlug] = useState(() => Math.random().toString(36).substring(2, 10));
  const [name, setName] = useState(tenant?.companyName || '');
  const [LogoDataUrl, setLogoDataUrl] = useState('');
  const [coverDataUrl, setCoverDataUrl] = useState('');
  const [description, setDescription] = useState('QRTalkie 企業服務中心，致力於為客戶提供專業、高效、貼心的產品諮詢與技術支援服務。');
  const [welcomeMessage, setWelcomeMessage] = useState('您好！歡迎來到 QRTalkie 企業服務中心，請填寫以下資訊，我們將盡快為您安排專業的客服為您服務。');
  const [visitorEnabled, setVisitorEnabled] = useState(true); // 預設開啟訪客登記
  const [visitorTitle, setVisitorTitle] = useState('歡迎諮詢 QRTalkie 企業服務中心');
  const [visitorDescription, setVisitorDescription] = useState('為更好地為您提供服務，請您填寫以下資訊，感謝您的配合。');

  const [requireName, setRequireName] = useState(false);
  const [requirePhone, setRequirePhone] = useState(false);
  const [optionalCompany, setOptionalCompany] = useState(false);
  const [optionalContent, setOptionalContent] = useState(false);

  // C. 坐席設定 - 分類和坐席狀態
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const [isEditCategoryModalOpen, setIsEditCategoryModalOpen] = useState(false);
  const [editCategoryId, setEditCategoryId] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryError, setEditCategoryError] = useState('');

  const [isAddAgentModalOpen, setIsAddAgentModalOpen] = useState(false);
  const [ecardAccounts, setEcardAccounts] = useState([]);
  const [isEcardAccountsLoading, setIsEcardAccountsLoading] = useState(false);
  const [newAgentForm, setNewAgentForm] = useState({
    ecardId: '',
    name: '',
    sip: '',
    phone: '',
    email: '',
    title: '',
    avatarDataUrl: '',
  });
  const [agentError, setAgentError] = useState('');

  const [isEditAgentModalOpen, setIsEditAgentModalOpen] = useState(false);
  const [editAgentForm, setEditAgentForm] = useState({
    id: '',
    ecardId: '',
    name: '',
    sip: '',
    phone: '',
    email: '',
    title: '',
    avatarDataUrl: '',
  });
  const [editAgentError, setEditAgentError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const activeCategory = categories.find(cat => cat.id === activeCategoryId);

  useEffect(() => {
    if (context?.mode === 'edit' && context?.id && !dataLoaded) {
      setIsInitializing(true);
      apiClient.get(`/call-centers/${context.id}`)
        .then(res => {
          if (res && res.code === 0 && res.data) {
            const data = res.data;
            setName(data.name || '');
            setSlug(data.slug || '');
            setLogoDataUrl(data.LogoDataUrl || '');
            setCoverDataUrl(data.coverDataUrl || '');
            setDescription(data.description || '');
            setWelcomeMessage(data.welcomeMessage || '');
            setVisitorEnabled(data.visitorEnabled);
            setVisitorTitle(data.visitorTitle || '');
            setVisitorDescription(data.visitorDescription || '');
            setRequireName((data.requiredFields || []).includes('name'));
            setRequirePhone((data.requiredFields || []).includes('phone'));
            setOptionalCompany((data.optionalFields || []).includes('company'));
            setOptionalContent((data.optionalFields || []).includes('content'));
            setCategories(data.categories || []);
            if (data.categories?.length > 0) setActiveCategoryId(data.categories[0].id);
          }
        })
        .catch(err => alert("加載呼叫中心數據失敗: " + (err.response?.data?.message || err.message)))
        .finally(() => { setIsInitializing(false); setDataLoaded(true); });
    }
  }, [context, dataLoaded]);

  const handleSaveAndPublish = async () => {
    if (!name.trim()) return window.alert('請輸入呼叫中心名稱');
    if (!slug.trim()) return window.alert('請輸入唯一標識 Slug');

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim(),
        LogoDataUrl,
        coverDataUrl,
        description: description.trim(),
        welcomeMessage: welcomeMessage.trim(),
        visitorEnabled,
        visitorTitle: visitorTitle.trim(),
        visitorDescription: visitorDescription.trim(),
        requireName,
        requirePhone,
        optionalCompany,
        optionalContent,
        categories: categories.map(cat => ({
          name: cat.name,
          agents: cat.agents.map(agent => ({
            ecardId: agent.ecardId || null,
            name: agent.name,
            title: agent.title,
            phone: agent.phone,
            email: agent.email,
            sip: agent.sip,
            avatarDataUrl: agent.avatarDataUrl
          }))
        }))
      };

      if (context?.mode === 'edit' && context?.id) {
        await apiClient.put(`/call-centers/${context.id}`, payload);
        window.alert('呼叫中心已成功更新並發佈！');
      } else {
        await apiClient.post('/call-centers', payload);
        window.alert('呼叫中心已成功儲存並發佈！');
      }
      if (onReturn) onReturn();
    } catch (err) {
      console.error(err);
      window.alert(err.message || '儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (tenant?.companyName && !name) {
      setName(tenant.companyName);
    }
  }, [tenant]);

  const handleRefreshSlug = () => {
    setSlug(Math.random().toString(36).substring(2, 10));
  };

  const baseUrl = import.meta.env.VITE_CALL_CENTER_BASE_URL || window.location.origin;
  const callUrl = `${baseUrl}/callcenter?id=${slug}`;

  const handleImageUpload = (setter) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setter(event.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 允許重複選擇同名檔案
  };

  const handleAddCategoryClick = () => {
    setNewCategoryName('');
    setCategoryError('');
    setIsAddCategoryModalOpen(true);
  };

  const handleAddCategorySubmit = () => {
    if (!newCategoryName.trim()) {
      setCategoryError('分類名稱不能為空');
      return;
    }
    const normalizedNewName = newCategoryName.trim();
    if (categories.some(cat => cat.name === normalizedNewName)) {
      setCategoryError('分類名稱已存在，請重新輸入');
      return;
    }
    const newId = categories.length > 0 ? Math.max(...categories.map(cat => cat.id)) + 1 : 1;
    setCategories(prev => [...prev, { id: newId, name: normalizedNewName, agentCount: 0, agents: [] }]);
    setActiveCategoryId(newId); // 自動選中新建立的分類
    setIsAddCategoryModalOpen(false);
  };

  const handleEditCategoryClick = (category, e) => {
    e.stopPropagation();
    setEditCategoryId(category.id);
    setEditCategoryName(category.name);
    setEditCategoryError('');
    setIsEditCategoryModalOpen(true);
  };

  const handleEditCategorySubmit = () => {
    if (!editCategoryName.trim()) {
      setEditCategoryError('分類名稱不能為空');
      return;
    }
    const normalizedName = editCategoryName.trim();
    if (categories.some(cat => cat.name === normalizedName && cat.id !== editCategoryId)) {
      setEditCategoryError('分類名稱已存在，請重新輸入');
      return;
    }
    setCategories(prev => prev.map(cat => cat.id === editCategoryId ? { ...cat, name: normalizedName } : cat));
    setIsEditCategoryModalOpen(false);
  };

  const handleDeleteCategory = (id, e) => {
    e.stopPropagation();
    const category = categories.find(cat => cat.id === id);
    if (category.agentCount > 0) return window.alert('該分類下存在坐席，無法直接刪除。請先移除坐席或將其轉移至其他分類。');
    
    if (!window.confirm(`確定要刪除分類「${category.name}」嗎？`)) return;
    const newCategories = categories.filter(cat => cat.id !== id);
    setCategories(newCategories);
    if (activeCategoryId === id) {
      setActiveCategoryId(newCategories.length > 0 ? newCategories[0].id : null);
    }
  };

  const fetchEcardAccounts = async () => {
    setIsEcardAccountsLoading(true);
    try {
      const data = await apiClient.get('/tenant/ecard-accounts');
      const validAccounts = (data.accounts || []).filter(acc => acc.configured && acc.enabled);
      setEcardAccounts(validAccounts);
    } catch(err) {
      console.error(err);
    } finally {
      setIsEcardAccountsLoading(false);
    }
  };

  const handleAddAgentClick = () => {
    setNewAgentForm({ ecardId: '', name: '', sip: '', phone: '', email: '', title: '', avatarDataUrl: '' });
    setAgentError('');
    setIsAddAgentModalOpen(true);
    fetchEcardAccounts();
  };

  const handleEcardSelect = (e) => {
    const ecardId = e.target.value;
    if (!ecardId) {
      setNewAgentForm({ ...newAgentForm, ecardId: '', name: '', sip: '', avatarDataUrl: '' });
      return;
    }
    const acc = ecardAccounts.find(a => String(a.id) === String(ecardId));
    if (acc) {
      setNewAgentForm({
        ...newAgentForm,
        ecardId: acc.id,
        name: acc.userName || '',
        sip: acc.sipAccount || '',
        avatarDataUrl: acc.avatarUrl || '',
      });
      setAgentError('');
    }
  };

  const handleAddAgentSubmit = () => {
    if (!newAgentForm.ecardId) return setAgentError('請選擇電子名片');
    if (!newAgentForm.name.trim()) return setAgentError('請輸入坐席姓名');
    if (!newAgentForm.title.trim()) return setAgentError('請輸入職務');
    
    if (activeCategory.agents.some(agent => String(agent.sip) === String(newAgentForm.sip))) {
      return setAgentError('該坐席已存在於當前服務分類中，不能重複新增');
    }

    const newAgent = {
      id: Date.now(),
      ecardId: newAgentForm.ecardId,
      name: newAgentForm.name.trim(),
      sip: newAgentForm.sip,
      phone: newAgentForm.phone.trim(),
      email: newAgentForm.email.trim(),
      title: newAgentForm.title.trim(),
      avatarDataUrl: newAgentForm.avatarDataUrl,
    };

    setCategories(prev => prev.map(cat => cat.id === activeCategoryId ? { ...cat, agents: [...cat.agents, newAgent], agentCount: cat.agents.length + 1 } : cat));
    setIsAddAgentModalOpen(false);
  };

  const handleEditAgentClick = (agent) => {
    setEditAgentForm({
      id: agent.id,
      ecardId: agent.ecardId || '',
      name: agent.name || '',
      sip: agent.sip || '',
      phone: agent.phone || '',
      email: agent.email || '',
      title: agent.title || '',
      avatarDataUrl: agent.avatarDataUrl || '',
    });
    setEditAgentError('');
    setIsEditAgentModalOpen(true);
  };

  const handleEditAgentSubmit = () => {
    if (!editAgentForm.name.trim()) return setEditAgentError('請輸入坐席姓名');
    if (!editAgentForm.title.trim()) return setEditAgentError('請輸入職務');

    const updatedAgent = {
      ...editAgentForm,
      name: editAgentForm.name.trim(),
      ecardId: editAgentForm.ecardId,
      phone: editAgentForm.phone.trim(),
      email: editAgentForm.email.trim(),
      title: editAgentForm.title.trim(),
    };

    setCategories(prev => prev.map(cat => cat.id === activeCategoryId ? { ...cat, agents: cat.agents.map(a => a.id === updatedAgent.id ? { ...a, ...updatedAgent } : a) } : cat));
    setIsEditAgentModalOpen(false);
  };

  const handleRemoveAgent = (agentId) => {
    if (!window.confirm('確定要從當前分類中移除該坐席嗎？')) return;
    setCategories(prev => prev.map(cat => {
      if (cat.id === activeCategoryId) {
        const newAgents = cat.agents.filter(a => a.id !== agentId);
        return { ...cat, agents: newAgents, agentCount: newAgents.length };
      }
      return cat;
    }));
  };

  return (
    <div className="cc-add-page">
      <style>{`
        .cc-add-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 24px 32px;
          min-height: 100%;
          background: transparent;
          color: #e5e7eb;
          font-family: system-ui, -apple-system, sans-serif;
          width: 100%;
          box-sizing: border-box;
        }
        .cc-add-page * { scrollbar-width: thin; scrollbar-color: #374151 transparent; }
        .cc-add-page *::-webkit-scrollbar { width: 6px; height: 6px; }
        .cc-add-page *::-webkit-scrollbar-track { background: transparent; }
        .cc-add-page *::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }

        .cc-add-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 32px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);
          position: sticky;
          top: 0;
          z-index: 50;
          width: 100%;
          box-sizing: border-box;
        }
        .cc-add-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0;
          color: #f3f4f6;
        }
        .cc-add-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .cc-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 38px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          outline: none;
        }
        .cc-btn-outline {
          background: #111827;
          border: 1px solid #374151;
          color: #9ca3af;
        }
        .cc-btn-outline:hover {
          background: #1a2332;
          color: #e5e7eb;
        }
        .cc-btn-preview {
          background: #111827;
          border: 1px solid #374151;
          color: #9ca3af;
        }
        .cc-btn-preview:hover {
          background: #1a2332;
          color: #e5e7eb;
        }
        .cc-btn-primary {
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%);
          color: #fff;
          border: none;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
        }
        .cc-btn-primary:hover {
          filter: brightness(1.05);
        }
        .cc-btn-ghost {
          background: transparent;
          border: none;
          color: #9ca3af;
          padding: 0 8px;
        }
        .cc-btn-ghost:hover {
          background: #1a2332;
          color: #e5e7eb;
        }
        .cc-btn-danger-outline {
          background: #111827;
          border: 1px solid #7f1d1d;
          color: #f87171;
        }
        .cc-btn-danger-outline:hover {
          background: #1a2332;
        }
        .cc-btn-blue-outline {
          background: #111827;
          border: 1px solid #1e3a5f;
          color: #60a5fa;
        }
        .cc-btn-blue-outline:hover {
          background: #1a2332;
        }

        .cc-add-content {
          display: flex;
          flex-direction: column;
          gap: 24px;
          width: 100%;
          box-sizing: border-box;
        }

        .cc-card {
          background: #111827;
          border-radius: 12px;
          border: 1px solid #1f2937;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);
          padding: 32px;
          width: 100%;
          box-sizing: border-box;
        }
        .cc-card-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 24px 0;
          color: #f3f4f6;
        }

        .cc-basic-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 56px;
          align-items: start;
        }
        .cc-basic-left, .cc-basic-right {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .cc-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 40px;
        }
        .cc-form-col {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .cc-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cc-field-label {
          font-size: 14px;
          font-weight: 500;
          color: #9ca3af;
          line-height: 20px;
        }
        .cc-field-label.required::after {
          content: '*';
          color: #ef4444;
          margin-left: 4px;
        }
        .cc-input {
          height: 44px;
          padding: 0 14px;
          border: 1px solid #374151;
          border-radius: 8px;
          font-size: 14px;
          color: #e5e7eb;
          background: #111827;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }
        .cc-input:focus, .cc-textarea:focus {
          border-color: #3b82f6;
        }
        .cc-input[readonly] {
          background: #1a2332;
          color: #9ca3af;
          border-color: #374151;
        }
        .cc-input:disabled, .cc-textarea:disabled {
          background: #1a2332;
          color: #6b7280;
          border-color: #374151;
          cursor: not-allowed;
        }
        .cc-textarea {
          min-height: 118px;
          padding: 12px 14px;
          border: 1px solid #374151;
          border-radius: 8px;
          font-size: 14px;
          color: #e5e7eb;
          background: #111827;
          outline: none;
          resize: vertical;
          font-family: inherit;
          line-height: 1.5;
          box-sizing: border-box;
        }
        .cc-help-text {
          font-size: 12px;
          color: #6b7280;
          margin-top: 2px;
        }

        .cc-upload-box {
          padding: 12px;
          text-align: center;
          border: 1px dashed #374151;
          border-radius: 10px;
          background: #1a2332;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.2s;
          box-sizing: border-box;
        }
        .cc-upload-box:hover {
          border-color: #60a5fa;
          background: #1a2332;
          color: #60a5fa;
        }
        .cc-upload-box.cc-upload-Logo {
          width: 160px;
          height: 160px;
        }
        .cc-upload-box.cc-upload-cover {
          width: 160px;
          height: 160px;
        }
        .cc-upload-text {
          font-size: 14px;
          font-weight: 500;
          color: #9ca3af;
        }
        .cc-upload-hint {
          font-size: 12px;
          color: #6b7280;
        }

        .cc-switch {
          width: 36px;
          height: 20px;
          border-radius: 999px;
          position: relative;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .cc-switch.on { background-color: #2563eb; }
        .cc-switch.off { background-color: #374151; }
        .cc-switch::after {
          content: '';
          position: absolute;
          top: 2px;
          width: 16px;
          height: 16px;
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
          transition: left 0.2s;
        }
        .cc-switch.on::after { left: 18px; }
        .cc-switch.off::after { left: 2px; }

        .cc-checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 4px;
        }
        .cc-checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #9ca3af;
          font-weight: normal;
          cursor: pointer;
        }
        .cc-checkbox-label.disabled {
          color: #6b7280;
          cursor: not-allowed;
        }
        .cc-checkbox-label input {
          width: 16px;
          height: 16px;
          cursor: pointer;
          accent-color: #2563eb;
        }
        .cc-checkbox-label.disabled input {
          cursor: not-allowed;
        }

        .cc-agent-layout {
          display: flex;
          gap: 32px;
          align-items: flex-start;
        }
        .cc-agent-sidebar {
          flex: 0 0 240px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cc-agent-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .cc-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cc-category-header span {
          font-size: 14px;
          font-weight: 600;
          color: #f3f4f6;
        }
        .cc-category-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cc-category-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border: 1px solid #1f2937;
          border-radius: 8px;
          background: #111827;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cc-category-item:hover {
          border-color: #374151;
          background: #1a2332;
        }
        .cc-category-item.active {
          border-color: #3b82f6;
          background: #1e293b;
        }
        .cc-category-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cc-category-name {
          font-size: 14px;
          font-weight: 500;
          color: #e5e7eb;
        }
        .cc-category-item.active .cc-category-name {
          color: #60a5fa;
          font-weight: 600;
        }
        .cc-category-count {
          font-size: 12px;
          color: #9ca3af;
        }
        .cc-category-actions {
          display: none;
          align-items: center;
          gap: 2px;
        }
        .cc-category-item:hover .cc-category-actions { display: flex; }
        .cc-category-item:hover .cc-category-chevron { display: none; }
        .cc-category-action-btn {
          background: transparent;
          border: none;
          color: #6b7280;
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .cc-category-action-btn:hover { background: #374151; color: #e5e7eb; }
        .cc-category-action-btn.delete:hover { background: #7f1d1d; color: #fca5a5; }

        .cc-agent-main-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 16px;
          border-bottom: 1px solid #1f2937;
        }
        .cc-agent-main-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cc-agent-main-title h4 {
          margin: 0;
          font-size: 16px;
          color: #f3f4f6;
          font-weight: 600;
        }
        .cc-agent-badge {
          background: #1a2332;
          color: #9ca3af;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
        }

        .cc-agent-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .cc-agent-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cc-agent-card-top {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .cc-agent-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #374151;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
          flex-shrink: 0;
        }
        .cc-agent-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          flex: 1;
        }
        .cc-agent-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cc-agent-name {
          font-size: 15px;
          font-weight: 600;
          color: #f3f4f6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cc-agent-title {
          font-size: 13px;
          color: #9ca3af;
        }
        .cc-agent-contact {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 13px;
          color: #9ca3af;
          padding: 12px 0;
          border-top: 1px solid #1f2937;
          border-bottom: 1px solid #1f2937;
        }
        .cc-agent-card-actions {
          display: flex;
          gap: 8px;
        }
        .cc-agent-card-actions .cc-btn {
          flex: 1;
          height: 32px;
          font-size: 12px;
        }

        .cc-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.2s ease-out;
        }
        .cc-modal-content {
          background: #111827;
          border-radius: 12px;
          width: 420px;
          max-width: 90vw;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.4);
          border: 1px solid #1f2937;
        }
        .cc-modal-header {
          padding: 16px 24px;
          border-bottom: 1px solid #1f2937;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cc-modal-title { font-size: 16px; font-weight: 600; color: #f3f4f6; margin: 0; }
        .cc-modal-close-btn { background: none; border: none; color: #9ca3af; font-size: 24px; cursor: pointer; line-height: 1; }
        .cc-modal-body { padding: 24px; display: flex; flex-direction: column; gap: 12px; }
        .cc-modal-error { color: #f87171; font-size: 13px; min-height: 18px; }
        .cc-modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #1f2937;
          background: #1a2332;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        @media (max-width: 900px) {
          .cc-basic-layout {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }
      `}</style>

      {/* 顶部操作区 */}
      <div className="cc-add-header">
        <h2 className="cc-add-title">{context?.mode === 'edit' ? '編輯呼叫中心' : '新增呼叫中心'}</h2>
        <div className="cc-add-actions">
          <button 
            type="button" 
            className="cc-btn cc-btn-preview" 
            style={{ color: '#60a5fa', borderColor: '#1e3a5f', background: '#1e293b' }}
            onClick={() => window.open(callUrl, '_blank')}
          >
            <Eye size={16} />
            預覽訪客頁
            <ExternalLink size={14} style={{ marginLeft: '2px', opacity: 0.7 }} />
          </button>
          <button type="button" className="cc-btn cc-btn-outline" onClick={onReturn} disabled={isSaving}>返回列表</button>
          <button type="button" className="cc-btn cc-btn-primary" onClick={handleSaveAndPublish} disabled={isSaving}>
            {isSaving ? '儲存中...' : '儲存並發佈'}
          </button>
        </div>
      </div>

      {/* 頁面主體內容 */}
      <div className="cc-add-content">
        
        {/* A. 基礎資訊區塊 */}
        <div className="cc-card">
          <h3 className="cc-card-title" style={{ marginBottom: '28px' }}>A. 基礎資訊</h3>
          <div className="cc-basic-layout" style={{ marginBottom: '32px' }}>
            <div className="cc-basic-left">
              <div className="cc-field">
                <span className="cc-field-label required">呼叫中心名稱</span>
                <input type="text" className="cc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：QRTalkie 企業服務中心" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="cc-field">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="cc-field-label required" style={{ margin: 0 }}>唯一標識 Slug</span>
                    <button type="button" onClick={handleRefreshSlug} title="重新生成" style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }} onMouseOver={(e) => e.currentTarget.style.color = '#60a5fa'} onMouseOut={(e) => e.currentTarget.style.color = '#6b7280'}><RefreshCw size={14} /></button>
                  </div>
                  <input type="text" className="cc-input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="例如：qrtalkie-service" />
                </div>
                <div className="cc-field">
                  <span className="cc-field-label">訪問 URL</span>
                  <input type="text" className="cc-input" readOnly value={callUrl} />
                </div>
              </div>
            </div>
            <div className="cc-basic-right">
              <div style={{ display: 'flex', gap: '24px' }}>
                <div className="cc-field">
                  <span className="cc-field-label">企業Logo</span>
                  <label className="cc-upload-box cc-upload-Logo" style={{ padding: LogoDataUrl ? 0 : '12px', overflow: 'hidden' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload(setLogoDataUrl)} />
                    {LogoDataUrl ? (
                      <img src={getFullImageUrl(LogoDataUrl)} alt="企業Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <>
                        <UploadCloud size={24} />
                        <span className="cc-upload-text">點擊上傳 Logo</span>
                        <span className="cc-upload-hint">支援 JPG、PNG 格式，建議尺寸 200×200px</span>
                      </>
                    )}
                  </label>
                </div>
                <div className="cc-field">
                  <span className="cc-field-label">網站封面</span>
                  <label className="cc-upload-box cc-upload-cover" style={{ padding: coverDataUrl ? 0 : '12px', overflow: 'hidden' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload(setCoverDataUrl)} />
                    {coverDataUrl ? (
                      <img src={getFullImageUrl(coverDataUrl)} alt="網站封面" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <>
                        <UploadCloud size={24} />
                        <span className="cc-upload-text">點擊上傳封面图</span>
                        <span className="cc-upload-hint">支援 JPG、PNG 格式，建議尺寸 1200×400px</span>
                      </>
                    )}
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div className="cc-field">
              <span className="cc-field-label">呼叫中心簡介</span>
              <input type="text" className="cc-input" placeholder="例如：致力於為客戶提供專業、高效、貼心的產品諮詢與技術支援服務。" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="cc-field">
              <span className="cc-field-label">歡迎語</span>
              <input type="text" className="cc-input" placeholder="例如：您好！歡迎來到 QRTalkie 企業服務中心！" value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} />
            </div>
          </div>
        </div>

        {/* B. 訪客登記設定區塊 */}
        <div className="cc-card">
          <h3 className="cc-card-title">B. 訪客登記設定</h3>
          <div className="cc-form-grid">
            <div className="cc-form-col">
              <div className="cc-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                <span className="cc-field-label" style={{ margin: 0 }}>訪客登記</span>
                <div className={`cc-switch ${visitorEnabled ? 'on' : 'off'}`} onClick={() => setVisitorEnabled(!visitorEnabled)}></div>
              </div>
              <div className="cc-field">
                <span className="cc-field-label">彈窗標題</span>
                <input type="text" className="cc-input" placeholder="例如：歡迎諮詢 QRTalkie 企業服務中心" value={visitorTitle} onChange={e => setVisitorTitle(e.target.value)} disabled={!visitorEnabled} />
              </div>
              <div className="cc-field">
                <span className="cc-field-label">彈窗說明</span>
                <textarea className="cc-textarea" value={visitorDescription} onChange={e => setVisitorDescription(e.target.value)} disabled={!visitorEnabled}></textarea>
              </div>
            </div>
            <div className="cc-form-col">
              <div className="cc-field">
                <span className="cc-field-label">必填欄位配置</span>
                <div className="cc-checkbox-group">
                  <label className={`cc-checkbox-label ${!visitorEnabled ? 'disabled' : ''}`}>
                    <input type="checkbox" defaultChecked disabled /> 郵箱（必填）
                  </label>
                  <label className={`cc-checkbox-label ${!visitorEnabled ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={requireName} onChange={e => setRequireName(e.target.checked)} disabled={!visitorEnabled} /> 姓名
                  </label>
                  <label className={`cc-checkbox-label ${!visitorEnabled ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={requirePhone} onChange={e => setRequirePhone(e.target.checked)} disabled={!visitorEnabled} /> 電話
</label>
                </div>
              </div>
            </div>
            <div className="cc-form-col">
              <div className="cc-field">
                <span className="cc-field-label">選填欄位配置</span>
                <div className="cc-checkbox-group">
                  <label className={`cc-checkbox-label ${!visitorEnabled ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={optionalCompany} onChange={e => setOptionalCompany(e.target.checked)} disabled={!visitorEnabled} /> 公司
                  </label>
                  <label className={`cc-checkbox-label ${!visitorEnabled ? 'disabled' : ''}`}>
                    <input type="checkbox" checked={optionalContent} onChange={e => setOptionalContent(e.target.checked)} disabled={!visitorEnabled} /> 諮詢內容
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* C. 坐席設定區塊 */}
        <div className="cc-card">
          <h3 className="cc-card-title">C. 坐席設定</h3>
          <div className="cc-agent-layout">
            {/* 左側分類 */}
            <div className="cc-agent-sidebar">
              <div className="cc-category-header">
                <span>服務分類設定</span> {/* 新增分類按鈕 */}
                <button type="button" className="cc-btn cc-btn-ghost" style={{ color: '#60a5fa' }} onClick={handleAddCategoryClick}>
                  <Plus size={14} /> 新增分類
                </button>
              </div>
              <div className="cc-category-list">
                {categories.map(category => (
                  <div
                    key={category.id}
                    className={`cc-category-item ${category.id === activeCategoryId ? 'active' : ''}`}
                    onClick={() => setActiveCategoryId(category.id)}
                  >
                    <div className="cc-category-info">
                      <span className="cc-category-name">{category.name}</span>
                      <span className="cc-category-count">{category.agentCount}名坐席</span>
                    </div>
                    <ChevronRight className="cc-category-chevron" size={16} color="#6b7280" />
                    <div className="cc-category-actions">
                      <button type="button" className="cc-category-action-btn" title="編輯" onClick={(e) => handleEditCategoryClick(category, e)}>
                        <Edit size={14} />
                      </button>
                      <button type="button" className="cc-category-action-btn delete" title="刪除" onClick={(e) => handleDeleteCategory(category.id, e)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* 右側坐席列表 */}
            <div className="cc-agent-main">
              <div className="cc-agent-main-header">
                <div className="cc-agent-main-title">
                  <h4>{activeCategory?.name}坐席</h4>
                  <span className="cc-agent-badge">共 {activeCategory?.agentCount} 名坐席</span>
                </div>
                <button type="button" className="cc-btn cc-btn-outline" onClick={handleAddAgentClick}>
                  <Plus size={16} /> 新增坐席
                </button>
              </div>
              
              <div className="cc-agent-grid">
                {!activeCategory ? (
                  <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', backgroundColor: '#1a2332', borderRadius: '8px', border: '1px dashed #374151' }}>
                    請先在左側新增或選擇一個服務分類。
                  </div>
                ) : activeCategory.agents.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px', backgroundColor: '#1a2332', borderRadius: '8px', border: '1px dashed #374151' }}>
                    該分類下暫無坐席，請點擊右上方按鈕新增。
                  </div>
                ) : (
                  activeCategory?.agents.map(agent => (
                    <div className="cc-agent-card" key={agent.id}>
                      <div className="cc-agent-card-top">
                        <div className="cc-agent-avatar" style={{ fontSize: '18px', fontWeight: 'bold', overflow: 'hidden' }}>
                          {agent.avatarDataUrl ? (
                            <img src={getFullImageUrl(agent.avatarDataUrl)} alt={agent.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : agent.name ? (
                            agent.name.charAt(0).toUpperCase()
                          ) : <User size={24} />}
                        </div>
                        <div className="cc-agent-info">
                          <div className="cc-agent-name-row">
                            <span className="cc-agent-name">{agent.name}</span>
                          </div>
                          <span className="cc-agent-title">{agent.title}</span>
                        </div>
                      </div>
                      <div className="cc-agent-contact">
                        <span>SIP號碼：{agent.sip}</span>
                        <span>電話：{agent.phone || '-'}</span>
                        <span>郵箱：{agent.email || '-'}</span>
                      </div>
                      <div className="cc-agent-card-actions">
                        <button type="button" className="cc-btn cc-btn-blue-outline" onClick={() => handleEditAgentClick(agent)}>編輯</button>
                        <button type="button" className="cc-btn cc-btn-danger-outline" onClick={() => handleRemoveAgent(agent.id)}>移除</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 新增分類彈窗 */}
      {isAddCategoryModalOpen && (
        <div className="cc-modal-overlay" onClick={() => setIsAddCategoryModalOpen(false)}>
          <div className="cc-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="cc-modal-header">
              <h4 className="cc-modal-title">新增服務分類</h4>
              <button type="button" className="cc-modal-close-btn" onClick={() => setIsAddCategoryModalOpen(false)}>&times;</button>
            </div>
            <div className="cc-modal-body">
              <label className="cc-field">
                <span className="cc-field-label required">分類名稱</span>
                <input
                  type="text"
                  className="cc-input"
                  value={newCategoryName}
                  onChange={(e) => { setNewCategoryName(e.target.value); if (categoryError) setCategoryError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategorySubmit(); }}
                  placeholder="例如：產品諮詢"
                  autoFocus
                />
              </label>
              <div className="cc-modal-error">{categoryError}</div>
            </div>
            <div className="cc-modal-footer">
              <button type="button" className="cc-btn cc-btn-outline" onClick={() => setIsAddCategoryModalOpen(false)}>取消</button>
              <button type="button" className="cc-btn cc-btn-primary" onClick={handleAddCategorySubmit}>確定</button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯分類彈窗 */}
      {isEditCategoryModalOpen && (
        <div className="cc-modal-overlay" onClick={() => setIsEditCategoryModalOpen(false)}>
          <div className="cc-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="cc-modal-header">
              <h4 className="cc-modal-title">編輯服務分類</h4>
              <button type="button" className="cc-modal-close-btn" onClick={() => setIsEditCategoryModalOpen(false)}>&times;</button>
            </div>
            <div className="cc-modal-body">
              <label className="cc-field">
                <span className="cc-field-label required">分類名稱</span>
                <input
                  type="text"
                  className="cc-input"
                  value={editCategoryName}
                  onChange={(e) => { setEditCategoryName(e.target.value); if (editCategoryError) setEditCategoryError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditCategorySubmit(); }}
                  placeholder="例如：產品諮詢"
                  autoFocus
                />
              </label>
              <div className="cc-modal-error">{editCategoryError}</div>
            </div>
            <div className="cc-modal-footer">
              <button type="button" className="cc-btn cc-btn-outline" onClick={() => setIsEditCategoryModalOpen(false)}>取消</button>
              <button type="button" className="cc-btn cc-btn-primary" onClick={handleEditCategorySubmit}>確定</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增坐席彈窗 */}
      {isAddAgentModalOpen && (
        <div className="cc-modal-overlay" onClick={() => setIsAddAgentModalOpen(false)}>
          <div className="cc-modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <div className="cc-modal-header">
              <h4 className="cc-modal-title">新增坐席至「{activeCategory?.name}」</h4>
              <button type="button" className="cc-modal-close-btn" onClick={() => setIsAddAgentModalOpen(false)}>&times;</button>
            </div>
            <div className="cc-modal-body">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '8px' }}>
                <label className="cc-upload-box" style={{ width: '64px', height: '64px', borderRadius: '50%', padding: newAgentForm.avatarDataUrl ? 0 : '8px', overflow: 'hidden', flexShrink: 0, margin: 0, cursor: 'pointer' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setNewAgentForm({ ...newAgentForm, avatarDataUrl: event.target.result });
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }} />
                  {newAgentForm.avatarDataUrl ? (
                    <img src={getFullImageUrl(newAgentForm.avatarDataUrl)} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <UploadCloud size={16} />
                      <span style={{ fontSize: '10px' }}>頭像</span>
                    </div>
                  )}
                </label>
                <label className="cc-field" style={{ flex: 1 }}>
                  <span className="cc-field-label required">選擇電子名片</span>
                  <select className="cc-input" value={newAgentForm.ecardId} onChange={handleEcardSelect} style={{ backgroundColor: '#111827', cursor: 'pointer', color: '#e5e7eb' }}>
                    <option value="">請選擇...</option>
                    {isEcardAccountsLoading ? (
                      <option value="" disabled>加載中...</option>
                    ) : ecardAccounts.length === 0 ? (
                      <option value="" disabled>暫無已配置且啟用中的名片</option>
                    ) : (
                      ecardAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.userName} ({acc.sipAccount})</option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <label className="cc-field">
                <span className="cc-field-label required">坐席姓名</span>
                <input type="text" className="cc-input" value={newAgentForm.name} onChange={e => { setNewAgentForm({...newAgentForm, name: e.target.value}); setAgentError(''); }} placeholder="從名片自動獲取或手動輸入" />
              </label>
              <label className="cc-field">
                <span className="cc-field-label required">職務</span>
                <input type="text" className="cc-input" value={newAgentForm.title} onChange={e => { setNewAgentForm({...newAgentForm, title: e.target.value}); setAgentError(''); }} placeholder="例如：客戶諮詢專員" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <label className="cc-field">
                  <span className="cc-field-label">電話 (選填)</span>
                  <input type="text" className="cc-input" value={newAgentForm.phone} onChange={e => setNewAgentForm({...newAgentForm, phone: e.target.value})} />
                </label>
                <label className="cc-field">
                  <span className="cc-field-label">郵箱 (選填)</span>
                  <input type="text" className="cc-input" value={newAgentForm.email} onChange={e => setNewAgentForm({...newAgentForm, email: e.target.value})} />
                </label>
              </div>
              <div className="cc-modal-error">{agentError}</div>
            </div>
            <div className="cc-modal-footer">
              <button type="button" className="cc-btn cc-btn-outline" onClick={() => setIsAddAgentModalOpen(false)}>取消</button>
              <button type="button" className="cc-btn cc-btn-primary" onClick={handleAddAgentSubmit}>確定新增</button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯坐席彈窗 */}
      {isEditAgentModalOpen && (
        <div className="cc-modal-overlay" onClick={() => setIsEditAgentModalOpen(false)}>
          <div className="cc-modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <div className="cc-modal-header">
              <h4 className="cc-modal-title">編輯坐席</h4>
              <button type="button" className="cc-modal-close-btn" onClick={() => setIsEditAgentModalOpen(false)}>&times;</button>
            </div>
            <div className="cc-modal-body">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '8px' }}>
                <label className="cc-upload-box" style={{ width: '64px', height: '64px', borderRadius: '50%', padding: editAgentForm.avatarDataUrl ? 0 : '8px', overflow: 'hidden', flexShrink: 0, margin: 0, cursor: 'pointer' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setEditAgentForm({ ...editAgentForm, avatarDataUrl: event.target.result });
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }} />
                  {editAgentForm.avatarDataUrl ? (
                    <img src={getFullImageUrl(editAgentForm.avatarDataUrl)} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <UploadCloud size={16} />
                      <span style={{ fontSize: '10px' }}>頭像</span>
                    </div>
                  )}
                </label>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>SIP號碼：</span>
                  <strong style={{ fontSize: '14px', color: '#f3f4f6', marginLeft: '8px' }}>{editAgentForm.sip}</strong>
                </div>
              </div>
              <label className="cc-field">
                <span className="cc-field-label required">坐席姓名</span>
                <input type="text" className="cc-input" value={editAgentForm.name} onChange={e => { setEditAgentForm({...editAgentForm, name: e.target.value}); setEditAgentError(''); }} placeholder="例如：林小雨" />
              </label>
              <label className="cc-field">
                <span className="cc-field-label required">職務</span>
                <input type="text" className="cc-input" value={editAgentForm.title} onChange={e => { setEditAgentForm({...editAgentForm, title: e.target.value}); setEditAgentError(''); }} placeholder="例如：客戶諮詢專員" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <label className="cc-field">
                  <span className="cc-field-label">電話 (選填)</span>
                  <input type="text" className="cc-input" value={editAgentForm.phone} onChange={e => setEditAgentForm({...editAgentForm, phone: e.target.value})} />
                </label>
                <label className="cc-field">
                  <span className="cc-field-label">郵箱 (選填)</span>
                  <input type="text" className="cc-input" value={editAgentForm.email} onChange={e => setEditAgentForm({...editAgentForm, email: e.target.value})} />
                </label>
              </div>
              <div className="cc-modal-error">{editAgentError}</div>
            </div>
            <div className="cc-modal-footer">
              <button type="button" className="cc-btn cc-btn-outline" onClick={() => setIsEditAgentModalOpen(false)}>取消</button>
              <button type="button" className="cc-btn cc-btn-primary" onClick={handleEditAgentSubmit}>儲存修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
