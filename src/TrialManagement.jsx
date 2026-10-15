import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Plus, RefreshCw, Search, UserPlus } from 'lucide-react';
import apiClient from './apiClient';

// 試用管理：添加試用帳號（掛靠保留租戶）與列表/提前結束
// 方案：试用账号模块设计方案-实施参考.md（2026-10-14）

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonthsMinusOneDay(value, months) {
  const [y, m, day] = String(value).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const PHASE_META = {
  active: { label: '試用中', color: '#4ade80', bg: '#0d2818' },
  expiring: { label: '即將到期', color: '#fbbf24', bg: '#3b2e11' },
  grace: { label: '寬限期', color: '#fb923c', bg: '#3b2411' },
  paused: { label: '已暫停', color: '#c4b5fd', bg: '#312e81' },
  converted: { label: '已轉正', color: '#60a5fa', bg: '#1e3a5f' },
  reclaimed: { label: '已回收', color: '#9ca3af', bg: '#1f2937' },
};

function emptyForm() {
  return {
    ownerTenantId: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    startedAt: todayStr(),
    expiresAt: addMonthsMinusOneDay(todayStr(), 1),
    agentId: '',
  };
}

function emptyNewTenant() {
  return { companyName: '', password: '' };
}

const TrialManagement = forwardRef(({ isPlatform = true, tenantName = '' }, ref) => {
  const [trials, setTrials] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState(isPlatform ? 'all' : 'active');
  const [filterQInput, setFilterQInput] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [filterTenantId, setFilterTenantId] = useState('');
  const [filterAgentId, setFilterAgentId] = useState('');
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [assignOpen, setAssignOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [assigning, setAssigning] = useState(false);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });

  const [stockKeyword, setStockKeyword] = useState('');
  const [stockList, setStockList] = useState([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockLoading, setStockLoading] = useState(false);
  const [selectedStocks, setSelectedStocks] = useState([]);

  const [newTenantMode, setNewTenantMode] = useState(false);
  const [newTenant, setNewTenant] = useState(emptyNewTenant());
  const [tenantAdmin, setTenantAdmin] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailCheck, setEmailCheck] = useState({ status: 'idle', text: '' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stockWebTotal, setStockWebTotal] = useState(0);
  const [addCount, setAddCount] = useState('1');
  const [addonCatalog, setAddonCatalog] = useState([]);
  const [selectedAddonCodes, setSelectedAddonCodes] = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [ecardStep, setEcardStep] = useState({ open: false, accounts: [], results: null, submitting: false });
  const [ecardStylesList, setEcardStylesList] = useState([]);
  const [ecardBackgrounds, setEcardBackgrounds] = useState([]);
  const [ecardForm, setEcardForm] = useState({ templateId: '', backgroundId: '', company: '', logoDataUrl: '' });
  const [ecardEditDraft, setEcardEditDraft] = useState(null);
  const [ecardPreviewImage, setEcardPreviewImage] = useState({ open: false, loading: false, dataUrl: '', username: '' });
  const [ecardSelectedIds, setEcardSelectedIds] = useState([]);
  const [ecardMessage, setEcardMessage] = useState({ type: '', text: '' });
  const [openActionsId, setOpenActionsId] = useState(null);
  const [reclaimConfirm, setReclaimConfirm] = useState({ open: false, trial: null });
  const [aiEntitlementAccount, setAiEntitlementAccount] = useState(null);
  const [aiEntitlementForm, setAiEntitlementForm] = useState({ enabled: true, daily_limit: 50, monthly_limit: '', expires_at: '', notes: '' });
  const [aiEntitlementMessage, setAiEntitlementMessage] = useState({ type: '', text: '' });
  const [aiEntitlementLoading, setAiEntitlementLoading] = useState(false);
  const [aiEntitlementSaving, setAiEntitlementSaving] = useState(false);
  const [accountSettingsTarget, setAccountSettingsTarget] = useState(null);
  const [accountSettingsForm, setAccountSettingsForm] = useState({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [accountSettingsMessage, setAccountSettingsMessage] = useState({ type: '', text: '' });
  const [accountSettingsLoading, setAccountSettingsLoading] = useState(false);
  const [accountSettingsSaving, setAccountSettingsSaving] = useState(false);
  const [actionsPosition, setActionsPosition] = useState({ top: 0, left: 0 });
  const actionsAnchorRef = useRef(null);
  const actionsMenuRef = useRef(null);

  async function loadTrials(overrides = {}) {
    const q = overrides.q !== undefined ? overrides.q : filterQ;
    const status = overrides.status !== undefined ? overrides.status : filterStatus;
    const tenantId = overrides.tenantId !== undefined ? overrides.tenantId : filterTenantId;
    const agentId = overrides.agentId !== undefined ? overrides.agentId : filterAgentId;
    const targetPage = overrides.page !== undefined ? overrides.page : page;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('pageSize', String(pageSize === 'all' ? 1000 : pageSize));
      if (status && status !== 'all') params.set('status', status);
      if (q) params.set('q', q);
      if (isPlatform && tenantId) params.set('ownerTenantId', tenantId);
      if (agentId) params.set('agentId', agentId);
      const data = await apiClient.get(`/admin/trials?${params.toString()}`);
      setTrials(Array.isArray(data.trials) ? data.trials : []);
      setTotal(Number(data.total || 0));
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '讀取試用列表失敗。' });
    } finally {
      setLoading(false);
    }
  }

  async function loadTenants() {
    if (!isPlatform) return;
    try {
      const data = await apiClient.get('/admin/tenants');
      const list = Array.isArray(data.tenants) ? data.tenants : [];
      setTenants(list.filter((t) => t.status === 'active'));
    } catch {
      setTenants([]);
    }
  }

  useEffect(() => {
    loadTrials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterStatus, filterTenantId, filterAgentId, filterQ]);

  useEffect(() => {
    loadTenants();
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 提示自动关闭（原则：所有提示必须定时消失，不依赖用户操作）
  useEffect(() => {
    if (!message.text) return undefined;
    const timer = setTimeout(() => setMessage({ type: '', text: '' }), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!formMessage.text) return undefined;
    const timer = setTimeout(() => setFormMessage({ type: '', text: '' }), 5000);
    return () => clearTimeout(timer);
  }, [formMessage]);

  useEffect(() => {
    if (!aiEntitlementMessage.text) return undefined;
    const timer = setTimeout(() => setAiEntitlementMessage({ type: '', text: '' }), 5000);
    return () => clearTimeout(timer);
  }, [aiEntitlementMessage]);

  useEffect(() => {
    if (!accountSettingsMessage.text) return undefined;
    const timer = setTimeout(() => setAccountSettingsMessage({ type: '', text: '' }), 5000);
    return () => clearTimeout(timer);
  }, [accountSettingsMessage]);

  useEffect(() => {
    if (!ecardMessage.text) return undefined;
    const timer = setTimeout(() => setEcardMessage({ type: '', text: '' }), 5000);
    return () => clearTimeout(timer);
  }, [ecardMessage]);

  // 行操作菜单：外部点击关闭
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.tm-actions-menu') && !event.target.closest('.tm-actions-btn')) {
        setOpenActionsId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // 行操作菜单：锚点定位（表格内滚动跟随、超出视口向上展开）
  useEffect(() => {
    if (!openActionsId || !actionsAnchorRef.current) return undefined;
    const updatePosition = () => {
      if (!actionsAnchorRef.current) return;
      const rect = actionsAnchorRef.current.getBoundingClientRect();
      const menuWidth = 132;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;
      let top = rect.bottom + 4;
      const menuElement = actionsMenuRef.current;
      const menuHeight = menuElement ? menuElement.offsetHeight : 110;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - 4 - menuHeight;
      }
      setActionsPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openActionsId]);

  async function loadStock(keyword) {
    setStockLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('q', keyword);
      const data = await apiClient.get(`/admin/trials/stock-accounts?${params.toString()}`);
      setStockList(Array.isArray(data.accounts) ? data.accounts : []);
      setStockTotal(Number(data.total || 0));
      setStockWebTotal(Number(data.webStock || 0));
    } catch (error) {
      setStockList([]);
      setStockTotal(0);
    } finally {
      setStockLoading(false);
    }
  }

  // 選定現有租戶後自動載入其管理員信息（回填聯繫人字段，可修改）
  useEffect(() => {
    if (!isPlatform || newTenantMode || !form.ownerTenantId) {
      setTenantAdmin(null);
      return undefined;
    }
    let cancelled = false;
    apiClient.get(`/admin/tenants/${form.ownerTenantId}`)
      .then((data) => {
        if (cancelled) return;
        const tenant = data?.tenant || {};
        setTenantAdmin({
          name: tenant.adminDisplayName || '',
          email: tenant.loginEmail || '',
          phone: tenant.adminPhone || '',
        });
      })
      .catch(() => { if (!cancelled) setTenantAdmin({ name: '', email: '', phone: '' }); });
    return () => { cancelled = true; };
  }, [isPlatform, newTenantMode, form.ownerTenantId]);

  function startNewTenant() {
    setNewTenantMode(true);
    setNewTenant(emptyNewTenant());
    setForm((f) => ({ ...f, contactName: '', contactEmail: '', contactPhone: '' }));
    setFormMessage({ type: '', text: '' });
  }

  function useExistingTenant() {
    setNewTenantMode(false);
    setForm((f) => ({ ...f, contactName: '', contactEmail: '', contactPhone: '' }));
    setFormMessage({ type: '', text: '' });
  }

  async function loadEcardStyles() {
    const fetchActive = async (url) => {
      const data = await apiClient.get(url);
      const list = (Array.isArray(data.styles) ? data.styles : []).filter((style) => style.status === 'active');
      return list;
    };
    try {
      const list = await fetchActive('/admin/ecard-styles');
      setEcardStylesList(list);
      return list;
    } catch {
      try {
        // 租戶管理員：平台接口 403，回退租戶端目錄（已內嵌 backgrounds）
        const list = await fetchActive('/tenant/ecard-styles');
        setEcardStylesList(list);
        return list;
      } catch {
        setEcardStylesList([]);
        return [];
      }
    }
  }

  async function loadEcardBackgrounds(styleId, stylesSnapshot = null) {
    if (!styleId) {
      setEcardBackgrounds([]);
      return [];
    }
    try {
      const data = await apiClient.get(`/admin/ecard-styles/${styleId}`);
      const list = data?.style?.backgrounds || [];
      setEcardBackgrounds(Array.isArray(list) ? list : []);
      return Array.isArray(list) ? list : [];
    } catch {
      // 租戶管理員回退：使用樣式列表內嵌的背景
      const source = Array.isArray(stylesSnapshot) ? stylesSnapshot : ecardStylesList;
      const style = source.find((item) => String(item.id) === String(styleId));
      const list = Array.isArray(style?.backgrounds) ? style.backgrounds : [];
      setEcardBackgrounds(list);
      return list;
    }
  }

  async function openEcardStep(accounts, defaultCompany = '') {
    const prepared = accounts.map((a) => ({
      ...a,
      name: a.name || a.displayName || a.username || '',
      titleZh: '',
      phone: '',
      email: '',
      avatarDataUrl: '',
      enableVideoCall: true,
      enableTextChat: true,
    }));
    setEcardStep({ open: true, accounts: prepared, results: null, submitting: false });
    setEcardSelectedIds(prepared.map((a) => a.trialId));
    setEcardForm({ templateId: '', backgroundId: '', company: defaultCompany || '', logoDataUrl: '' });
    setEcardMessage({ type: '', text: '' });
    setEcardBackgrounds([]);
    const styles = await loadEcardStyles();
    if (styles.length > 0) {
      const first = styles[0];
      setEcardForm((f) => ({ ...f, templateId: String(first.id) }));
      const backgrounds = await loadEcardBackgrounds(first.id, styles);
      setEcardForm((f) => ({ ...f, backgroundId: backgrounds[0] ? String(backgrounds[0].id) : '' }));
    }
  }

  function openEcardEdit(account) {
    setEcardEditDraft({ ...account });
  }

  function saveEcardEdit() {
    const draft = ecardEditDraft;
    if (!draft) return;
    setEcardStep((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.trialId === draft.trialId ? { ...a, ...draft } : a)),
    }));
    setEcardEditDraft(null);
    setEcardMessage({ type: 'success', text: '帳號名片設置已更新（生成時生效）。' });
  }

  function handleEcardAvatarFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setEcardMessage({ type: 'error', text: '頭像不可超過 5MB。' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setEcardEditDraft((draft) => (draft ? { ...draft, avatarDataUrl: String(reader.result || '') } : draft));
    };
    reader.readAsDataURL(file);
  }

  function handleEcardLogoFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setEcardMessage({ type: 'error', text: 'Logo 不可超過 5MB。' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEcardForm((f) => ({ ...f, logoDataUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  }

  async function previewEcardAccount(account) {
    if (!ecardForm.templateId) {
      setEcardMessage({ type: 'error', text: '請先選擇名片樣式。' });
      return;
    }
    setEcardPreviewImage({ open: true, loading: true, dataUrl: '', username: account.username });
    try {
      const res = await apiClient.post('/admin/trials/ecards/preview', {
        templateId: Number(ecardForm.templateId),
        backgroundId: ecardForm.backgroundId ? Number(ecardForm.backgroundId) : null,
        company: ecardForm.company.trim(),
        name: account.name || account.displayName || account.username || '',
        titleZh: account.titleZh || '',
        phone: account.phone || '',
        email: account.email || '',
        avatarDataUrl: account.avatarDataUrl || '',
        logoDataUrl: ecardForm.logoDataUrl || '',
      }, { timeoutMs: 60000 });
      setEcardPreviewImage((prev) => ({ ...prev, loading: false, dataUrl: res?.imageDataUrl || '' }));
    } catch (error) {
      setEcardPreviewImage({ open: false, loading: false, dataUrl: '', username: '' });
      setEcardMessage({ type: 'error', text: error.message || '生成預覽失敗。' });
    }
  }

  function closeEcardStep() {
    setEcardStep({ open: false, accounts: [], results: null, submitting: false });
    setEcardEditDraft(null);
    setEcardPreviewImage({ open: false, loading: false, dataUrl: '', username: '' });
    setEcardMessage({ type: '', text: '' });
  }

  async function submitEcards() {
    if (ecardSelectedIds.length === 0) {
      setEcardMessage({ type: 'error', text: '請至少勾選一個帳號。' });
      return;
    }
    if (!ecardForm.templateId) {
      setEcardMessage({ type: 'error', text: '請選擇名片樣式。' });
      return;
    }
    setEcardStep((prev) => ({ ...prev, submitting: true }));
    setEcardMessage({ type: '', text: '' });
    try {
      const res = await apiClient.post('/admin/trials/ecards', {
        templateId: Number(ecardForm.templateId),
        backgroundId: ecardForm.backgroundId ? Number(ecardForm.backgroundId) : null,
        company: ecardForm.company.trim(),
        logoDataUrl: ecardForm.logoDataUrl || '',
        accounts: ecardStep.accounts
          .filter((a) => ecardSelectedIds.includes(a.trialId))
          .map((a) => ({
            trialId: a.trialId,
            name: a.name || '',
            titleZh: a.titleZh || '',
            phone: a.phone || '',
            email: a.email || '',
            avatarDataUrl: a.avatarDataUrl || '',
            enableVideoCall: a.enableVideoCall !== false,
            enableTextChat: a.enableTextChat !== false,
          })),
      }, { timeoutMs: 120000 });
      const results = res?.data?.results || [];
      setEcardStep((prev) => ({ ...prev, results, submitting: false }));
      loadTrials();
    } catch (error) {
      setEcardStep((prev) => ({ ...prev, submitting: false }));
      setEcardMessage({ type: 'error', text: error.message || '生成電子名片失敗。' });
    }
  }

  async function loadAddonCatalog() {
    try {
      const data = await apiClient.get('/billing/addon-services');
      const list = Array.isArray(data.addons) ? data.addons : [];
      setAddonCatalog(list);
      return list;
    } catch {
      setAddonCatalog([]);
      return [];
    }
  }

  // 代理商名錄：全量載入（彈窗僅用啟用中；列表篩選含已停用——歷史試用仍可篩查）
  async function loadAgents() {
    try {
      const data = await apiClient.get('/admin/agents');
      setAllAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch {
      setAllAgents([]);
    }
  }

  async function checkAdminEmail() {
    const email = form.contactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck({ status: 'taken', text: '郵箱格式無效。' });
      return;
    }
    setEmailChecking(true);
    try {
      const data = await apiClient.get(`/admin/trials/check-admin-email?email=${encodeURIComponent(email)}`);
      setEmailCheck(data?.available ? { status: 'available', text: '信箱可用。' } : { status: 'taken', text: '該信箱已被使用。' });
    } catch (error) {
      setEmailCheck({ status: 'taken', text: error.message || '檢查失敗，請重試。' });
    } finally {
      setEmailChecking(false);
    }
  }

  useImperativeHandle(ref, () => ({
    openAssign: () => {
      setForm(emptyForm());
      setSelectedStocks([]);
      setStockKeyword('');
      setStockList([]);
      setStockTotal(0);
      setNewTenantMode(false);
      setNewTenant(emptyNewTenant());
      setTenantAdmin(null);
      setEmailChecking(false);
      setEmailCheck({ status: 'idle', text: '' });
      setPickerOpen(false);
      setAddCount('1');
      setSelectedAddonCodes([]);
      // 增值服務默認全選（加載完成後自動勾上全部有效項）
      loadAddonCatalog().then((list) => {
        setSelectedAddonCodes(list.map((addon) => addon.addonCode));
      });
      loadAgents();
      setFormMessage({ type: '', text: '' });
      setMessage({ type: '', text: '' });
      setAssignOpen(true);
    },
    reload: () => loadTrials(),
  }));

  function toggleStock(account) {
    const exists = selectedStocks.some((s) => s.id === account.id);
    if (!exists) {
      const limit = Number(addCount);
      if (!Number.isInteger(limit) || limit < 1) {
        setFormMessage({ type: 'error', text: '請先輸入新增試用帳號數量（1~100）。' });
        return;
      }
      if (selectedStocks.length >= Math.min(limit, 100)) {
        setFormMessage({ type: 'error', text: `已達新增數量上限（${limit} 個），請先取消已選帳號或調大數量。` });
        return;
      }
    }
    setFormMessage({ type: '', text: '' });
    setSelectedStocks((prev) => (exists ? prev.filter((s) => s.id !== account.id) : [...prev, account]));
  }

  async function submitAssign() {
    if (!newTenantMode && isPlatform && !form.ownerTenantId) {
      setFormMessage({ type: 'error', text: '請選擇歸屬租戶。' });
      return;
    }
    // 現有租戶（平台）：聯繫人取該租戶管理員信息（只讀）；新建/租戶管理員：取表單
    const useFormContact = newTenantMode || !isPlatform;
    const contactName = useFormContact ? form.contactName.trim() : (tenantAdmin?.name || '');
    const contactEmail = useFormContact ? form.contactEmail.trim() : (tenantAdmin?.email || '');
    const contactPhone = useFormContact ? form.contactPhone.trim() : (tenantAdmin?.phone || '');
    if (newTenantMode) {
      if (!newTenant.companyName.trim()) {
        setFormMessage({ type: 'error', text: '請輸入租戶公司名稱。' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        setFormMessage({ type: 'error', text: '請輸入有效的管理員登入信箱。' });
        return;
      }
      if ((newTenant.password || '').length < 8) {
        setFormMessage({ type: 'error', text: '管理員密碼至少 8 位字元。' });
        return;
      }
    }
    if (!form.startedAt || !form.expiresAt) {
      setFormMessage({ type: 'error', text: '請設定試用週期。' });
      return;
    }
    if (form.expiresAt < form.startedAt) {
      setFormMessage({ type: 'error', text: '結束日期不能早於開始日期。' });
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setFormMessage({ type: 'error', text: '聯繫郵箱格式無效。' });
      return;
    }
    if (selectedStocks.length === 0) {
      setFormMessage({ type: 'error', text: '請添加至少一個測試帳號。' });
      return;
    }
    const addLimit = Number(addCount);
    if (Number.isInteger(addLimit) && addLimit >= 1 && selectedStocks.length > addLimit) {
      setFormMessage({ type: 'error', text: `已選 ${selectedStocks.length} 個超過新增數量上限（${addLimit}），請先取消多餘的帳號。` });
      return;
    }

    let ownerTenantId = newTenantMode ? null : Number(form.ownerTenantId) || null;
    const company = newTenantMode
      ? newTenant.companyName.trim()
      : (tenants.find((t) => String(t.id) === String(form.ownerTenantId))?.companyName || '');

    setAssigning(true);
    setFormMessage({ type: '', text: '' });
    let createdTenantId = null;
    try {
      if (newTenantMode) {
        const created = await apiClient.put('/admin/tenants/0', {
          companyName: newTenant.companyName.trim(),
          contactPerson: contactName,
          contactPhone,
          loginEmail: contactEmail,
          password: newTenant.password,
        });
        ownerTenantId = Number(created?.id) || null;
        if (!ownerTenantId) throw new Error('建立租戶失敗。');
        createdTenantId = ownerTenantId;
        await loadTenants();
      }
      const payload = {
        ownerTenantId,
        contactName,
        contactEmail,
        contactPhone,
        company,
        startedAt: form.startedAt,
        expiresAt: form.expiresAt,
        agentId: Number(form.agentId) || null,
        sipUserIds: selectedStocks.map((s) => s.id),
        pairs: selectedStocks.map((s) => ({ sipUserId: s.id, webUserId: s.webUserId || null })),
        addonCodes: selectedAddonCodes,
      };
      const res = await apiClient.post('/admin/trials', payload, { timeoutMs: 120000 });
      setAssignOpen(false);
      setMessage({ type: 'success', text: res.message || '試用帳號已添加。' });
      setPage(1);
      loadTrials({ page: 1 });
      // 保存成功後續接「Ecard 設置」第二步
      const createdTrials = Array.isArray(res?.data?.trials) ? res.data.trials : [];
      const ecardAccounts = createdTrials.map((t) => {
        const stockRow = selectedStocks.find((s) => s.id === Number(t.sipUserId));
        return {
          trialId: Number(t.id),
          sipUserId: Number(t.sipUserId),
          username: t.username || stockRow?.username || '',
          webUsername: stockRow?.webUsername || '',
          displayName: stockRow?.displayName || '',
        };
      });
      if (ecardAccounts.length > 0) openEcardStep(ecardAccounts, res?.data?.ownerTenantName || '');
    } catch (error) {
      setFormMessage({
        type: 'error',
        text: createdTenantId
          ? `租戶已建立（#${createdTenantId}），但添加試用失敗：${error.message || '未知錯誤'}`
          : (error.message || '添加失敗。'),
      });
    } finally {
      setAssigning(false);
    }
  }

  async function endTrial(trial, action) {
    if (action === 'end') {
      const confirmed = window.confirm(`確定暫停「${trial.username}」的試用嗎？\n通訊核心將停用該帳號（無法註冊/通話），名片與 AI 一併停用。\n試用期不變，到期前可隨時恢復。`);
      if (!confirmed) return;
    }
    try {
      const res = await apiClient.post(`/admin/trials/${trial.id}/end`, { action });
      setMessage({ type: 'success', text: res.message || '操作成功。' });
      loadTrials();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '操作失敗。' });
    }
  }

  async function resumeTrial(trial) {
    const confirmed = window.confirm(`確定恢復「${trial.username}」的試用嗎？\n通訊核心帳號、名片與 AI 將立即重新啟用。`);
    if (!confirmed) return;
    try {
      const res = await apiClient.post(`/admin/trials/${trial.id}/resume`);
      setMessage({ type: 'success', text: res.message || '已恢復試用。' });
      loadTrials();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '恢復失敗。' });
    }
  }

  // AI 助手詳細設定（與「帳號管理」頁同一組授權接口；試用帳號預設沿用到試用結束）
  async function openAiEntitlement(trial) {
    setOpenActionsId(null);
    setAiEntitlementAccount({ id: trial.sipUserId, username: trial.username });
    setAiEntitlementForm({ enabled: true, daily_limit: 50, monthly_limit: '', expires_at: trial.expiresAt || '', notes: '試用開通' });
    setAiEntitlementMessage({ type: '', text: '' });
    setAiEntitlementLoading(true);
    try {
      const result = await apiClient.get(`/admin/sip-accounts/${trial.sipUserId}/ai-entitlement`);
      if (result && result.sip_user_id) {
        setAiEntitlementForm({
          enabled: result.enabled === 1 || result.enabled === true,
          daily_limit: result.daily_limit ?? 50,
          monthly_limit: result.monthly_limit ?? '',
          expires_at: result.expires_at ? String(result.expires_at).substring(0, 10) : '',
          notes: result.notes || '',
        });
      }
    } catch {
      /* 無授權記錄，沿用預設值 */
    } finally {
      setAiEntitlementLoading(false);
    }
  }

  async function handleAiEntitlementSubmit(e) {
    e.preventDefault();
    setAiEntitlementSaving(true);
    setAiEntitlementMessage({ type: '', text: '' });
    try {
      await apiClient.put(`/admin/sip-accounts/${aiEntitlementAccount.id}/ai-entitlement`, {
        enabled: aiEntitlementForm.enabled,
        daily_limit: aiEntitlementForm.daily_limit,
        monthly_limit: aiEntitlementForm.monthly_limit || null,
        // 過期日按「當日結束」存儲（與試用開通一致），避免存成當日 00:00 提前失效
        expires_at: aiEntitlementForm.expires_at ? `${aiEntitlementForm.expires_at} 23:59:59` : null,
        notes: aiEntitlementForm.notes,
      });
      setAiEntitlementMessage({ type: 'success', text: 'AI 助手設定已儲存。' });
      loadTrials();
      setTimeout(() => setAiEntitlementAccount(null), 1200);
    } catch (error) {
      setAiEntitlementMessage({ type: 'error', text: error.message || 'AI 助手設定儲存失敗。' });
    } finally {
      setAiEntitlementSaving(false);
    }
  }

  async function handleAiEntitlementDelete() {
    if (!window.confirm(`確定要取消「${aiEntitlementAccount.username}」的 AI 助手授權嗎？\n取消後該帳號將無法使用 AI 助手。`)) return;
    setAiEntitlementSaving(true);
    setAiEntitlementMessage({ type: '', text: '' });
    try {
      await apiClient.delete(`/admin/sip-accounts/${aiEntitlementAccount.id}/ai-entitlement`);
      setAiEntitlementMessage({ type: 'success', text: 'AI 助手授權已取消。' });
      loadTrials();
      setTimeout(() => setAiEntitlementAccount(null), 1200);
    } catch (error) {
      setAiEntitlementMessage({ type: 'error', text: error.message || '取消 AI 助手授權失敗。' });
    } finally {
      setAiEntitlementSaving(false);
    }
  }

  // 帳號設置（對齊租戶端「帳號管理」的編輯彈窗）：顯示名/郵箱/電話/密碼
  async function openAccountSettings(trial) {
    setOpenActionsId(null);
    setAccountSettingsTarget({ id: trial.id, username: trial.username });
    setAccountSettingsForm({ displayName: trial.accountDisplayName || '', email: '', phone: '', password: '', confirmPassword: '' });
    setAccountSettingsMessage({ type: '', text: '' });
    setAccountSettingsLoading(true);
    try {
      const data = await apiClient.get(`/admin/trials/${trial.id}/account-settings`);
      const a = data?.account || {};
      setAccountSettingsForm({
        displayName: a.displayName || '',
        email: a.email || '',
        phone: a.phone || '',
        password: '',
        confirmPassword: '',
      });
    } catch {
      /* 讀取失敗時沿用列表值兜底 */
    } finally {
      setAccountSettingsLoading(false);
    }
  }

  async function submitAccountSettings(e) {
    e.preventDefault();
    const email = accountSettingsForm.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAccountSettingsMessage({ type: 'error', text: '請輸入有效的電子郵箱。' });
      return;
    }
    if (accountSettingsForm.password || accountSettingsForm.confirmPassword) {
      if (accountSettingsForm.password.length < 6) {
        setAccountSettingsMessage({ type: 'error', text: '密碼至少需要 6 個字元。' });
        return;
      }
      if (accountSettingsForm.password !== accountSettingsForm.confirmPassword) {
        setAccountSettingsMessage({ type: 'error', text: '兩次輸入的密碼不一致。' });
        return;
      }
    }
    setAccountSettingsSaving(true);
    setAccountSettingsMessage({ type: '', text: '' });
    try {
      await apiClient.put(`/admin/trials/${accountSettingsTarget.id}/account-settings`, {
        displayName: accountSettingsForm.displayName.trim(),
        email,
        phone: accountSettingsForm.phone.trim(),
        password: accountSettingsForm.password,
        confirmPassword: accountSettingsForm.confirmPassword,
      });
      setAccountSettingsMessage({ type: 'success', text: '帳號資訊已更新。' });
      loadTrials();
      setTimeout(() => setAccountSettingsTarget(null), 1200);
    } catch (error) {
      setAccountSettingsMessage({ type: 'error', text: error.message || '帳號資訊更新失敗。' });
    } finally {
      setAccountSettingsSaving(false);
    }
  }

  const effectivePageSize = pageSize === 'all' ? 1000 : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));

  return (
    <div id="trial-management" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0, height: '100%', background: '#111827', boxSizing: 'border-box' }}>
      <style>{`
        #trial-management .tm-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
        }
        #trial-management .tm-card.tm-table-card {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: #1a2332;
          overflow: hidden;
        }
        #trial-management .tm-table-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
        #trial-management .tm-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          flex-wrap: wrap;
        }
        #trial-management .tm-toolbar select,
        #trial-management .tm-toolbar input {
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          font-size: 12px;
          padding: 0 12px;
        }
        #trial-management .tm-toolbar input::placeholder { color: #6b7280; }
        #trial-management .tm-toolbar select:focus,
        #trial-management .tm-toolbar input:focus { border-color: #3b82f6; outline: none; }
        #trial-management .tm-search,
        #trial-management-modal .tm-search {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          border: 1px solid #374151;
          border-radius: 8px;
          padding: 0 12px;
          background: #1a2332;
        }
        #trial-management .tm-search input,
        #trial-management-modal .tm-search input {
          border: 0;
          outline: none;
          height: 34px;
          padding: 0;
          min-width: 200px;
          background: transparent;
          color: #e5e7eb;
        }
        #trial-management .tm-btn, #trial-management-modal .tm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 34px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #4b5563;
          background: #1f2937;
          color: #d1d5db;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        #trial-management .tm-btn:hover, #trial-management-modal .tm-btn:hover { background: #374151; color: #f3f4f6; }
        #trial-management .tm-btn.primary, #trial-management-modal .tm-btn.primary {
          border: 0;
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%);
          color: #fff;
        }
        #trial-management .tm-btn.danger, #trial-management-modal .tm-btn.danger { color: #fca5a5; }
        #trial-management .tm-btn.danger:hover, #trial-management-modal .tm-btn.danger:hover { background: #3b1111; color: #fecaca; }
        #trial-management .tm-btn:disabled, #trial-management-modal .tm-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; cursor: not-allowed; }
        #trial-management table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        #trial-management thead, #trial-management thead tr { background: #1a2332; }
        #trial-management th {
          height: 48px;
          padding: 0 18px;
          text-align: left;
          color: #e5e7eb;
          font-weight: 600;
          background: #1a2332;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #trial-management tbody tr { background: #111827; }
        #trial-management tbody tr:hover { background: #1e293b; }
        #trial-management td {
          height: 56px;
          padding: 0 18px;
          color: #e5e7eb;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #trial-management .tm-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 20px;
          text-align: center;
          color: #9ca3af;
          font-size: 13px;
          background: #111827;
        }
        #trial-management .tm-badge {
          display: inline-flex;
          align-items: center;
          height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        #trial-management .tm-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #111827;
          border-top: 1px solid #1f2937;
        }
        #trial-management .tm-total { color: #9ca3af; font-size: 12px; }
        #trial-management .tm-pagination { display: flex; align-items: center; gap: 12px; }
        #trial-management .tm-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #trial-management .tm-page-btn,
        #trial-management .tm-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1f2937;
          color: #9ca3af;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        #trial-management .tm-page-current {
          border-color: #3b82f6;
          color: #60a5fa;
          background: #1e3a5f;
          font-weight: 600;
        }
        #trial-management .tm-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #trial-management .tm-page-btn:disabled {
          opacity: 0.4;
          background: #1a2332;
          color: #4b5563;
          cursor: not-allowed;
        }
        #trial-management .tm-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9ca3af;
          font-size: 11px;
        }
        #trial-management .tm-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          text-align: center;
          outline: none;
          font-size: 11px;
        }
        #trial-management .tm-banner, #trial-management-modal .tm-banner {
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 12px;
        }
        #trial-management .tm-banner.success, #trial-management-modal .tm-banner.success { background: #0d2818; color: #22c55e; border: 1px solid #14532d; }
        #trial-management .tm-banner.error, #trial-management-modal .tm-banner.error { background: #3b1111; color: #ef4444; border: 1px solid #7f1d1d; }
        /* 悬浮提示：贴底固定于弹窗面板（滚动任意位置都可见），替代顶部横幅 */
        #trial-management-modal .tm-toast {
          position: absolute;
          left: 24px;
          right: 24px;
          bottom: 78px;
          z-index: 6;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }
        #trial-management-modal .tm-toast.error { background: #3b1111; color: #f87171; border: 1px solid #7f1d1d; }
        #trial-management-modal .tm-toast.success { background: #0d2818; color: #22c55e; border: 1px solid #14532d; }
        /* 行操作三点菜单（portal 到 body，故不加作用域前缀，tm- 前缀保证唯一） */
        .tm-actions-menu {
          position: fixed;
          background: #1e293b;
          border: 1px solid #374151;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
          z-index: 10050;
          min-width: 132px;
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .tm-actions-menu .tm-actions-item {
          padding: 8px 16px;
          font-size: 13px;
          color: #d1d5db;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          cursor: pointer;
        }
        .tm-actions-menu .tm-actions-item:hover { background: #374151; color: #f3f4f6; }
        .tm-actions-menu .tm-actions-item.danger { color: #fca5a5; }
        .tm-actions-menu .tm-actions-item.danger:hover { background: #3b1111; color: #fecaca; }
        #trial-management-modal .tm-field { display: flex; flex-direction: column; gap: 6px; }
        #trial-management-modal .tm-field label { font-size: 12px; color: #9ca3af; }
        #trial-management-modal .tm-field input,
        #trial-management-modal .tm-field select,
        #trial-management-modal .tm-field textarea {
          background: #0b1220;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #e5e7eb;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
        }
        #trial-management-modal .tm-field input:focus,
        #trial-management-modal .tm-field select:focus { border-color: #3b82f6; }
        #trial-management-modal .tm-field input:disabled { color: #9ca3af; background: #0d1526; }
        /* 覆蓋瀏覽器自動填充的白底（新建租戶的電話/密碼被 Chrome 記憶填充時） */
        #trial-management-modal .tm-field input:-webkit-autofill,
        #trial-management-modal .tm-field input:-webkit-autofill:hover,
        #trial-management-modal .tm-field input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0b1220 inset;
          -webkit-text-fill-color: #e5e7eb;
          transition: background-color 5000s ease-in-out 0s;
        }
        #trial-management-modal .tm-modal {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.6);
        }
        #trial-management-modal .tm-modal-panel {
          position: relative;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          width: 760px;
          max-width: 94vw;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }
        #trial-management-modal .tm-modal-head {
          padding: 18px 24px;
          border-bottom: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 12px 12px 0 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #trial-management-modal .tm-modal-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        #trial-management-modal .tm-modal-body { padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
        #trial-management-modal .tm-modal-foot {
          padding: 14px 24px;
          border-top: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 0 0 12px 12px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        #trial-management-modal .tm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #trial-management-modal .tm-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        #trial-management-modal .tm-stock-list {
          border: 1px solid #374151;
          border-radius: 8px;
          max-height: 360px;
          overflow: auto;
          background: #0b1220;
        }
        #trial-management-modal .tm-stock-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        #trial-management-modal .tm-stock-table thead th {
          position: sticky;
          top: 0;
          z-index: 1;
          background: #131d31;
          color: #9ca3af;
          font-weight: 600;
          text-align: left;
          padding: 8px 12px;
          border-bottom: 1px solid #374151;
          white-space: nowrap;
        }
        #trial-management-modal .tm-stock-table tbody td {
          padding: 7px 12px;
          color: #e5e7eb;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #trial-management-modal .tm-stock-table tbody tr { cursor: pointer; }
        #trial-management-modal .tm-stock-table tbody tr:hover { background: #1e293b; }
        #trial-management-modal .tm-stock-table tbody tr.selected { background: #14304a; }
        #trial-management-modal .tm-stock-table input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management-modal .tm-stock-table .mono { font-weight: 600; }
        #trial-management-modal .tm-ecard-table { table-layout: fixed; width: 100%; }
        #trial-management-modal .tm-ecard-table th,
        #trial-management-modal .tm-ecard-table td { padding: 7px 8px; overflow: hidden; text-overflow: ellipsis; }
        #trial-management-modal .tm-ecard-table .tm-btn { height: 28px; padding: 0 10px; font-size: 11px; }
        /* 操作列钉住右侧：不随横向内容滚动（与设备管理页同款） */
        #trial-management-modal .tm-ecard-table th:last-child,
        #trial-management-modal .tm-ecard-table td:last-child {
          position: sticky;
          right: 0;
          box-shadow: -1px 0 0 #374151;
        }
        #trial-management-modal .tm-ecard-table th:last-child { z-index: 3; background: #131d31; }
        #trial-management-modal .tm-ecard-table td:last-child { z-index: 2; background: inherit; }
        #trial-management-modal .tm-radio-row { display: flex; gap: 18px; align-items: center; color: #e5e7eb; font-size: 13px; }
        #trial-management-modal .tm-radio-row label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
        #trial-management-modal .tm-radio-row input[type="radio"],
        #trial-management-modal .tm-field input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management-modal .tm-hint { color: #6b7280; font-size: 11px; }
        #trial-management-modal .tm-section {
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #0d1526;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        #trial-management-modal .tm-section-title { font-size: 13px; font-weight: 600; color: #93c5fd; }
        #trial-management-modal .tm-addon-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        #trial-management-modal .tm-addon-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border: 1px solid #374151;
          border-radius: 8px;
          background: #0b1220;
          color: #e5e7eb;
          font-size: 13px;
          cursor: pointer;
        }
        #trial-management-modal .tm-addon-item.checked { border-color: #3b82f6; background: #14304a; }
        #trial-management-modal .tm-addon-item input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management-modal .tm-addon-item .tm-hint { color: #6b7280; font-size: 11px; }
        #trial-management-modal .tm-account-list {
          border: 1px solid #374151;
          border-radius: 8px;
          background: #0b1220;
          max-height: 200px;
          overflow-y: auto;
        }
        #trial-management-modal .tm-account-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 12px;
        }
        #trial-management-modal .tm-account-row:last-child { border-bottom: 0; }
        #trial-management-modal .tm-account-name { font-weight: 600; }
        #trial-management-modal .tm-account-empty { padding: 18px 12px; color: #6b7280; font-size: 12px; text-align: center; }
        #trial-management-modal .tm-remove {
          margin-left: auto;
          background: none;
          border: 0;
          color: #f87171;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px 4px;
        }
        #trial-management-modal .tm-remove:hover { color: #fecaca; }
        #trial-management-modal .tm-picker {
          border: 1px dashed #374151;
          border-radius: 8px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #0d1526;
        }
        #trial-management-modal .tm-input {
          background: #0b1220;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #e5e7eb;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
        }
        #trial-management-modal .tm-input:focus { border-color: #3b82f6; }
        /* 弹窗滚动条深色化（portal 在 #console 之外，不吃全局滚动条样式） */
        #trial-management-modal .tm-modal-body,
        #trial-management-modal .tm-account-list,
        #trial-management-modal .tm-stock-list {
          scrollbar-width: thin;
          scrollbar-color: #374151 transparent;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar,
        #trial-management-modal .tm-account-list::-webkit-scrollbar,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-thumb,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-thumb,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #374151;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-thumb:hover,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-thumb:hover,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-track,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-track,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>

      {message.text && (
        <div className={`tm-banner ${message.type || 'success'}`}>{message.text}</div>
      )}

      <div className="tm-card">
        <div className="tm-toolbar">
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="all">全部狀態</option>
            <option value="active">試用中</option>
            <option value="expiring">即將到期</option>
            <option value="grace">寬限期</option>
            <option value="paused">已暫停</option>
            <option value="converted">已轉正</option>
            <option value="reclaimed">已回收</option>
          </select>
          {isPlatform && (
            <select value={filterTenantId} onChange={(e) => { setFilterTenantId(e.target.value); setPage(1); }}>
              <option value="">全部租戶</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.companyName || t.name}</option>
              ))}
            </select>
          )}
          {isPlatform && (
            <select value={filterAgentId} onChange={(e) => { setFilterAgentId(e.target.value); setPage(1); }}>
              <option value="">全部代理商</option>
              <option value="none">無代理商</option>
              {allAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <div className="tm-search">
            <Search size={14} color="#6b7280" />
            <input
              placeholder="搜尋聯繫人 / 公司 / 郵箱 / 帳號"
              value={filterQInput}
              onChange={(e) => setFilterQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setFilterQ(filterQInput.trim()); setPage(1); } }}
            />
          </div>
          <button className="tm-btn" type="button" onClick={() => { setFilterQ(filterQInput.trim()); setPage(1); }}>搜尋</button>
          <button className="tm-btn" type="button" onClick={() => loadTrials()} title="重新整理">
            <RefreshCw size={13} /> 重新整理
          </button>
        </div>
      </div>

      <div className="tm-card tm-table-card">
        {loading ? (
          <div className="tm-empty">載入中…</div>
        ) : trials.length === 0 ? (
          <div className="tm-empty">暫無試用記錄。點擊右上角「添加試用」開始。</div>
        ) : (
          <div className="tm-table-scroll">
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                <tr>
                  <th>帳號</th>
                  {isPlatform && <th>歸屬租戶</th>}
                  <th>聯繫人</th>
                  <th>試用週期</th>
                  <th>狀態</th>
                  <th>AI 助手</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const meta = PHASE_META[t.phase] || PHASE_META.active;
                  const actionable = ['active', 'expiring', 'grace', 'paused'].includes(t.phase);
                  const canPause = t.phase === 'active' || t.phase === 'expiring';
                  const canResume = t.phase === 'paused' && String(t.expiresAt || '') >= todayStr();
                  const canAccountSettings = !isPlatform && String(t.expiresAt || '') >= todayStr() && ['active', 'expiring', 'paused'].includes(t.phase);
                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{t.username}{t.webUsername ? `（${t.webUsername}）` : ''}</div>
                        {t.accountDisplayName && t.accountDisplayName !== t.username && (
                          <div style={{ color: '#9ca3af', fontSize: '11px' }}>{t.accountDisplayName}</div>
                        )}
                      </td>
                      {isPlatform && <td>{t.ownerTenantName}</td>}
                      <td>
                        <div>{t.contactName || '—'}</div>
                        {t.contactEmail && <div style={{ color: '#9ca3af', fontSize: '11px' }}>{t.contactEmail}</div>}
                      </td>
                      <td>{t.startedAt} ~ {t.expiresAt}</td>
                      <td>
                        <span className="tm-badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                      </td>
                      <td>{t.aiEnabled ? '已開通' : '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {actionable ? (
                          <button
                            className="tm-btn tm-actions-btn"
                            type="button"
                            title="更多操作"
                            style={{ width: '32px', padding: 0, justifyContent: 'center' }}
                            onClick={(e) => {
                              if (openActionsId === t.id) { setOpenActionsId(null); return; }
                              actionsAnchorRef.current = e.currentTarget;
                              setOpenActionsId(t.id);
                            }}
                          >
                            <MoreVertical size={15} />
                          </button>
                        ) : (
                          <span style={{ color: '#4b5563' }}>—</span>
                        )}
                        {openActionsId === t.id ? createPortal(
                          <div ref={actionsMenuRef} className="tm-actions-menu" style={{ top: actionsPosition.top, left: actionsPosition.left }}>
                            {isPlatform && (
                              <button type="button" className="tm-actions-item" onClick={() => openAiEntitlement(t)}>AI助手</button>
                            )}
                            {canAccountSettings && (
                              <button type="button" className="tm-actions-item" onClick={() => openAccountSettings(t)}>帳號設置</button>
                            )}
                            {canPause && (
                              <button type="button" className="tm-actions-item" onClick={() => { setOpenActionsId(null); endTrial(t, 'end'); }}>暫停</button>
                            )}
                            {canResume && (
                              <button type="button" className="tm-actions-item" onClick={() => { setOpenActionsId(null); resumeTrial(t); }}>恢復</button>
                            )}
                            {isPlatform && (
                              <button type="button" className="tm-actions-item danger" onClick={() => { setOpenActionsId(null); setReclaimConfirm({ open: true, trial: t }); }}>立即回庫</button>
                            )}
                          </div>,
                          document.body,
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="tm-footer">
          <div className="tm-total">共 {total} 條</div>
          <div className="tm-pagination">
            <select
              className="tm-page-size"
              value={pageSize}
              onChange={(e) => { const v = e.target.value; setPageSize(v === 'all' ? 'all' : Number(v)); setPage(1); }}
            >
              <option value={10}>10 條/页</option>
              <option value={20}>20 條/页</option>
              <option value={50}>50 條/页</option>
              <option value="all">全部</option>
            </select>
            <button className="tm-page-btn" type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
            <span className="tm-page-current">{page}</span>
            <button className="tm-page-btn" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>›</button>
            <span className="tm-page-jump">前往<input className="tm-page-input" value={page} readOnly />頁</span>
          </div>
        </div>
      </div>

      {assignOpen && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel">
            <div className="tm-modal-head">
              <h3>添加試用帳號</h3>
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>關閉</button>
            </div>
            <div className="tm-modal-body">
              {/* 第一部分：租戶信息 */}
              <div className="tm-section">
                <div className="tm-section-title">租戶信息</div>
                {isPlatform ? (
                  newTenantMode ? (
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>公司名稱 *</label>
                        <input value={newTenant.companyName} onChange={(e) => setNewTenant((v) => ({ ...v, companyName: e.target.value }))} />
                      </div>
                      <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                        <label>&nbsp;</label>
                        <button className="tm-btn" type="button" onClick={useExistingTenant}>改用現有租戶</button>
                      </div>
                    </div>
                  ) : (
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>歸屬租戶 *</label>
                        <select value={form.ownerTenantId} onChange={(e) => setForm((f) => ({ ...f, ownerTenantId: e.target.value }))}>
                          <option value="">請選擇租戶</option>
                          {tenants.map((t) => (
                            <option key={t.id} value={t.id}>{t.companyName || t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                        <label>&nbsp;</label>
                        <button className="tm-btn" type="button" onClick={startNewTenant}>
                          <UserPlus size={13} /> 新建租戶
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="tm-field">
                    <label>歸屬租戶</label>
                    <input value={tenantName || '本租戶（固定）'} disabled />
                  </div>
                )}
              </div>

              {/* 第二部分：租戶管理員信息 */}
              <div className="tm-section">
                <div className="tm-section-title">租戶管理員信息</div>
                <div className={newTenantMode ? 'tm-grid2' : 'tm-grid3'}>
                  {isPlatform && !newTenantMode ? (
                    <>
                      <div className="tm-field">
                        <label>管理員姓名</label>
                        <input value={tenantAdmin?.name || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                      <div className="tm-field">
                        <label>管理員信箱</label>
                        <input value={tenantAdmin?.email || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                      <div className="tm-field">
                        <label>聯繫電話</label>
                        <input value={tenantAdmin?.phone || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="tm-field">
                        <label>管理員姓名</label>
                        <input autoComplete="off" value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
                      </div>
                      <div className="tm-field">
                        <label>{newTenantMode ? '管理員登入信箱 *' : '管理員信箱'}</label>
                        {newTenantMode ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              autoComplete="off"
                              style={{ flex: 1, minWidth: 0 }}
                              value={form.contactEmail}
                              onChange={(e) => { setForm((f) => ({ ...f, contactEmail: e.target.value })); setEmailCheck({ status: 'idle', text: '' }); }}
                            />
                            <button className="tm-btn" type="button" onClick={checkAdminEmail} disabled={emailChecking}>
                              {emailChecking ? '檢查中…' : '校驗'}
                            </button>
                          </div>
                        ) : (
                          <input autoComplete="off" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} />
                        )}
                        {newTenantMode && emailCheck.status !== 'idle' && (
                          <span className="tm-hint" style={{ color: emailCheck.status === 'available' ? '#22c55e' : '#f87171' }}>{emailCheck.text}</span>
                        )}
                      </div>
                      <div className="tm-field">
                        <label>聯繫電話</label>
                        <input autoComplete="off" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
                      </div>
                      {newTenantMode && (
                        <div className="tm-field">
                          <label>管理員密碼 *（至少 8 位）</label>
                          <input type="password" autoComplete="new-password" value={newTenant.password} onChange={(e) => setNewTenant((v) => ({ ...v, password: e.target.value }))} />
                        </div>
                      )}
                    </>
                  )}
                </div>
                {isPlatform && !newTenantMode && form.ownerTenantId && tenantAdmin && (
                  <span className="tm-hint">管理員信息來自該租戶，僅供確認（不可修改）。</span>
                )}
              </div>

              {/* 第三部分：測試帳號列表 */}
              <div className="tm-section">
                <div className="tm-section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  測試帳號列表
                  <span className="tm-hint">已添加 {selectedStocks.length} / {Number(addCount) || '—'} 個</span>
                  <button
                    className="tm-btn"
                    type="button"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { setPickerOpen((v) => !v); if (!pickerOpen && stockList.length === 0) loadStock(''); }}
                  >
                    <Plus size={13} /> 添加測試帳號
                  </button>
                </div>
                <div className="tm-grid3">
                  <div className="tm-field">
                    <label>試用開始 *</label>
                    <input type="date" value={form.startedAt} onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value }))} />
                  </div>
                  <div className="tm-field">
                    <label>試用結束 *（預設 1 個月）</label>
                    <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                  <div className="tm-field">
                    <label>新增試用帳號數量 *</label>
                    <input
                      value={addCount}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^\d]/g, '');
                        setAddCount(digits);
                        const limit = Number(digits);
                        if (Number.isInteger(limit) && limit >= 1 && selectedStocks.length > limit) {
                          setFormMessage({ type: 'error', text: `已選 ${selectedStocks.length} 個超過數量上限 ${limit}，請取消多餘的帳號。` });
                        } else {
                          setFormMessage({ type: '', text: '' });
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="tm-account-list">
                  {selectedStocks.length === 0 ? (
                    <div className="tm-account-empty">尚未添加帳號，點擊下方「添加測試帳號」從庫存選號</div>
                  ) : (
                    selectedStocks.map((a) => (
                      <div key={a.id} className="tm-account-row">
                        <span className="tm-account-name">{a.username}</span>
                        <button className="tm-remove" type="button" title="移除" onClick={() => toggleStock(a)}>✕</button>
                      </div>
                    ))
                  )}
                </div>

                {pickerOpen && (
                  <div className="tm-picker">
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div className="tm-search" style={{ background: '#0b1220', borderColor: '#374151', flex: 1 }}>
                        <Search size={14} color="#6b7280" />
                        <input
                          style={{ background: 'transparent', color: '#e5e7eb', width: '100%' }}
                          placeholder="搜尋庫存帳號（帳號/名稱）"
                          value={stockKeyword}
                          onChange={(e) => setStockKeyword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') loadStock(stockKeyword.trim()); }}
                        />
                      </div>
                      <button className="tm-btn" type="button" onClick={() => loadStock(stockKeyword.trim())}>搜尋</button>
                      <button className="tm-btn" type="button" onClick={() => setPickerOpen(false)}>收起</button>
                    </div>
                    <div className="tm-hint">庫存共 {stockTotal} 個 SIP / {stockWebTotal} 個 Web；Web 帳號為每次載入的隨機預配，提交時按所見配對綁定</div>
                    <div className="tm-stock-list">
                      {stockLoading ? (
                        <div style={{ padding: '14px', color: '#9ca3af', fontSize: '12px' }}>載入中…</div>
                      ) : stockList.length === 0 ? (
                        <div style={{ padding: '14px', color: '#9ca3af', fontSize: '12px' }}>無結果（點「搜尋」載入）</div>
                      ) : (
                        <table className="tm-stock-table">
                          <thead>
                            <tr>
                              <th style={{ width: '42px' }}></th>
                              <th>SIP 帳號</th>
                              <th>Web 帳號</th>
                              <th>顯示名</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockList.map((a) => {
                              const checked = selectedStocks.some((s) => s.id === a.id);
                              return (
                                <tr key={a.id} className={checked ? 'selected' : ''} onClick={() => toggleStock(a)}>
                                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={checked} readOnly /></td>
                                  <td className="mono">{a.username}</td>
                                  <td className="mono">{a.webUsername || '—'}</td>
                                  <td>{a.displayName || '—'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                <div className="tm-grid2">
                  <div className="tm-field">
                    <label>代理商</label>
                    <select value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}>
                      <option value="">未指定</option>
                      {allAgents.filter((a) => a.status === 'active').map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 第四部分：增值服務 */}
              <div className="tm-section">
                <div className="tm-section-title">增值服務</div>
                {addonCatalog.length === 0 ? (
                  <span className="tm-hint">暫無可選增值服務</span>
                ) : (
                  <div className="tm-addon-grid">
                    {addonCatalog.map((addon) => {
                      const checked = selectedAddonCodes.includes(addon.addonCode);
                      return (
                        <label key={addon.addonCode} className={`tm-addon-item ${checked ? 'checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedAddonCodes((prev) => (checked ? prev.filter((code) => code !== addon.addonCode) : [...prev, addon.addonCode]))}
                          />
                          <span className="tm-addon-name">{addon.name}</span>
                          {addon.description && <span className="tm-hint">{addon.description}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                <span className="tm-hint">勾選項將寫入本批試用的內部批次訂單（與正式訂單明細同構，試用免費按 0 計）</span>
              </div>
            </div>
            {formMessage.text && (
              <div className={`tm-toast ${formMessage.type || 'error'}`}>{formMessage.text}</div>
            )}
            <div className="tm-modal-foot">
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>取消</button>
              <button className="tm-btn primary" type="button" onClick={submitAssign} disabled={assigning}>
                <Plus size={13} /> {assigning ? '添加中…' : '確認添加'}
              </button>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      {ecardStep.open && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel">
            <div className="tm-modal-head">
              <h3>Ecard 設置 — 本批 {ecardStep.accounts.length} 個帳號</h3>
              <button className="tm-btn" type="button" onClick={closeEcardStep} disabled={ecardStep.submitting}>關閉</button>
            </div>
            <div className="tm-modal-body">
              {!ecardStep.results ? (
                <>
                  <div className="tm-section">
                    <div className="tm-section-title">名片設置（統一套用於勾選帳號）</div>
                    <div className="tm-grid3">
                      <div className="tm-field">
                        <label>名片樣式 *</label>
                        <select
                          value={ecardForm.templateId}
                          onChange={async (e) => {
                            const id = e.target.value;
                            setEcardForm((f) => ({ ...f, templateId: id, backgroundId: '' }));
                            const backgrounds = await loadEcardBackgrounds(Number(id));
                            setEcardForm((f) => ({ ...f, backgroundId: backgrounds[0] ? String(backgrounds[0].id) : '' }));
                          }}
                        >
                          {ecardStylesList.length === 0 && <option value="">（無可用樣式）</option>}
                          {ecardStylesList.map((style) => (
                            <option key={style.id} value={style.id}>{style.styleName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="tm-field">
                        <label>背景</label>
                        <select value={ecardForm.backgroundId} onChange={(e) => setEcardForm((f) => ({ ...f, backgroundId: e.target.value }))}>
                          <option value="">（樣式預設）</option>
                          {ecardBackgrounds.map((bg) => (
                            <option key={bg.id} value={bg.id}>{bg.backgroundName || `背景 ${bg.id}`}</option>
                          ))}
                        </select>
                      </div>
                      <div className="tm-field">
                        <label>公司（預設為租戶單位名稱）</label>
                        <input value={ecardForm.company} onChange={(e) => setEcardForm((f) => ({ ...f, company: e.target.value }))} />
                      </div>
                    </div>
                    <div className="tm-field">
                      <label>企業 Logo（不上傳時默認使用 QRTalkie Logo，統一套用於本批）</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {ecardForm.logoDataUrl ? (
                          <img src={ecardForm.logoDataUrl} alt="" style={{ height: '40px', maxWidth: '140px', borderRadius: '6px', border: '1px solid #374151', objectFit: 'contain', background: '#0b1220', padding: '4px' }} />
                        ) : (
                          <span style={{ height: '40px', padding: '0 12px', borderRadius: '6px', background: '#0b1220', border: '1px dashed #374151', display: 'inline-flex', alignItems: 'center', color: '#6b7280', fontSize: '11px' }}>默認 QRTalkie Logo</span>
                        )}
                        <label className="tm-btn" style={{ cursor: 'pointer' }}>
                          上傳 Logo
                          <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleEcardLogoFile} />
                        </label>
                        {ecardForm.logoDataUrl && (
                          <button className="tm-btn" type="button" onClick={() => setEcardForm((f) => ({ ...f, logoDataUrl: '' }))}>移除</button>
                        )}
                      </div>
                      <span className="tm-hint">PNG / JPG / WebP，不超過 5MB</span>
                    </div>
                    <span className="tm-hint">職位/電話/郵件/頭像/功能開關為逐帳號設置，請在下方列表點「編輯」逐個設定；每行可「預覽」效果。</span>
                  </div>

                  <div className="tm-section">
                    <div className="tm-section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      新增帳號列表
                      <span className="tm-hint">已勾選 {ecardSelectedIds.length} / {ecardStep.accounts.length}</span>
                    </div>
                    <div className="tm-stock-list" style={{ maxHeight: '260px', overflowX: 'hidden' }}>
                      <table className="tm-stock-table tm-ecard-table">
                        <thead>
                          <tr>
                            <th style={{ width: '36px' }}></th>
                            <th style={{ width: '120px' }}>SIP 帳號</th>
                            <th style={{ width: '120px' }}>Web 帳號</th>
                            <th style={{ width: '96px' }}>顯示名</th>
                            <th style={{ width: '126px', textAlign: 'right' }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ecardStep.accounts.map((a) => {
                            const checked = ecardSelectedIds.includes(a.trialId);
                            return (
                              <tr
                                key={a.trialId}
                                className={checked ? 'selected' : ''}
                                onClick={() => setEcardSelectedIds((prev) => (checked ? prev.filter((id) => id !== a.trialId) : [...prev, a.trialId]))}
                              >
                                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={checked} readOnly /></td>
                                <td className="mono">{a.username}</td>
                                <td className="mono">{a.webUsername || '—'}</td>
                                <td>{a.name || a.displayName || '—'}</td>
                                <td style={{ textAlign: 'right' }}>
                                  <span style={{ display: 'inline-flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                                    <button className="tm-btn" type="button" onClick={() => openEcardEdit(a)}>編輯</button>
                                    <button className="tm-btn" type="button" onClick={() => previewEcardAccount(a)}>預覽</button>
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="tm-section">
                  <div className="tm-section-title">生成結果（{ecardStep.results.length} 張）</div>
                  <div className="tm-stock-list" style={{ maxHeight: '320px' }}>
                    <table className="tm-stock-table">
                      <thead>
                        <tr>
                          <th>SIP 帳號</th>
                          <th>名片連結</th>
                          <th style={{ width: '90px' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ecardStep.results.map((r) => (
                          <tr key={r.trialId}>
                            <td className="mono">{r.username}</td>
                            <td><a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{r.url}</a></td>
                            <td>
                              <button
                                className="tm-btn"
                                type="button"
                                onClick={() => {
                                  if (navigator.clipboard && navigator.clipboard.writeText) {
                                    navigator.clipboard.writeText(r.url).then(
                                      () => setEcardMessage({ type: 'success', text: '連結已複製。' }),
                                      () => setEcardMessage({ type: 'error', text: '複製失敗，請手動複製。' }),
                                    );
                                  } else {
                                    setEcardMessage({ type: 'error', text: '瀏覽器不支援自動複製，請手動複製。' });
                                  }
                                }}
                              >
                                複製
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            {ecardMessage.text && (
              <div className={`tm-toast ${ecardMessage.type || 'error'}`}>{ecardMessage.text}</div>
            )}
            <div className="tm-modal-foot">
              {!ecardStep.results ? (
                <>
                  <button className="tm-btn" type="button" onClick={closeEcardStep} disabled={ecardStep.submitting}>跳過</button>
                  <button className="tm-btn primary" type="button" onClick={submitEcards} disabled={ecardStep.submitting}>
                    {ecardStep.submitting ? '生成中…' : '生成名片'}
                  </button>
                </>
              ) : (
                <button className="tm-btn primary" type="button" onClick={closeEcardStep}>完成</button>
              )}
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      {ecardEditDraft && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel" style={{ width: '520px' }}>
            <div className="tm-modal-head">
              <h3>編輯名片 — {ecardEditDraft.username}</h3>
              <button className="tm-btn" type="button" onClick={() => setEcardEditDraft(null)}>關閉</button>
            </div>
            <div className="tm-modal-body">
              <div className="tm-grid2">
                <div className="tm-field">
                  <label>頭像</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {ecardEditDraft.avatarDataUrl ? (
                      <img src={ecardEditDraft.avatarDataUrl} alt="" style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #374151' }} />
                    ) : (
                      <span style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#0b1220', border: '1px dashed #374151', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '11px' }}>無</span>
                    )}
                    <label className="tm-btn" style={{ cursor: 'pointer' }}>
                      上傳頭像
                      <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleEcardAvatarFile} />
                    </label>
                    {ecardEditDraft.avatarDataUrl && (
                      <button className="tm-btn" type="button" onClick={() => setEcardEditDraft((d) => ({ ...d, avatarDataUrl: '' }))}>移除</button>
                    )}
                  </div>
                  <span className="tm-hint">PNG / JPG / WebP，不超過 5MB</span>
                </div>
                <div className="tm-field">
                  <label>顯示名</label>
                  <input value={ecardEditDraft.name || ''} onChange={(e) => setEcardEditDraft((d) => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>職務</label>
                  <input value={ecardEditDraft.titleZh || ''} onChange={(e) => setEcardEditDraft((d) => ({ ...d, titleZh: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>電話</label>
                  <input value={ecardEditDraft.phone || ''} onChange={(e) => setEcardEditDraft((d) => ({ ...d, phone: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>郵件</label>
                  <input value={ecardEditDraft.email || ''} onChange={(e) => setEcardEditDraft((d) => ({ ...d, email: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>功能開關</label>
                  <span style={{ display: 'inline-flex', gap: '14px', alignItems: 'center', color: '#e5e7eb', fontSize: '13px', paddingTop: '6px' }}>
                    <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <input type="checkbox" checked={ecardEditDraft.enableVideoCall !== false} onChange={(e) => setEcardEditDraft((d) => ({ ...d, enableVideoCall: e.target.checked }))} />
                      視頻通話
                    </label>
                    <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <input type="checkbox" checked={ecardEditDraft.enableTextChat !== false} onChange={(e) => setEcardEditDraft((d) => ({ ...d, enableTextChat: e.target.checked }))} />
                      文字聊天
                    </label>
                  </span>
                </div>
              </div>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn" type="button" onClick={() => setEcardEditDraft(null)}>取消</button>
              <button className="tm-btn primary" type="button" onClick={saveEcardEdit}>保存</button>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      {ecardPreviewImage.open && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel" style={{ width: '460px' }}>
            <div className="tm-modal-head">
              <h3>名片預覽 — {ecardPreviewImage.username}</h3>
              <button className="tm-btn" type="button" onClick={() => setEcardPreviewImage({ open: false, loading: false, dataUrl: '', username: '' })}>關閉</button>
            </div>
            <div className="tm-modal-body" style={{ alignItems: 'center' }}>
              {ecardPreviewImage.loading || !ecardPreviewImage.dataUrl ? (
                <span className="tm-hint">生成中…</span>
              ) : (
                <img src={ecardPreviewImage.dataUrl} alt="名片預覽" style={{ width: '100%', borderRadius: '10px', border: '1px solid #1f2937' }} />
              )}
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      {aiEntitlementAccount && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel" style={{ width: '460px' }}>
            <div className="tm-modal-head">
              <h3>AI 助手設定 — {aiEntitlementAccount.username}</h3>
              <button className="tm-btn" type="button" onClick={() => setAiEntitlementAccount(null)}>關閉</button>
            </div>
            <form onSubmit={handleAiEntitlementSubmit}>
              <div className="tm-modal-body">
                {aiEntitlementLoading ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af' }}>載入中…</div>
                ) : (
                  <>
                    <div className="tm-field">
                      <label>啟用狀態</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                          type="button"
                          onClick={() => setAiEntitlementForm((f) => ({ ...f, enabled: !f.enabled }))}
                          style={{
                            width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer',
                            backgroundColor: aiEntitlementForm.enabled ? '#22c55e' : '#374151',
                            position: 'relative', transition: 'background-color 0.2s',
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: '3px', left: aiEntitlementForm.enabled ? '25px' : '3px',
                            width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                            transition: 'left 0.2s',
                          }} />
                        </button>
                        <span style={{ fontSize: '13px', color: aiEntitlementForm.enabled ? '#22c55e' : '#9ca3af' }}>
                          {aiEntitlementForm.enabled ? '已啟用' : '已停用'}
                        </span>
                      </div>
                    </div>
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>每日限額</label>
                        <input
                          type="number" min="0" step="1"
                          value={aiEntitlementForm.daily_limit}
                          onChange={(e) => setAiEntitlementForm((f) => ({ ...f, daily_limit: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="tm-field">
                        <label>每月限額（留空不限）</label>
                        <input
                          type="number" min="0" step="1"
                          value={aiEntitlementForm.monthly_limit}
                          onChange={(e) => setAiEntitlementForm((f) => ({ ...f, monthly_limit: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>過期時間（留空永久）</label>
                        <input
                          type="date"
                          value={aiEntitlementForm.expires_at}
                          onChange={(e) => setAiEntitlementForm((f) => ({ ...f, expires_at: e.target.value }))}
                        />
                      </div>
                      <div className="tm-field">
                        <label>備註</label>
                        <input
                          type="text" maxLength="255"
                          value={aiEntitlementForm.notes}
                          onChange={(e) => setAiEntitlementForm((f) => ({ ...f, notes: e.target.value }))}
                          placeholder="授權備註（可選）"
                        />
                      </div>
                    </div>
                    {aiEntitlementMessage.text && (
                      <p style={{ margin: 0, fontSize: '13px', color: aiEntitlementMessage.type === 'error' ? '#ef4444' : '#22c55e' }}>{aiEntitlementMessage.text}</p>
                    )}
                  </>
                )}
              </div>
              <div className="tm-modal-foot">
                <button
                  type="button"
                  className="tm-btn danger"
                  style={{ marginRight: 'auto' }}
                  disabled={aiEntitlementSaving || aiEntitlementLoading}
                  onClick={handleAiEntitlementDelete}
                >
                  取消授權
                </button>
                <button className="tm-btn" type="button" disabled={aiEntitlementSaving} onClick={() => setAiEntitlementAccount(null)}>取消</button>
                <button className="tm-btn primary" type="submit" disabled={aiEntitlementSaving || aiEntitlementLoading}>
                  {aiEntitlementSaving ? '儲存中…' : '確認'}
                </button>
              </div>
            </form>
          </div>
        </div>
        </div>,
        document.body
      )}

      {accountSettingsTarget && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            backgroundColor: 'rgba(15, 23, 42, 0.36)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !accountSettingsSaving) setAccountSettingsTarget(null);
          }}
        >
          <form
            onSubmit={submitAccountSettings}
            style={{ width: 'min(560px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>帳號設置 — {accountSettingsTarget.username}</h3>
              <button type="button" onClick={() => setAccountSettingsTarget(null)} disabled={accountSettingsSaving} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            {accountSettingsLoading ? (
              <div style={{ padding: '40px 18px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>載入中...</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', padding: '18px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>顯示名稱</span>
                    <input
                      value={accountSettingsForm.displayName}
                      onChange={(event) => setAccountSettingsForm((form) => ({ ...form, displayName: event.target.value }))}
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>电子郵箱</span>
                    <input
                      type="email"
                      value={accountSettingsForm.email}
                      onChange={(event) => setAccountSettingsForm((form) => ({ ...form, email: event.target.value }))}
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>移动電話</span>
                    <input
                      value={accountSettingsForm.phone}
                      onChange={(event) => setAccountSettingsForm((form) => ({ ...form, phone: event.target.value }))}
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼</span>
                    <input
                      type="password"
                      value={accountSettingsForm.password}
                      onChange={(event) => setAccountSettingsForm((form) => ({ ...form, password: event.target.value }))}
                      placeholder="不修改請留空"
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼確認</span>
                    <input
                      type="password"
                      value={accountSettingsForm.confirmPassword}
                      onChange={(event) => setAccountSettingsForm((form) => ({ ...form, confirmPassword: event.target.value }))}
                      placeholder="不修改請留空"
                      style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}
                    />
                  </label>
                  {accountSettingsMessage.text && (
                    <p style={{ margin: 0, gridColumn: '1 / -1', fontSize: '14px', color: accountSettingsMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{accountSettingsMessage.text}</p>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
                  <button type="button" onClick={() => setAccountSettingsTarget(null)} disabled={accountSettingsSaving} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>取消</button>
                  <button className="primary-btn" type="submit" disabled={accountSettingsSaving}>{accountSettingsSaving ? '儲存中...' : '儲存修改'}</button>
                </div>
              </>
            )}
          </form>
        </div>,
        document.body
      )}

      {reclaimConfirm.open && reclaimConfirm.trial && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal">
          <div className="tm-modal-panel" style={{ width: '500px' }}>
            <div className="tm-modal-head">
              <h3>立即回庫確認 — {reclaimConfirm.trial.username}</h3>
              <button className="tm-btn" type="button" onClick={() => setReclaimConfirm({ open: false, trial: null })}>關閉</button>
            </div>
            <div className="tm-modal-body">
              <span className="tm-hint" style={{ color: '#fca5a5' }}>以下操作將立即執行且不可撤銷：</span>
              <ul style={{ margin: 0, paddingLeft: '18px', color: '#e5e7eb', fontSize: '13px', lineHeight: 2 }}>
                <li>SIP 帳號與配對 Web 帳號釋放回庫存（恢復初始狀態）</li>
                <li>在通訊核心（AM）停用該 SIP 帳號——設備端將無法再註冊/通話</li>
                <li>刪除該帳號的 AI 使用權限與 API Key</li>
                <li>該帳號的 Ecard 名片將被停用（名片連結立即失效）</li>
                <li>清除該帳號的推送設備與登入會話</li>
              </ul>
              <span className="tm-hint">回庫後該帳號可被再次分配給其他用戶。</span>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn" type="button" onClick={() => setReclaimConfirm({ open: false, trial: null })}>取消</button>
              <button
                className="tm-btn danger"
                type="button"
                onClick={() => {
                  const target = reclaimConfirm.trial;
                  setReclaimConfirm({ open: false, trial: null });
                  endTrial(target, 'reclaim_now');
                }}
              >
                確認回庫
              </button>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default TrialManagement;
