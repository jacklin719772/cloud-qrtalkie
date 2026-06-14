import React, { useState, forwardRef, useImperativeHandle, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Copy, Image as ImageIcon, Plus, RefreshCw, UploadCloud, Check, Eye, Phone, Mail, MapPin, Download } from 'lucide-react';
import apiClient from './apiClient';
import { QRCodeSVG } from 'qrcode.react';
import html2canvas from 'html2canvas';

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

function checkExpirationStatus(validTo) {
  if (!validTo) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiresAt = new Date(String(validTo).slice(0, 10));
  if (Number.isNaN(expiresAt.getTime())) return 'none';
  expiresAt.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 7) return 'expiring';
  return 'valid';
}

// 静态 mock 數據
const mockEcardAccounts = [
  {
    id: 1,
    userName: '张伟',
    sipAccount: '1000001',
    webAccount: '2000001',
    avatarUrl: '',
    ecardThumbnailUrl: '',
    downloadUrl: 'https://ecard.qrtalkie.org/d/1000001',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    enabled: true,
    configured: true,
    accessUrl: 'https://ecard.qrtalkie.org/u/1000001',
    createdBy: '管理员A',
    createdAt: '2026-05-20'
  },
  {
    id: 2,
    userName: '李娜',
    sipAccount: '1000002',
    webAccount: '',
    avatarUrl: '',
    ecardThumbnailUrl: '',
    downloadUrl: 'https://ecard.qrtalkie.org/d/1000002',
    validFrom: '2026-06-01',
    validTo: '2026-12-31',
    enabled: true,
    configured: true,
    accessUrl: 'https://ecard.qrtalkie.org/u/1000002',
    createdBy: '张三',
    createdAt: '2026-05-21'
  },
  {
    id: 3,
    userName: '赵敏',
    sipAccount: '1000004',
    webAccount: '2000004',
    avatarUrl: '',
    ecardThumbnailUrl: '',
    downloadUrl: '',
    validFrom: '',
    validTo: '',
    enabled: false,
    configured: false,
    accessUrl: '',
    createdBy: '',
    createdAt: ''
  }
];

const EcardGeneration = forwardRef(({ onModeChange, selfServiceSipUserId, onSelfServiceBack }, ref) => {
  const isSelfService = !!selfServiceSipUserId;
  const [viewMode, setViewMode] = useState(isSelfService ? 'add' : 'list');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [ecardAccounts, setEcardAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);
  const templateScrollRef = useRef(null);
  const [selectedAccountForCreate, setSelectedAccountForCreate] = useState(null);
  const [ecardSortKey, setEcardSortKey] = useState("sipAccount");
  const [ecardSortDir, setEcardSortDir] = useState("asc");

  // 樣式模板數據與預覽狀態
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [showTestPreviewModal, setShowTestPreviewModal] = useState(false);
  const [testPreviewImageUrl, setTestPreviewImageUrl] = useState('');
  const [previewImageModalOpen, setPreviewImageModalOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [selectedBackgroundId, setSelectedBackgroundId] = useState(null);
  const [showQrCode, setShowQrCode] = useState(false);
  const [enableVideoCall, setEnableVideoCall] = useState(true);

  const [callPublicSlug, setCallPublicSlug] = useState(() => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 20; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  });

  const generateRandomSlug = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 20; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    setCallPublicSlug(result);
  };

  const callUrl = `${import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin}/ecard?id=${callPublicSlug}`;

  const visitorUrl = callUrl;

  const ecardAccessUrl = useMemo(() => {
    if (!selectedAccountForCreate) return 'https://ecard.qrtalkie.org/u/—';
    const slug = selectedAccountForCreate.access_slug || selectedAccountForCreate.sipAccount;
    return `https://ecard.qrtalkie.org/u/${slug}`;
  }, [selectedAccountForCreate]);
  const [previewSize, setPreviewSize] = useState(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [scale, setScale] = useState(1);
  const viewportRef = useRef(null);
  const ecardCanvasRef = useRef(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // 用於存储左侧“颜色配置”面板的实时樣式覆盖
  const [localStyles, setLocalStyles] = useState({});

  // 动态顯示控制狀態
  const [localDisplayConfig, setLocalDisplayConfig] = useState({
    showEnJobTitle: true,
    showEnCompanyName: true,
    showQrCodeDesc: true,
    showSlogan: true
  });

  const [cardData, setCardData] = useState({
    name: '张浩',
    titleZh: '市场经理',
    titleEn: 'Market Manager',
    phone: '+86 138 1234 5678',
    email: 'zhanghao@company.com',
    zipCode: '200120',
    address: '臺灣',
    qrDesc: '掃碼二維碼 · 交換名片',
    companyZh: 'QRTalkie Team',
    companyEn: 'QRTalkie Team',
    sloganZh: '连接价值 · 智联未来',
    sloganEn: 'Connecting Value, Linking the Future'
  });

  const handleCardDataChange = (field) => (e) => {
    setCardData(prev => ({ ...prev, [field]: e.target.value }));
  };

  function safeParseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      console.warn('JSON parse failed:', e);
      return fallback;
    }
  }

  const showCompanyInfo = selectedTemplate ? selectedTemplate.companyNameEnabled : true;
  const selectedBg = selectedTemplate?.backgrounds?.find(bg => String(bg.id) === String(selectedBackgroundId));
  const previewSrc = getFullImageUrl(selectedBg?.imageUrl || selectedTemplate?.coverImageUrl);

  const layoutFields = safeParseJson(selectedBg?.layoutJson).fields || safeParseJson(selectedBg?.layoutJson) || {};
  const styleFields = safeParseJson(selectedBg?.defaultStyleJson).styles || safeParseJson(selectedBg?.defaultStyleJson) || {};
  const displayFields = safeParseJson(selectedBg?.displayConfigJson).display || safeParseJson(selectedBg?.displayConfigJson) || {};
  
  // 画布的基准宽高尺寸
  const originalWidth = selectedBg?.imageWidth || previewSize?.width || 1536;
  const originalHeight = selectedBg?.imageHeight || previewSize?.height || 1024;

  const getMergedStyle = (key, extraStyle = {}, isText = false) => {
    const layout = layoutFields[key] || {};
    const baseStyle = styleFields[key] || {};
    const style = { ...baseStyle, ...(localStyles[key] || {}) };
    
    let merged = {
      position: 'absolute',
      boxSizing: 'border-box',
      zIndex: 1,
      ...extraStyle
    };

    if (layout.x !== undefined || layout.y !== undefined) {
      if (layout.x !== undefined) merged.left = typeof layout.x === 'number' ? `${layout.x}px` : layout.x;
      if (layout.y !== undefined) merged.top = typeof layout.y === 'number' ? `${layout.y}px` : layout.y;
      if (layout.width !== undefined) merged.width = typeof layout.width === 'number' ? `${layout.width}px` : layout.width;
      if (layout.height !== undefined) merged.height = typeof layout.height === 'number' ? `${layout.height}px` : layout.height;
      if (layout.borderRadius !== undefined) merged.borderRadius = typeof layout.borderRadius === 'number' ? `${layout.borderRadius}px` : layout.borderRadius;
      if (layout.objectFit !== undefined) merged.objectFit = layout.objectFit;
    }
    
    if (style.color) merged.color = style.color;
    if (style.fontFamily) merged.fontFamily = style.fontFamily;
    if (style.fontSize !== undefined) merged.fontSize = typeof style.fontSize === 'number' ? `${style.fontSize}px` : style.fontSize;
    if (style.fontWeight) merged.fontWeight = style.fontWeight;
    if (style.textAlign) merged.textAlign = style.textAlign;
    if (style.lineHeight) merged.lineHeight = style.lineHeight;
    if (style.letterSpacing) merged.letterSpacing = style.letterSpacing;
    if (style.textShadow) merged.textShadow = style.textShadow;
    if (style.whiteSpace) merged.whiteSpace = style.whiteSpace;
    
    if (style.backgroundColor) merged.backgroundColor = style.backgroundColor;
    if (style.border) merged.border = style.border;
    if (style.boxShadow) merged.boxShadow = style.boxShadow;
    if (style.padding !== undefined) merged.padding = typeof style.padding === 'number' ? `${style.padding}px` : style.padding;
    if (style.filter) merged.filter = style.filter;
    if (style.opacity !== undefined) merged.opacity = style.opacity;

    if (isText) {
      merged.whiteSpace = merged.whiteSpace || 'pre-line';
      merged.overflow = 'hidden';
    }
    
    return merged;
  };

  const isVisible = (key, localVisible = true) => {
    const ucKey = `show${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (displayFields[ucKey] === false) return false;
    if (displayFields[key] === false) return false;
    return localVisible;
  };

  const renderTextField = (key, value, visible = true) => {
    if (!visible || !isVisible(key, visible)) return null;
    return <div style={getMergedStyle(key, {}, true)}>{value}</div>;
  };

  const renderImageField = (key, src, fallbackText, visible = true) => {
    if (!visible || !isVisible(key, visible)) return null;
    const style = getMergedStyle(key);
    if (src) {
      return <img src={src} alt={key} crossOrigin="anonymous" style={{ ...style, objectFit: style.objectFit || 'cover' }} />;
    }
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', color: '#cbd5e1' }}>
        {fallbackText}
      </div>
    );
  };

  const renderShapeField = (key, visible = true) => {
    if (!visible || !isVisible(key, visible)) return null;
    return <div style={getMergedStyle(key)} />;
  };

  const renderIconField = (key, iconType, visible = true) => {
    if (!visible || !isVisible(key, visible)) return null;
    const style = getMergedStyle(key);
    let IconComp = null;
    if (iconType === 'phone') IconComp = Phone;
    if (iconType === 'email') IconComp = Mail;
    if (iconType === 'address') IconComp = MapPin;
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {IconComp ? <IconComp size="100%" /> : <span style={{fontSize: '10px'}}>icon</span>}
      </div>
    );
  };

  const renderQrCodeField = (key, value, visible = true) => {
    if (!visible || !isVisible(key, visible)) return null;
    return (
      <div style={getMergedStyle(key)}>
        <QRCodeSVG value={value} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    );
  };

  const titleText = localDisplayConfig.showEnJobTitle && cardData.titleEn
    ? `${cardData.titleZh} | ${cardData.titleEn}`
    : cardData.titleZh;

  const addressText = cardData.zipCode
    ? `${cardData.address}\n${cardData.zipCode}`
    : cardData.address;

  // 文件上傳处理逻辑
  const handleFileUpload = (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setter(event.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 重設 input 以允许重复上傳相同文件
  };

  useEffect(() => {
    if (!previewSrc) {
      setPreviewSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => setPreviewSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = previewSrc;

    // 调试用途：当背景圖片更新时，打印其 JSON 配置
    if (selectedBg) {
      console.log(`Selected Background JSONs for ID ${selectedBg.id}:`, selectedBg.layoutJson, selectedBg.defaultStyleJson, selectedBg.displayConfigJson);
    }
    setLocalStyles({}); // 切换背景圖片时重設用户的局部修改
  }, [previewSrc]);

  // 监听右侧預覽容器的实际宽度與高度，据此动态计算画布的整体缩放比例 scale
  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const availableWidth = entry.contentRect.width;
        const availableHeight = entry.contentRect.height;
        if (availableWidth === 0 || availableHeight === 0) continue;
        
        const scaleW = availableWidth / originalWidth;
        const scaleH = availableHeight / originalHeight;
        const newScale = Math.min(scaleW, scaleH, 1);
        setScale(newScale);
      }
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [originalWidth, originalHeight, viewMode]);

  useEffect(() => {
    setLocalDisplayConfig({
      showEnJobTitle: selectedBg?.displayConfigJson?.showEnJobTitle !== false,
      showEnCompanyName: selectedBg?.displayConfigJson?.showEnCompanyName !== false,
      showQrCodeDesc: selectedBg?.displayConfigJson?.showQrCodeDesc !== false,
      showSlogan: selectedBg?.displayConfigJson?.showSlogan !== false
    });
  }, [selectedBg]);

  // 从基础數據表拉取有效的 Ecard 樣式
  useEffect(() => {
    if (viewMode === 'add') {
      setTemplatesLoading(true);
      setTemplatesError('');
      apiClient.get('/tenant/ecard-styles')
        .then(res => {
          const data = res && Array.isArray(res.styles) ? res.styles : [];
          const active = data.filter(item => item.status === 'active' || item.status === 1 || item.enabled === true);
          
          if (active.length > 0) {
            setTemplates(active);
            if (!isSelfService || !selectedTemplateId) {
              setSelectedTemplateId(active[0].id);
              setSelectedTemplate(active[0]);
              if (active[0].backgrounds && active[0].backgrounds.length > 0) {
                setSelectedBackgroundId(active[0].backgrounds[0].id);
              }
            }
          } else {
            setTemplates([]);
            setSelectedTemplateId('');
            setSelectedTemplate(null);
            setSelectedBackgroundId(null);
          }
        })
        .catch(err => {
          console.error('獲取樣式模板失败:', err);
          // 提取真实错误信息暴露在界面上，便於联调（如 404 Not Found 等）
          const errorMsg = err.response?.data?.message || err.response?.statusText || err.message || '未知异常';
          setTemplatesError(`載入失败: ${errorMsg}`);
          setTemplates([]);
          setSelectedTemplateId('');
          setSelectedTemplate(null);
          setSelectedBackgroundId(null);
        })
        .finally(() => {
          setTemplatesLoading(false);
        });
    }
  }, [viewMode]);

  // Sync selectedTemplate when selectedTemplateId or templates change (handles self-service async load)
  useEffect(() => {
    if (!selectedTemplateId || templates.length === 0) return;
    const tpl = templates.find(t => String(t.id) === String(selectedTemplateId));
    if (tpl && String(tpl.id) !== String(selectedTemplate?.id || '')) {
      setSelectedTemplate(tpl);
      // Sync background if needed
      const bgBelongsToTemplate = (tpl.backgrounds || []).find(b => String(b.id) === String(selectedBackgroundId));
      if (!bgBelongsToTemplate && tpl.backgrounds && tpl.backgrounds.length > 0) {
        setSelectedBackgroundId(tpl.backgrounds[0].id);
      }
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    onModeChange?.(viewMode);
  }, [viewMode, onModeChange]);

  // Self-service mode: load data and enter add view
  useEffect(() => {
    if (!selfServiceSipUserId) return;
    (async () => {
      let meData, existingEcard, ecardMeta;
      try { meData = await apiClient.get('/me'); } catch { return; }
      try {
        const ecRes = await apiClient.get(`/tenant/ecard-accounts/${selfServiceSipUserId}/ecard`);
        existingEcard = ecRes.ecardDataJson || null;
        ecardMeta = { validFrom: ecRes.validFrom, validTo: ecRes.validTo, status: ecRes.status, thumbnailUrl: ecRes.thumbnailUrl, avatarUrl: ecRes.avatarUrl, accessSlug: ecRes.accessSlug };
      } catch {}

      const accountInfo = {
        id: selfServiceSipUserId,
        sip_user_id: selfServiceSipUserId,
        sipAccount: meData.admin?.username || '',
        userName: meData.admin?.displayName || '',
        tenantName: meData.tenant?.companyName || '',
        accessUrl: ecardMeta?.accessSlug ? `https://ecard.qrtalkie.org/u/${ecardMeta.accessSlug}` : '',
        validFrom: ecardMeta?.validFrom || '—',
        validTo: ecardMeta?.validTo || '—',
        ecardThumbnailUrl: ecardMeta?.thumbnailUrl || '',
        enabled: ecardMeta?.status === 'active',
      };

      setSelectedAccountForCreate(existingEcard
        ? { ...accountInfo, configured: true }
        : accountInfo
      );

      if (existingEcard) {
        // Load ALL saved state at once
        if (existingEcard.selectedTemplateId) setSelectedTemplateId(existingEcard.selectedTemplateId);
        if (existingEcard.selectedBackgroundId) setSelectedBackgroundId(existingEcard.selectedBackgroundId);
        if (existingEcard.cardData) setCardData(existingEcard.cardData);
        if (existingEcard.localStyles) setLocalStyles(existingEcard.localStyles);
        if (existingEcard.localDisplayConfig) setLocalDisplayConfig(existingEcard.localDisplayConfig);
        if (typeof existingEcard.showQrCode === 'boolean') setShowQrCode(existingEcard.showQrCode);
        if (existingEcard.callPublicSlug) setCallPublicSlug(existingEcard.callPublicSlug);
        if (existingEcard.avatarDataUrl) setAvatarDataUrl(existingEcard.avatarDataUrl);
        if (existingEcard.logoDataUrl) setLogoDataUrl(existingEcard.logoDataUrl);
      } else {
        // Fill defaults from profile
        setCardData({
          name: meData.admin?.displayName || '',
          titleZh: '', titleEn: '',
          phone: meData.admin?.phoneNumber || '',
          email: (typeof meData.admin?.email === 'string' && meData.admin.email.includes('@')) ? meData.admin.email : '',
          zipCode: '', address: '',
          qrDesc: '掃碼二維碼 · 交換名片',
          companyZh: meData.tenant?.companyName || '',
          companyEn: '', sloganZh: '', sloganEn: '',
        });
        setLocalStyles({});
        setShowQrCode(false);
        setAvatarDataUrl('');
        setLogoDataUrl('');
        generateRandomSlug();
      }
    })();
  }, [selfServiceSipUserId]);

  const handleEcardListSort = (key) => { if (ecardSortKey === key) { setEcardSortDir(d => d === "asc" ? "desc" : "asc"); } else { setEcardSortKey(key); setEcardSortDir("asc"); } };

  const sortedEcardAccounts = useMemo(() => { const list = [...ecardAccounts]; list.sort((a, b) => { const va = String(a[ecardSortKey] || ""); const vb = String(b[ecardSortKey] || ""); return va.localeCompare(vb) * (ecardSortDir === "asc" ? 1 : -1); }); return list; }, [ecardAccounts, ecardSortKey, ecardSortDir]);

  const EcardSortIcon = ({ col }) => (<span style={{ fontSize: 10, marginLeft: 2, color: ecardSortKey === col ? "#60a5fa" : "#4b5563" }}>{ecardSortKey === col ? (ecardSortDir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>);

  const handleTemplateChange = (id) => {
    setSelectedTemplateId(id);
    const tpl = templates.find(t => String(t.id) === String(id));
    setSelectedTemplate(tpl || null);
    if (tpl && tpl.backgrounds && tpl.backgrounds.length > 0) {
      setSelectedBackgroundId(tpl.backgrounds[0].id);
    } else {
      setSelectedBackgroundId(null);
    }
  };

  // 背景模板横向滚动控制
  const handleScrollTemplates = (direction) => {
    if (templateScrollRef.current) {
      const scrollAmount = direction === 'left' ? -180 : 180; // 每次滚动大约一個卡片的距离
      templateScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleToggleConfig = (key) => {
    setLocalDisplayConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 动态載入真实的 SIP 與 Ecard 聚合列表
  const loadEcardAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      // 請求后端聚合接口，獲取啟用的 SIP 帳號及關联的 web 帳號、名片信息
      const data = await apiClient.get('/tenant/ecard-accounts');
      setEcardAccounts(data.accounts || []);
    } catch (err) {
      console.warn('接口載入失败，降级使用模拟數據:', err);
      setEcardAccounts(mockEcardAccounts);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'list') {
      loadEcardAccounts();
    }
  }, [viewMode]);

  const filteredAccounts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return ecardAccounts.filter(acc => {
      const matchesKeyword = !keyword ||
        (acc.userName && acc.userName.toLowerCase().includes(keyword)) ||
        (acc.sipAccount && acc.sipAccount.toLowerCase().includes(keyword));
      if (!matchesKeyword) return false;
      
      if (statusFilter === 'all') return true;
      if (statusFilter === 'enabled') return acc.enabled === true;
      if (statusFilter === 'disabled') return acc.enabled === false;
      if (statusFilter === 'configured') return acc.configured === true;
      if (statusFilter === 'unconfigured') return acc.configured === false;
      
      const expStatus = checkExpirationStatus(acc.validTo);
      if (statusFilter === 'valid') return expStatus === 'valid' || expStatus === 'expiring';
      if (statusFilter === 'expiring') return expStatus === 'expiring';
      if (statusFilter === 'expired') return expStatus === 'expired';
      
      return true;
    });
  }, [ecardAccounts, query, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [query, statusFilter]);

  const totalItems = filteredAccounts.length;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages);

  const paginatedEcardAccounts = useMemo(() => {
    if (pageSize === 'all') return filteredAccounts;
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredAccounts.slice(start, start + pageSize);
  }, [filteredAccounts, safeCurrentPage, pageSize]);

  const stats = useMemo(() => {
    let configured = 0;
    let unconfigured = 0;
    let expiring = 0;
    let expired = 0;
    let enabled = 0;
    
    ecardAccounts.forEach(acc => {
      if (acc.configured) configured++;
      else unconfigured++;
      
      if (acc.enabled) enabled++;
      
      const expStatus = checkExpirationStatus(acc.validTo);
      if (expStatus === 'expiring') expiring++;
      if (expStatus === 'expired') expired++;
    });

    return { total: ecardAccounts.length, configured, unconfigured, enabled, expiring, expired };
  }, [ecardAccounts]);

  const handleSaveAndGenerateImage = async () => {
    if (!selectedAccountForCreate) {
      alert("請先選擇一個帳號");
      return;
    }

    setIsGenerating(true);
    try {
      if (!ecardCanvasRef.current) throw new Error("找不到名片預覽区域");

      const canvasEl = ecardCanvasRef.current;
      const originalTransform = canvasEl.style.transform;
      canvasEl.style.transform = 'none';

      const canvas = await html2canvas(canvasEl, {
        useCORS: true,
        scale: 2,
        backgroundColor: null
      });

      canvasEl.style.transform = originalTransform;

      const thumbnailDataUrl = canvas.toDataURL("image/jpeg", 0.8);

      const ecardDataJson = {
        cardData,
        selectedTemplateId,
        selectedBackgroundId,
        localStyles,
        localDisplayConfig,
        showQrCode,
        callPublicSlug,
        avatarDataUrl,
        logoDataUrl
      };

      const payload = {
        accessSlug: callPublicSlug,
        avatarDataUrl,
        logoDataUrl,
        thumbnailDataUrl,
        ecardDataJson,
        enableVideoCall
      };

      await apiClient.post(`/tenant/ecard-accounts/${selectedAccountForCreate.sip_user_id || selectedAccountForCreate.id}/ecard`, payload);
      alert('名片已成功儲存并產生圖片！');
      
      loadEcardAccounts();
      setSelectedAccountForCreate(prev => ({
        ...prev,
        configured: true,
        ecardThumbnailUrl: thumbnailDataUrl
      }));
    } catch (err) {
      console.error(err);
      alert(err.message || '儲存和產生圖片失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePreviewEcard = (item) => {
    if (!item.configured || !item.ecardThumbnailUrl) {
      alert('该帳號尚未配置名片圖片');
      return;
    }
    setPreviewImageUrl(getFullImageUrl(item.ecardThumbnailUrl));
    setPreviewImageModalOpen(true);
  };

  const handlePreviewAndTest = () => {
    if (!selectedAccountForCreate || !selectedAccountForCreate.configured || !selectedAccountForCreate.ecardThumbnailUrl) {
      alert("当前設置未儲存，無法进行預覽&测试操作");
      return;
    }
    setTestPreviewImageUrl(getFullImageUrl(selectedAccountForCreate.ecardThumbnailUrl));
    setShowTestPreviewModal(true);
  };

  const handleDownloadEcardImage = async (item, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setOpenDropdownId(null);

    console.log('download item:', item);
    console.log('item.ecardThumbnailUrl:', item.ecardThumbnailUrl);
    console.log('item.downloadUrl:', item.downloadUrl);
    console.log('item.accessUrl:', item.accessUrl);
    console.log('final imageUrl:', getFullImageUrl(item.ecardThumbnailUrl));

    const rawImageUrl = item.ecardImageUrl || item.ecardThumbnailUrl || item.thumbnailDataUrl;

    if (!item.configured || !rawImageUrl) {
      alert('该帳號尚未配置名片圖片，無法下載。');
      return;
    }

    const invalidPageUrl =
      /\/d\/[^/]+/.test(rawImageUrl) ||
      /\/u\/[^/]+/.test(rawImageUrl) ||
      /\/ecard\/[^/]+/.test(rawImageUrl) ||
      rawImageUrl === item.downloadUrl ||
      rawImageUrl === item.accessUrl;

    if (invalidPageUrl) {
      console.error('当前下載地址不是圖片地址，而是頁面地址:', rawImageUrl, item);
      alert('当前記錄没有返回真实圖片地址，無法直接下載圖片。請检查后端 ecardThumbnailUrl / ecardImageUrl 字段。');
      return;
    }

    try {
      const filename = `ecard_${item.userName || item.sipAccount || item.id}.jpg`;

      if (rawImageUrl.startsWith('data:image/')) {
        const link = document.createElement('a');
        link.href = rawImageUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const imageUrl = getFullImageUrl(rawImageUrl);
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(`下載請求失败：${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        console.error('下載地址返回的不是圖片:', imageUrl, contentType);
        alert('下載地址返回的不是圖片文件，請检查后端返回的圖片地址。');
        return;
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('下載圖片失败:', err);
      alert('下載圖片失败，請稍後重試。');
    }
  };

  const handleToggleStatus = async (item) => {
    setOpenDropdownId(null);
    if (!item.configured) {
      alert('该帳號尚未配置名片，無法啟用/停用。');
      return;
    }
    const nextStatus = item.enabled ? 'disabled' : 'active';
    const actionText = item.enabled ? '停用' : '啟用';
    if (!window.confirm(`確定要${actionText}该帳號的電子名片嗎？`)) return;

    try {
      await apiClient.put(`/tenant/ecard-accounts/${item.id}/ecard/status`, { status: nextStatus });
      loadEcardAccounts();
    } catch (err) {
      alert(err.message || `${actionText}失败`);
    }
  };

  const getSelectedActionableEcards = (actionLabel) => {
    const selectedAccounts = ecardAccounts.filter((account) => selectedIds.includes(account.id));
    if (selectedAccounts.length === 0) {
      window.alert('請先選擇帳號。');
      return [];
    }
    const unconfigured = selectedAccounts.filter(acc => !acc.configured);
    if (unconfigured.length > 0) {
      window.alert(`选中的帳號中有 ${unconfigured.length} 個尚未配置名片，無法进行${actionLabel}。`);
      return [];
    }
    return selectedAccounts;
  };

  const handleBatchToggle = async (status, actionLabel) => {
    const targets = getSelectedActionableEcards(actionLabel);
    if (targets.length === 0) return;
    
    // 过滤掉已经处於目标狀態的名片，避免重复請求
    const actualTargets = targets.filter(acc => {
      const isEnabled = acc.enabled;
      if (status === 'active' && isEnabled) return false;
      if (status === 'disabled' && !isEnabled) return false;
      return true;
    });

    if (actualTargets.length === 0) {
      window.alert(`选中的帳號均已处於${actionLabel}狀態。`);
      return;
    }

    if (!window.confirm(`確定要${actionLabel}选中的 ${actualTargets.length} 個電子名片嗎？`)) return;
    try {
      // 改為串行請求，防止 MySQL 并发更新时产生死锁（Deadlock）
      for (const acc of actualTargets) {
        await apiClient.put(`/tenant/ecard-accounts/${acc.id}/ecard/status`, { status });
      }
      setSelectedIds([]);
      loadEcardAccounts();
      alert(`批量${actionLabel}成功`);
    } catch (err) {
      alert(err.message || `部分或全部${actionLabel}失败`);
      loadEcardAccounts();
    }
  };

  const handleOpenEditor = async (item) => {
    setOpenDropdownId(null);
    setSelectedAccountForCreate(item);
    
    setCardData({
      name: item.userName || '张浩',
      titleZh: '市场经理',
      titleEn: 'Market Manager',
      phone: '+86 138 1234 5678',
      email: 'zhanghao@company.com',
      zipCode: '200120',
      address: '臺灣',
      qrDesc: '掃碼二維碼 · 交換名片',
      companyZh: 'QRTalkie Team',
      companyEn: 'QRTalkie Team',
      sloganZh: '连接价值 · 智联未来',
      sloganEn: 'Connecting Value, Linking the Future'
    });
    setLocalStyles({});
    setShowQrCode(false);
    setAvatarDataUrl('');
    setLogoDataUrl('');
    generateRandomSlug(); 

    if (item.configured) {
      try {
        const res = await apiClient.get(`/tenant/ecard-accounts/${item.id}/ecard`);
        const ecardDataJson = res.ecardDataJson;
        if (ecardDataJson) {
          if (ecardDataJson.cardData) setCardData(ecardDataJson.cardData);
          if (ecardDataJson.selectedTemplateId) setSelectedTemplateId(ecardDataJson.selectedTemplateId);
          if (ecardDataJson.selectedBackgroundId) setSelectedBackgroundId(ecardDataJson.selectedBackgroundId);
          if (ecardDataJson.localStyles) setLocalStyles(ecardDataJson.localStyles);
          if (ecardDataJson.localDisplayConfig) setLocalDisplayConfig(ecardDataJson.localDisplayConfig);
          if (typeof ecardDataJson.showQrCode === 'boolean') setShowQrCode(ecardDataJson.showQrCode);
          if (ecardDataJson.callPublicSlug) setCallPublicSlug(ecardDataJson.callPublicSlug);
          if (ecardDataJson.avatarDataUrl) setAvatarDataUrl(ecardDataJson.avatarDataUrl);
          if (ecardDataJson.logoDataUrl) setLogoDataUrl(ecardDataJson.logoDataUrl);
        }
      } catch (err) {
        console.warn('Failed to load existing ecard config:', err);
      }
    }
    setViewMode('add');
  };

  // 更新局部樣式覆盖
  const handleLocalStyleChange = (key, property, value) => {
    setLocalStyles(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [property]: value
      }
    }));
  };

  // 下拉菜单點击外部關閉
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // 下拉菜单定位
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
  
  const loadJSZip = async () => {
    if (window.JSZip) return window.JSZip;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  const handleBatchDownloadEcardImages = async () => {
    const targets = getSelectedActionableEcards('批量下載');
    if (targets.length === 0) return;

    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let hasValidFiles = false;
      
      for (const item of targets) {
        const rawImageUrl = item.ecardImageUrl || item.ecardThumbnailUrl || item.thumbnailDataUrl;
        if (!item.configured || !rawImageUrl) continue;

        const invalidPageUrl =
          /\/d\/[^/]+/.test(rawImageUrl) ||
          /\/u\/[^/]+/.test(rawImageUrl) ||
          /\/ecard\/[^/]+/.test(rawImageUrl) ||
          rawImageUrl === item.downloadUrl ||
          rawImageUrl === item.accessUrl;

        if (invalidPageUrl) continue;

        const filename = `ecard_${item.userName || item.sipAccount || item.id}.jpg`;
        
        if (rawImageUrl.startsWith('data:image/')) {
          const base64Data = rawImageUrl.split(',')[1];
          zip.file(filename, base64Data, { base64: true });
          hasValidFiles = true;
        } else {
          const imageUrl = getFullImageUrl(rawImageUrl);
          const response = await fetch(imageUrl);
          if (response.ok) {
            const blob = await response.blob();
            zip.file(filename, blob);
            hasValidFiles = true;
          }
        }
      }

      if (!hasValidFiles) {
        alert('未找到可下載的有效名片圖片。');
        return;
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ecards_batch_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('批量下載失败:', err);
      alert('批量下載失败，請稍後重試。');
    }
  };

  useImperativeHandle(ref, () => ({
    startAdd: () => setViewMode('add'),
    handleBatchDownload: handleBatchDownloadEcardImages,
    handleBatchEnable: () => handleBatchToggle('active', '啟用'),
    handleBatchDisable: () => handleBatchToggle('disabled', '停用'),
  }));

  if (viewMode === 'add') {
    return (
      <section className="ecard-generation-page ecard-add-page">
        <style>{`
          /* 覆盖全局结构樣式，使新增頁面完全独立，隱藏原有标题区和外层 Padding */
          .page-heading { display: none !important; }
          .main-scroll { padding: 0 !important; }

          .ecard-add-page {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
            background: #1a2332;
            animation: fadeIn 0.3s ease-in-out;
          }
          .ecard-add-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 32px;
            background: #111827;
            border-bottom: 1px solid #1f2937;
            flex-shrink: 0;
            z-index: 10;
          }
          .ecard-add-title h2 { margin: 0; font-size: 20px; color: #f3f4f6; font-weight: 600; }
          .ecard-add-actions { display: flex; gap: 16px; align-items: center; }
          
          .ecard-add-content {
            display: flex;
            flex: 1;
            min-height: 0;
            padding: 24px 32px;
            gap: 24px;
          }
          
          /* --- 左侧表单区 --- */
          .ecard-add-left {
            flex: 0 0 48%;
            display: flex;
            flex-direction: column;
            gap: 20px;
            overflow-y: auto;
            padding-right: 8px;
            scrollbar-width: thin;
            scrollbar-color: #374151 transparent;
          }
          .ecard-add-left::-webkit-scrollbar { width: 6px; }
          .ecard-add-left::-webkit-scrollbar-track { background: transparent; }
          .ecard-add-left::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
          .ecard-form-group {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
          }
          .ecard-form-title {
            font-size: 15px;
            font-weight: 600;
            color: #f3f4f6;
            margin: 0 0 20px 0;
            border-left: 3px solid #3b82f6;
            padding-left: 8px;
            display: flex;
            align-items: center;
          }
          .ecard-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .ecard-form-grid.single-column { grid-template-columns: 1fr; }
          .ecard-form-grid label { display: flex; flex-direction: column; gap: 8px; }
          .ecard-form-grid label span { font-size: 13px; font-weight: 500; color: #9ca3af; }
          .ecard-form-grid input, .ecard-form-grid select {
            padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #e5e7eb; outline: none; background: #111827;
          }
          .ecard-form-grid input[readonly] { background: #1a2332; color: #9ca3af; border-color: #374151; }
          
          .ecard-input-with-icon { position: relative; display: flex; align-items: center; }
          .ecard-input-with-icon input { flex: 1; padding-right: 36px; }
          .ecard-input-with-icon button { position: absolute; right: 8px; background: none; border: none; color: #9ca3af; cursor: pointer; padding: 4px; display: flex; align-items: center; }
          
          .ecard-static-switch { display: inline-flex; width: 36px; height: 20px; background: #2563eb; border-radius: 999px; position: relative; transition: background 0.2s ease; cursor: pointer; }
          
          .ecard-media-layout { display: flex; gap: 24px; }
          .ecard-upload-area {
            flex: 0 0 140px; height: 140px; background: #1a2332; border: 1px dashed #cbd5e1; border-radius: 8px;
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #9ca3af; cursor: pointer;
          }
          .ecard-upload-area:hover { border-color: #3b82f6; color: #3b82f6; background: #1e3a5f; }
          .ecard-upload-area span { font-size: 12px; font-weight: 500; }
          .ecard-upload-area small { font-size: 11px; color: #94a3b8; }
          
          /* 模板横向滚动区域 */
          .ecard-template-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
          .ecard-template-nav-btns { display: flex; gap: 8px; }
          .ecard-template-nav-btn { width: 24px; height: 24px; border: 1px solid #cbd5e1; border-radius: 4px; background: #111827; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #9ca3af; font-size: 16px; line-height: 1; }
          .ecard-template-nav-btn:hover { background: #1a2332; }
          
          .ecard-template-cards-wrapper { margin-bottom: 20px; }
          .ecard-template-cards { 
            display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; 
            scrollbar-width: thin; scrollbar-color: #374151 #111827; 
          }
          .ecard-template-cards::-webkit-scrollbar { height: 6px; }
          .ecard-template-cards::-webkit-scrollbar-track { background: #1a2332; border-radius: 4px; }
          .ecard-template-cards::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
          
          .ecard-template-card {
            flex: 0 0 160px;
            background: #111827;
            border: 2px solid #e2e8f0; 
            border-radius: 8px; 
            position: relative; 
            cursor: pointer; 
            display: flex; 
            flex-direction: column;
            overflow: hidden;
            transition: all 0.2s ease;
          }
          .ecard-template-card:hover { border-color: #cbd5e1; }
          .ecard-template-card.active { border-color: #3b82f6; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15); }
          .ecard-template-card.active .check-icon { position: absolute; top: 6px; right: 6px; background: #3b82f6; color: #fff; border-radius: 50%; padding: 3px; display: flex; z-index: 2; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
          
          .ecard-template-img-box {
            width: 100%;
            aspect-ratio: 16 / 9;
            background: #1a2332;
            overflow: hidden;
          }
          .ecard-template-img-box img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          /* --- 字段樣式配置区 --- */
          .ecard-style-config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
          .ecard-style-field-block { background: #1a2332; border: 1px solid #1f2937; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
          .ecard-style-field-label { font-size: 13px; font-weight: 600; color: #f3f4f6; }
          .ecard-style-controls { display: flex; gap: 8px; }
          .ecard-style-controls select {
            flex: 1; height: 32px; border: 1px solid #374151; border-radius: 6px; background: #111827; color: #e5e7eb; font-size: 12px; outline: none; padding: 0 4px; min-width: 0; cursor: pointer;
          }

          /* --- 預覽模态框 --- */
          .ecard-template-preview-modal {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.6);
            z-index: 2147483647;
            display: flex; align-items: center; justify-content: center;
            animation: fadeIn 0.2s ease-in-out;
          }
          .ecard-template-preview-content {
            position: relative;
            background: #111827;
            border-radius: 12px;
            padding: 12px;
            max-width: 80vw;
            max-height: 85vh;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            display: flex; align-items: center; justify-content: center;
          }
          .ecard-template-preview-content img {
            max-width: 100%;
            max-height: calc(85vh - 24px);
            border-radius: 8px;
            object-fit: contain;
          }
          .ecard-template-preview-close {
            position: absolute;
            top: -16px;
            right: -16px;
            width: 32px;
            height: 32px;
            background: #111827;
            border: 1px solid #e2e8f0;
            border-radius: 50%;
            font-size: 20px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            color: #9ca3af;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
          }
          .ecard-template-preview-close:hover {
            color: #f3f4f6;
            background: #1a2332;
          }

          /* --- 右侧預覽区 --- */
          .ecard-add-right {
            flex: 0 0 52%;
            display: flex;
            flex-direction: column;
          }
          .ecard-preview-panel {
            background: #111827;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          .ecard-preview-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
          .ecard-preview-title h3 { margin: 0 0 4px 0; font-size: 16px; color: #f3f4f6; font-weight: 600; }
          .ecard-preview-tags { display: flex; gap: 8px; flex-wrap: wrap; }
          .ecard-preview-tag { background: #1a2332; border: 1px solid #374151; padding: 4px 10px; border-radius: 999px; font-size: 12px; color: #9ca3af; cursor: pointer; outline: none; transition: filter 0.2s; font-family: inherit; }
          .ecard-preview-tag:hover { filter: brightness(0.95); }
          
          .ecard-preview-container {
            flex: 1;
            background: #1a2332;
            border: 1px dashed #374151;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            overflow: hidden;
          }
          
          .ecard-preview-viewport {
            width: 100%;
            overflow: auto;
            display: flex;
            justify-content: center;
          }
          .ecard-preview-stage {
            position: relative;
            flex-shrink: 0;
          }
          .ecard-canvas {
            position: relative;
            overflow: hidden;
            transform-origin: top left;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            background: #111827;
          }
          .ecard-canvas::before {
            content: ''; position: absolute; top: -50px; right: -50px; width: 150px; height: 150px; background: rgba(220, 38, 38, 0.15); border-radius: 50%; filter: blur(40px); z-index: 0;
          }
          .ecard-canvas::after {
            content: ''; position: absolute; bottom: -50px; left: -50px; width: 200px; height: 200px; background: rgba(212, 175, 55, 0.08); border-radius: 50%; filter: blur(40px); z-index: 0;
          }

          .ecard-preview-status {
            margin-top: 20px;
            padding: 12px 16px;
            background: #1a2332;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
            color: #9ca3af;
          }
          .ecard-preview-status strong { color: #f3f4f6; }
          .ecard-add-page * { scrollbar-width: thin; scrollbar-color: #374151 transparent; }
          .ecard-add-page *::-webkit-scrollbar { width: 6px; height: 6px; }
          .ecard-add-page *::-webkit-scrollbar-track { background: transparent; }
          .ecard-add-page *::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        `}</style>
        <div className="ecard-add-header">
          <div className="ecard-add-title">
            <h2>產生 Ecard</h2>
          </div>
          <div className="ecard-add-actions">
            <button type="button" style={{ padding: '8px 16px', fontSize: '13px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', cursor: 'pointer' }} onClick={() => {
              if (isSelfService) { onSelfServiceBack?.(); return; }
              setViewMode('list');
            }}>{isSelfService ? '返回我的帳號' : '返回列表'}</button>
            {/* <button type="button" className="ghost-btn" style={{ padding: '8px 16px', fontSize: '13px' }}>儲存草稿</button> */}
            <button type="button" className="primary-btn" disabled={isGenerating} style={{ padding: '8px 16px', fontSize: '13px' }} onClick={handleSaveAndGenerateImage}>
              {isGenerating ? '產生中...' : '儲存并產生圖片'}
            </button>
          </div>
        </div>
        <div className="ecard-add-content">
          <div className="ecard-add-left">
            <div className="ecard-form-group">
              <h4 className="ecard-form-title">帳號绑定與路由</h4>
              <div className="ecard-form-grid single-column">
                <label><span>租户名稱</span><input readOnly value={selectedAccountForCreate?.tenantName || "—"} /></label>
                <label><span>SIP帳號</span><input readOnly value={selectedAccountForCreate?.sipAccount || "—"} /></label>
                <label><span>Ecard展示頁URL</span><input readOnly value={selectedAccountForCreate?.accessUrl || ecardAccessUrl} /></label>
                <label><span>Call Public Slug</span>
                  <div className="ecard-input-with-icon">
                    <input value={callPublicSlug} readOnly />
                    <button type="button" onClick={generateRandomSlug} title="重新產生"><RefreshCw size={14} /></button>
                  </div>
                </label>
                <label><span>通话 URL (用於二維碼)</span>
                  <div className="ecard-input-with-icon">
                    <input value={callUrl} readOnly />
                    <button type="button" onClick={async () => {
                      try { await navigator.clipboard.writeText(callUrl); } catch {
                        const input = document.createElement('input'); input.value = callUrl; document.body.appendChild(input); input.select(); document.execCommand('copy'); document.body.removeChild(input);
                      }
                    }} title="複製"><Copy size={14} /></button>
                  </div>
                </label>
                <label><span>名片展示與下載地址</span>
                  <div className="ecard-input-with-icon">
                    <input value={selectedAccountForCreate?.accessUrl || ecardAccessUrl} readOnly />
                    <button type="button" onClick={async () => {
                      const url = selectedAccountForCreate?.accessUrl || ecardAccessUrl;
                      try { await navigator.clipboard.writeText(url); } catch {
                        const input = document.createElement('input'); input.value = url; document.body.appendChild(input); input.select(); document.execCommand('copy'); document.body.removeChild(input);
                      }
                    }} title="複製"><Copy size={14} /></button>
                  </div>
                </label>
                <label><span>名片有效期</span><input value={selectedAccountForCreate ? `${selectedAccountForCreate.validFrom || '-'} ~ ${selectedAccountForCreate.validTo || '-'}` : "—"} readOnly /></label>
                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', cursor: 'pointer', whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
                  <input type="checkbox" checked={enableVideoCall} onChange={e => setEnableVideoCall(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: 'pointer' }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>允許視頻通話</span>
                </label>
              </div>
            </div>
            
            <div className="ecard-form-group" style={{ marginBottom: '20px' }}>
                <h4 className="ecard-form-title" style={{ margin: 0 }}>電子名片设计</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>樣式模板</span>
                  <select value={selectedTemplateId} onChange={e => handleTemplateChange(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #374151', borderRadius: '6px', fontSize: '13px', color: '#e5e7eb', outline: 'none', background: '#111827', cursor: 'pointer' }} disabled={templatesLoading || !!templatesError || templates.length === 0}>
                    {templatesLoading && <option value="">載入中...</option>}
                    {templatesError && <option value="">{templatesError}</option>}
                    {!templatesLoading && !templatesError && templates.length === 0 && <option value="">暫無可用模板</option>}
                    {!templatesLoading && !templatesError && templates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>{tpl.styleName}</option>
                    ))}
                  </select>
                  <button type="button" title="預覽" onClick={() => setPreviewModalOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: '6px', borderRadius: '4px' }} className="ecard-generation-action-btn">
                    <Eye size={16} />
                  </button>
                </div>
              <div className="ecard-media-layout" style={{ marginTop: '16px' }}>
                <label className="ecard-upload-area" style={{ overflow: 'hidden', padding: avatarDataUrl ? 0 : undefined }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setAvatarDataUrl)} />
                  {avatarDataUrl ? (
                    <img src={avatarDataUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <>
                      <UploadCloud size={24} />
                      <span>點击上傳头像</span>
                      <small>建议尺寸 512×512</small>
                    </>
                  )}
                </label>
            <div className="ecard-form-grid single-column" style={{ flex: 1 }}>
              <label><span>姓名</span><input value={cardData.name} onChange={handleCardDataChange('name')} /></label>
              <label><span>中文职位</span><input value={cardData.titleZh} onChange={handleCardDataChange('titleZh')} /></label>
              {localDisplayConfig.showEnJobTitle && <label><span>英文职位</span><input value={cardData.titleEn} onChange={handleCardDataChange('titleEn')} /></label>}
              <label><span>手机号</span><input value={cardData.phone} onChange={handleCardDataChange('phone')} /></label>
              <label><span>郵箱</span><input value={cardData.email} onChange={handleCardDataChange('email')} /></label>
              <label><span>邮编</span><input value={cardData.zipCode} onChange={handleCardDataChange('zipCode')} /></label>
              <label><span>地址</span><input value={cardData.address} onChange={handleCardDataChange('address')} /></label>
              {localDisplayConfig.showQrCodeDesc && <label><span>二維碼说明文字</span><input value={cardData.qrDesc} onChange={handleCardDataChange('qrDesc')} /></label>}
                </div>
              </div>
            </div>
            
            {showCompanyInfo && (
              <div className="ecard-form-group">
                <h4 className="ecard-form-title">公司信息</h4>
                <div className="ecard-media-layout">
                  <label className="ecard-upload-area" style={{ overflow: 'hidden', padding: logoDataUrl ? 0 : undefined }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setLogoDataUrl)} />
                    {logoDataUrl ? (
                      <img src={logoDataUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '8px', boxSizing: 'border-box' }} />
                    ) : (
                      <>
                        <UploadCloud size={24} />
                        <span>點击上傳Logo</span>
                        <small>建议尺寸 512×512</small>
                      </>
                    )}
                  </label>
                  <div className="ecard-form-grid" style={{ flex: 1 }}>
                    <label style={{ gridColumn: '1 / -1' }}><span>公司中文名稱</span><input value={cardData.companyZh} onChange={handleCardDataChange('companyZh')} /></label>
                    {localDisplayConfig.showEnCompanyName && <label style={{ gridColumn: '1 / -1' }}><span>公司英文名稱</span><input value={cardData.companyEn} onChange={handleCardDataChange('companyEn')} /></label>}
                    {localDisplayConfig.showSlogan && <label style={{ gridColumn: '1 / -1' }}><span>中文 Slogan</span><input value={cardData.sloganZh} onChange={handleCardDataChange('sloganZh')} /></label>}
                    {localDisplayConfig.showSlogan && <label style={{ gridColumn: '1 / -1' }}><span>英文 Slogan</span><input value={cardData.sloganEn} onChange={handleCardDataChange('sloganEn')} /></label>}
                  </div>
                </div>
              </div>
            )}
            
            <div className="ecard-form-group">
              <h4 className="ecard-form-title">模板與樣式</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <div className="ecard-template-section-header">
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>背景模板</span>
                    <div className="ecard-template-nav-btns">
                      <button type="button" className="ecard-template-nav-btn" onClick={() => handleScrollTemplates('left')}>‹</button>
                      <button type="button" className="ecard-template-nav-btn" onClick={() => handleScrollTemplates('right')}>›</button>
                    </div>
                  </div>
                  <div className="ecard-template-cards-wrapper">
                    <div className="ecard-template-cards" ref={templateScrollRef}>
                      {templatesLoading && <div style={{ fontSize: '13px', color: '#64748b' }}>載入中...</div>}
                      {templatesError && <div style={{ fontSize: '13px', color: '#ef4444' }}>{templatesError}</div>}
                      {!templatesLoading && !templatesError && (!selectedTemplate || !selectedTemplate.backgrounds || selectedTemplate.backgrounds.length === 0) && <div style={{ fontSize: '13px', color: '#64748b' }}>暫無背景模板</div>}
                      {!templatesLoading && !templatesError && selectedTemplate && selectedTemplate.backgrounds && selectedTemplate.backgrounds.map(bg => (
                        <div
                          key={bg.id}
                          className={`ecard-template-card ${String(selectedBackgroundId) === String(bg.id) ? 'active' : ''}`}
                          onClick={() => setSelectedBackgroundId(bg.id)}
                        >
                          {String(selectedBackgroundId) === String(bg.id) && (
                            <div className="check-icon"><Check size={12} /></div>
                          )}
                          <div className="ecard-template-img-box">
                            {bg.imageUrl ? (
                              <img src={getFullImageUrl(bg.imageUrl)} alt={bg.backgroundName || selectedTemplate.styleName} onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#94a3b8' }}>暫無背景圖片</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af', display: 'block', marginBottom: '8px' }}>顯示控制</span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => handleToggleConfig('showEnJobTitle')}>
                      <span className="ecard-static-switch" style={{ background: localDisplayConfig.showEnJobTitle ? '#2563eb' : '#cbd5e1' }}><span style={{ left: localDisplayConfig.showEnJobTitle ? '18px' : '2px', position: 'absolute', top: '2px', width: '16px', height: '16px', background: '#111827', borderRadius: '50%', transition: 'left 0.2s' }}></span></span>
                      <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>英文职位</span>
                    </div>
                    {showCompanyInfo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => handleToggleConfig('showEnCompanyName')}>
                        <span className="ecard-static-switch" style={{ background: localDisplayConfig.showEnCompanyName ? '#2563eb' : '#cbd5e1' }}><span style={{ left: localDisplayConfig.showEnCompanyName ? '18px' : '2px', position: 'absolute', top: '2px', width: '16px', height: '16px', background: '#111827', borderRadius: '50%', transition: 'left 0.2s' }}></span></span>
                        <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>英文公司名</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => handleToggleConfig('showQrCodeDesc')}>
                      <span className="ecard-static-switch" style={{ background: localDisplayConfig.showQrCodeDesc ? '#2563eb' : '#cbd5e1' }}><span style={{ left: localDisplayConfig.showQrCodeDesc ? '18px' : '2px', position: 'absolute', top: '2px', width: '16px', height: '16px', background: '#111827', borderRadius: '50%', transition: 'left 0.2s' }}></span></span>
                      <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>二維碼说明</span>
                    </div>
                    {showCompanyInfo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => handleToggleConfig('showSlogan')}>
                        <span className="ecard-static-switch" style={{ background: localDisplayConfig.showSlogan ? '#2563eb' : '#cbd5e1' }}><span style={{ left: localDisplayConfig.showSlogan ? '18px' : '2px', position: 'absolute', top: '2px', width: '16px', height: '16px', background: '#111827', borderRadius: '50%', transition: 'left 0.2s' }}></span></span>
                        <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>Slogan</span>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af', display: 'block', marginBottom: '8px' }}>颜色配置</span>
                  <div className="ecard-style-config-grid">
                    {[
                      { label: '姓名', key: 'name', defaultColor: '#ffffff', defaultWeight: '700', defaultSize: 24, show: true },
                      { label: '职位 (中/英)', key: 'title', defaultColor: '#d4af37', defaultWeight: '400', defaultSize: 13, show: true },
                      { label: '手机号', key: 'phone', defaultColor: '#cbd5e1', defaultWeight: '400', defaultSize: 12, show: true },
                      { label: '郵箱', key: 'email', defaultColor: '#cbd5e1', defaultWeight: '400', defaultSize: 12, show: true },
                      { label: '地址與邮编', key: 'address', defaultColor: '#cbd5e1', defaultWeight: '400', defaultSize: 12, show: true },
                      { label: '二維碼说明', key: 'qrCaption', defaultColor: '#94a3b8', defaultWeight: '400', defaultSize: 10, show: showQrCode && localDisplayConfig.showQrCodeDesc },
                      { label: '公司中文名稱', key: 'companyNameCn', defaultColor: '#ffffff', defaultWeight: '700', defaultSize: 14, show: showCompanyInfo },
                      { label: '公司英文名稱', key: 'companyNameEn', defaultColor: '#94a3b8', defaultWeight: '400', defaultSize: 11, show: showCompanyInfo && localDisplayConfig.showEnCompanyName },
                      { label: '中文 Slogan', key: 'sloganCn', defaultColor: '#d4af37', defaultWeight: '700', defaultSize: 12, show: showCompanyInfo && localDisplayConfig.showSlogan },
                      { label: '英文 Slogan', key: 'sloganEn', defaultColor: '#94a3b8', defaultWeight: '400', defaultSize: 10, show: showCompanyInfo && localDisplayConfig.showSlogan }
                    ].filter(f => f.show).map(field => {
                      const baseStyle = styleFields[field.key] || {};
                      const currentStyle = { ...baseStyle, ...(localStyles[field.key] || {}) };
                      
                      const currentFontRaw = currentStyle.fontFamily || 'sans-serif';
                      const currentFont = currentFontRaw.split(',')[0].replace(/['"]/g, '').trim();
                      const currentColor = currentStyle.color || field.defaultColor;
                      const currentWeight = String(currentStyle.fontWeight || field.defaultWeight);
                      const currentSizeRaw = currentStyle.fontSize;
                      const currentSize = typeof currentSizeRaw === 'number' 
                        ? currentSizeRaw 
                        : (parseInt(currentSizeRaw, 10) || field.defaultSize);
                        
                      const hexColor = /^#[0-9a-fA-F]{6}$/.test(currentColor) 
                        ? currentColor 
                        : ( /^#[0-9a-fA-F]{3}$/.test(currentColor) 
                          ? `#${currentColor[1]}${currentColor[1]}${currentColor[2]}${currentColor[2]}${currentColor[3]}${currentColor[3]}` 
                          : field.defaultColor );

                      return (
                        <div className="ecard-style-field-block" key={field.key}>
                          <div className="ecard-style-field-label">{field.label}</div>
                          <div className="ecard-style-controls">
                            <select 
                              value={currentFont} 
                              onChange={(e) => handleLocalStyleChange(field.key, 'fontFamily', e.target.value)}
                              title="字体"
                            >
                              <option value="sans-serif">預設黑体</option>
                              <option value="Microsoft YaHei">微软雅黑</option>
                              <option value="PingFang SC">苹方</option>
                              <option value="Noto Sans SC">思源黑体</option>
                              <option value="SimHei">黑体</option>
                              <option value="SimSun">宋体</option>
                              <option value="KaiTi">楷体</option>
                              <option value="serif">預設衬線</option>
                              <option value="Arial">Arial</option>
                              <option value="Helvetica">Helvetica</option>
                              <option value="Times New Roman">Times New Roman</option>
                              <option value="monospace">等宽字体</option>
                              <option value="cursive">手写体</option>
                              {![ 'sans-serif', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', 'SimHei', 'SimSun', 'KaiTi', 'serif', 'Arial', 'Helvetica', 'Times New Roman', 'monospace', 'cursive'].includes(currentFont) && (
                                <option value={currentFont}>{currentFont}</option>
                              )}
                            </select>
                            <input 
                              type="number" 
                              value={currentSize}
                              onChange={(e) => handleLocalStyleChange(field.key, 'fontSize', Number(e.target.value))}
                              title="字号 (px)"
                              style={{ width: '48px', height: '32px', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px', padding: '0 4px', outline: 'none', textAlign: 'center', background: '#111827', color: '#e5e7eb' }}
                            />
                            <select
                              value={currentWeight}
                              onChange={(e) => handleLocalStyleChange(field.key, 'fontWeight', e.target.value)}
                              title="字重"
                              style={{ width: '64px', flex: 'none', height: '32px', border: '1px solid #374151', borderRadius: '6px', background: '#111827', color: '#e5e7eb', fontSize: '12px', padding: '0 4px', outline: 'none', cursor: 'pointer' }}
                            >
                              <option value="300">细体</option>
                              <option value="400">常规</option>
                              <option value="500">中等</option>
                              <option value="600">中粗</option>
                              <option value="700">粗体</option>
                              <option value="900">黑体</option>
                              {![ '300', '400', '500', '600', '700', '900'].includes(currentWeight) && (
                                <option value={currentWeight}>{currentWeight}</option>
                              )}
                            </select>
                            <input 
                              type="color" 
                              value={hexColor} 
                              onChange={(e) => handleLocalStyleChange(field.key, 'color', e.target.value)}
                              title="颜色"
                              style={{ width: '32px', height: '32px', padding: '0', border: '1px solid #374151', borderRadius: '6px', cursor: 'pointer', flexShrink: 0 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="ecard-add-right">
            <div className="ecard-preview-panel">
              <div className="ecard-preview-head">
                <div className="ecard-preview-title">
                  <h3>实时預覽</h3>
                </div>
                <div className="ecard-preview-tags">
                  <button type="button" className="ecard-preview-tag" onClick={() => setShowQrCode(!showQrCode)}>
                    {showQrCode ? '移除二維碼' : '新增二維碼'}
                  </button>
                  <button type="button" className="ecard-preview-tag" style={{ background: '#eff6ff', color: '#2563eb', borderColor: '#bfdbfe' }} onClick={handlePreviewAndTest}>預覽&测试</button>
                </div>
              </div>
              <div className="ecard-preview-container" ref={viewportRef}>
                <div className="ecard-preview-viewport">
                  <div
                    className="ecard-preview-stage"
                    style={{
                      width: `${originalWidth * scale}px`,
                      height: `${originalHeight * scale}px`
                    }}
                  >
                    <div
                      ref={ecardCanvasRef}
                      className="ecard-canvas"
                      style={{
                        width: `${originalWidth}px`,
                        height: `${originalHeight}px`,
                        transform: `scale(${scale})`
                      }}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt="Background"
                          crossOrigin="anonymous"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
                        />
                      ) : (
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e1e1e 0%, #111 100%)', zIndex: 0 }} />
                      )}

                      {renderImageField('avatar', avatarDataUrl, cardData.name?.charAt(0) || '张')}
                      {renderTextField('name', cardData.name)}
                      {renderTextField('title', titleText)}
                      {renderShapeField('decorLine')}

                      {renderIconField('phoneIcon', 'phone')}
                      {renderTextField('phone', cardData.phone)}

                      {renderIconField('emailIcon', 'email')}
                      {renderTextField('email', cardData.email)}

                      {renderIconField('addressIcon', 'address')}
                      {renderTextField('address', addressText)}

                      {renderShapeField('qrFrame', showQrCode)}
                      {renderQrCodeField('qrCode', callUrl, showQrCode)}
                      {renderImageField('qrCenterLogo', null, null, showQrCode)}
                      {renderTextField('qrCaption', cardData.qrDesc, showQrCode && localDisplayConfig.showQrCodeDesc)}

                      {showCompanyInfo && renderImageField('companyLogo', logoDataUrl, 'LOGO')}
                      {showCompanyInfo && renderTextField('companyNameCn', cardData.companyZh)}
                      {showCompanyInfo && renderTextField('companyNameEn', cardData.companyEn, localDisplayConfig.showEnCompanyName)}
                      {showCompanyInfo && renderShapeField('companyDivider')}
                      {showCompanyInfo && renderTextField('sloganCn', cardData.sloganZh, localDisplayConfig.showSlogan)}
                      {showCompanyInfo && renderTextField('sloganEn', cardData.sloganEn, localDisplayConfig.showSlogan)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="ecard-preview-status">
                <div>圖片狀態：<strong style={{ color: selectedAccountForCreate?.ecardThumbnailUrl ? '#16a34a' : '#f59e0b' }}>
                  {selectedAccountForCreate?.ecardThumbnailUrl ? '已產生' : '未產生'}
                </strong></div>
                <div>预估尺寸：<strong>{previewSize ? `${previewSize.width} × ${previewSize.height}` : '—'}</strong></div>
              </div>
            </div>
          </div>
        </div>
        
        {previewModalOpen && createPortal(
          <div className="ecard-template-preview-modal" onClick={() => setPreviewModalOpen(false)}>
            <div className="ecard-template-preview-content" onClick={e => e.stopPropagation()}>
              <button className="ecard-template-preview-close" onClick={() => setPreviewModalOpen(false)}>×</button>
              {(() => {
                const coverUrl = selectedTemplate?.coverImageUrl;
                return selectedTemplate && coverUrl ? (
                  <img src={getFullImageUrl(coverUrl)} alt={selectedTemplate.styleName} onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <div style={{ padding: '40px', color: '#94a3b8' }}>暫無預覽图</div>
                );
              })()}
            </div>
          </div>,
          document.body
        )}

        {showTestPreviewModal && createPortal(
          <div className="ecard-template-preview-modal" onClick={() => setShowTestPreviewModal(false)}>
            <div className="ecard-template-preview-content" style={{ flexDirection: 'column', gap: '16px', padding: '24px' }} onClick={e => e.stopPropagation()}>
              <button className="ecard-template-preview-close" onClick={() => setShowTestPreviewModal(false)}>×</button>
              <img src={testPreviewImageUrl} alt="Ecard Preview & Test" style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 80px)', borderRadius: '8px', objectFit: 'contain' }} />
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>
                請扫描名片中的二維碼测试通话功能是否正常
              </div>
            </div>
          </div>,
          document.body
        )}
      </section>
    );
  }

  return (
    <section className="ecard-generation-page">
      <style>{`
        .ecard-generation-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          /* 如果外层 ConsoleLayout 已经提供了 padding，这里可以酌情减小。这里按需求設置 */
          padding: 0;
          box-sizing: border-box;
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* --- 主面板区 --- */
        .ecard-generation-panel {
          background: #111827;
          border-radius: 16px;
          border: 1px solid #1f2937;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
          overflow: hidden;
          padding: 0 24px;
        }
        .ecard-generation-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 12px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.2);
          flex-shrink: 0;
        }
        .ecard-generation-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        .ecard-generation-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        .ecard-generation-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        .ecard-generation-search input,
        .ecard-generation-select {
          height: 46px;
          border: 1px solid #1f2937;
          border-radius: 9px;
          font-size: 12px;
          outline: none;
          background: #111827;
          color: #e5e7eb;
          box-sizing: border-box;
        }
        .ecard-generation-search input { width: 100%; padding: 0 16px 0 44px; }
        .ecard-generation-search input::placeholder { color: #94a3b8; }
        .ecard-generation-search input:focus, .ecard-generation-select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        .ecard-generation-select { padding: 0 12px; min-width: 112px; cursor: pointer; flex-shrink: 0; }
        .ecard-generation-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .ecard-generation-stat-pill {
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
        .ecard-generation-stat-pill strong {
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 700;
        }

        /* --- 表格区 --- */
        .ecard-generation-table-wrap {
          flex: 1;
          overflow: auto;
        }
        .ecard-generation-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          min-width: 1000px;
          text-align: left;
        }
        .ecard-generation-table th {
          position: sticky;
          top: 0;
          background: #1a2332;
          color: #9ca3af;
          font-weight: 600;
          font-size: 13px;
          padding: 14px 20px;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
          z-index: 1;
        }
        .ecard-generation-table td {
          padding: 14px 20px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 14px;
          vertical-align: middle;
          background: #111827;
        }
        .ecard-generation-action-head, .ecard-generation-action-cell {
          position: sticky;
          right: 0;
          border-left: 1px solid #374151;
          width: 90px;
          min-width: 90px;
          padding-left: 8px !important;
          padding-right: 8px !important;
          text-align: center;
        }
        .ecard-generation-action-head {
          z-index: 3 !important;
          background: #1a2332;
        }
        .ecard-generation-action-cell {
          z-index: 1;
          background: #111827;
        }
        .ecard-generation-table tr:hover td { background: #1a2332; }
        .ecard-generation-table tr:hover .ecard-generation-action-cell { background: #1a2332; }
        
        /* 表格内部件 */
        .ecard-generation-account-cell { display: flex; align-items: center; gap: 12px; }
        .ecard-generation-account-info { display: flex; flex-direction: column; gap: 2px; }
        .ecard-generation-account-info strong { color: #f3f4f6; font-size: 14px; font-weight: 600; }
        .ecard-generation-account-info span { color: #9ca3af; font-size: 12px; }
        
        .ecard-generation-thumb-placeholder { width: 48px; height: 32px; background: #1a2332; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #94a3b8; border: 1px solid #e2e8f0; }
        .ecard-generation-thumb-empty { width: 48px; height: 32px; background: #1a2332; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #94a3b8; border: 1px dashed #cbd5e1; font-size: 11px; }
        
        .ecard-generation-validity { display: flex; flex-direction: column; font-size: 13px; color: #e5e7eb; line-height: 1.4; }
        .ecard-generation-validity span { white-space: nowrap; }
        .ecard-generation-validity span:last-child { color: #9ca3af; }
        
        .ecard-generation-status-cell { display: flex; align-items: center; gap: 8px; }
        .ecard-generation-switch { width: 36px; height: 20px; border-radius: 999px; border: none; padding: 0; position: relative; cursor: default; flex-shrink: 0; }
        .ecard-generation-switch.on { background: #2563eb; }
        .ecard-generation-switch.off { background: #cbd5e1; }
        .ecard-generation-switch .dot { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #111827; border-radius: 50%; }
        .ecard-generation-switch.on .dot { left: 18px; }
        .ecard-generation-status-text { font-size: 13px; font-weight: 500; }
        .ecard-generation-status-text.enabled { color: #16a34a; }
        .ecard-generation-status-text.disabled { color: #9ca3af; }
        
        .ecard-generation-link { display: inline-flex; align-items: center; gap: 6px; color: #2563eb; font-size: 13px; text-decoration: none; }
        
        .ecard-generation-actions { display: flex; align-items: center; gap: 4px; }
        .ecard-generation-action-btn { background: transparent; border: none; color: #3b82f6; font-size: 13px; font-weight: 500; cursor: pointer; padding: 6px 8px; border-radius: 6px; transition: 0.2s; white-space: nowrap; }
        .ecard-generation-action-btn:hover { background: #1e3a5f; }
        .ecard-generation-action-more { color: #9ca3af; padding: 6px; }
        .ecard-generation-action-more:hover { background: #1a2332; color: #f3f4f6; }

        .dropdown-menu-portal {
          position: fixed;
          background-color: #111827;
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
          color: #e5e7eb;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          cursor: pointer;
          font-weight: 400;
        }
        .dropdown-menu-portal .dropdown-item:hover {
          background-color: #1a2332;
        }

        /* --- 預覽模态框 --- */
        .ecard-template-preview-modal {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.6);
          z-index: 2147483647;
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.2s ease-in-out;
        }
        .ecard-template-preview-content {
          position: relative;
          background: #111827;
          border-radius: 12px;
          padding: 12px;
          max-width: 80vw;
          max-height: 85vh;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          display: flex; align-items: center; justify-content: center;
        }
        .ecard-template-preview-content img {
          max-width: 100%;
          max-height: calc(85vh - 24px);
          border-radius: 8px;
          object-fit: contain;
        }
        .ecard-template-preview-close {
          position: absolute;
          top: -16px;
          right: -16px;
          width: 32px;
          height: 32px;
          background: #111827;
          border: 1px solid #e2e8f0;
          border-radius: 50%;
          font-size: 20px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: #9ca3af;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
        }
        .ecard-template-preview-close:hover {
          color: #f3f4f6;
          background: #1a2332;
        }

        /* --- 分頁栏 --- */
        .ecard-generation-pagination {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #111827;
          border-top: 1px solid #e2e8f0;
        }
        .ecard-generation-total {
          color: #9ca3af;
          font-size: 12px;
        }
        .ecard-generation-page-controls { display: flex; align-items: center; gap: 12px; }
        .ecard-generation-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #1f2937;
          background: #111827;
          color: #9ca3af;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        .ecard-generation-page-btn, .ecard-generation-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #1f2937;
          background: #111827;
          color: #9ca3af;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        .ecard-generation-page-current { border-color: #3b82f6; color: #3b82f6; background: #1e3a5f; font-weight: 600; }
        .ecard-generation-page-btn { cursor: pointer; font-size: 18px; line-height: 1; }
        .ecard-generation-page-btn:disabled { color: #cbd5e1; cursor: not-allowed; background: #1a2332; }
        .ecard-generation-page-jump { display: flex; align-items: center; gap: 8px; color: #9ca3af; font-size: 11px; }
        .ecard-generation-page-input { width: 56px; height: 36px; border-radius: 8px; border: 1px solid #1f2937; background: #1a2332; text-align: center; outline: none; color: #e5e7eb; font-size: 11px; }
        
        @media (max-width: 1100px) {
          .ecard-generation-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          .ecard-generation-toolbar::-webkit-scrollbar { height: 0; }
          .ecard-generation-filter-left { flex-wrap: nowrap; }
          .ecard-generation-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          .ecard-generation-toolbar { padding: 18px; }
        }
        .ecard-generation-page .ghost-btn { background: #374151 !important; color: #d1d5db !important; border: 1px solid #4b5563 !important; border-radius: 8px; cursor: pointer; }
        .ecard-generation-page .ghost-btn:hover { background: #4b5563 !important; color: #f3f4f6 !important; }
        .ecard-generation-page * { scrollbar-width: thin; scrollbar-color: #374151 transparent; }
        .ecard-generation-page *::-webkit-scrollbar { width: 6px; height: 6px; }
        .ecard-generation-page *::-webkit-scrollbar-track { background: transparent; }
        .ecard-generation-page *::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
      `}</style>

      {/* 工具栏 */}
      <div className="ecard-generation-toolbar">
        <div className="ecard-generation-filter-left">
          <label className="ecard-generation-search">
            <Search size={18} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋 SIP 帳號 / 名稱" />
          </label>
        <select className="ecard-generation-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部狀態</option>
            <option value="enabled">已啟用</option>
            <option value="disabled">已停用</option>
            <option value="configured">已配置 Ecard</option>
            <option value="unconfigured">未配置 Ecard</option>
            <option value="valid">有效 (未過期)</option>
            <option value="expiring">即将過期</option>
            <option value="expired">已過期</option>
          </select>
        </div>
        <div className="ecard-generation-stats">
          <span className="ecard-generation-stat-pill">全部<strong>{stats.total}</strong></span>
          <span className="ecard-generation-stat-pill">已配置<strong style={{ color: '#16a34a' }}>{stats.configured}</strong></span>
          <span className="ecard-generation-stat-pill">未配置<strong style={{ color: '#64748b' }}>{stats.unconfigured}</strong></span>
          <span className="ecard-generation-stat-pill">即将過期<strong style={{ color: '#f59e0b' }}>{stats.expiring}</strong></span>
          <span className="ecard-generation-stat-pill">已過期<strong style={{ color: '#ef4444' }}>{stats.expired}</strong></span>
        </div>
      </div>

      {/* 主面板区 */}
      <div className="ecard-generation-panel">
        {/* 表格 */}
        <div className="ecard-generation-table-wrap">
          <table className="ecard-generation-table">
            <thead>
              <tr>
                <th style={{ width: '48px', textAlign: 'center', padding: '14px 10px' }}>
                  <input
                    type="checkbox"
                    checked={sortedEcardAccounts.length > 0 && sortedEcardAccounts.every(item => selectedIds.includes(item.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const newIds = new Set(selectedIds);
                        sortedEcardAccounts.forEach(item => newIds.add(item.id));
                        setSelectedIds(Array.from(newIds));
                      } else {
                        const newIds = new Set(selectedIds);
                        sortedEcardAccounts.forEach(item => newIds.delete(item.id));
                        setSelectedIds(Array.from(newIds));
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ cursor: "pointer" }} onClick={() => handleEcardListSort("sipAccount")}>SIP 帳號<EcardSortIcon col="sipAccount" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => handleEcardListSort("webAccount")}>Web 帳號<EcardSortIcon col="webAccount" /></th>
                <th>Ecard缩略图</th>
                <th style={{ width: '100px' }}>有效期</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleEcardListSort("enabled")}>狀態<EcardSortIcon col="enabled" /></th>
                <th>下載連結</th>
                <th>访问連結</th>
                <th style={{ width: '80px', whiteSpace: 'nowrap' }}>產生人</th>
                <th style={{ width: '100px', whiteSpace: 'nowrap' }}>產生日期</th>
                <th className="ecard-generation-action-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingAccounts ? (
                <tr><td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>正在載入名片數據...</td></tr>
              ) : sortedEcardAccounts.length === 0 ? (
                <tr><td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>暫無啟用的 SIP 帳號數據</td></tr>
              ) : sortedEcardAccounts.map(item => (
                <tr key={item.id}>
                  <td style={{ width: '48px', textAlign: 'center', padding: '12px 10px' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(prev => [...prev, item.id]);
                        } else {
                          setSelectedIds(prev => prev.filter(id => id !== item.id));
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    <div className="ecard-generation-account-cell" style={{ gap: '12px' }}>
                      <div className="ecard-generation-account-info">
                        <strong>{item.userName}</strong>
                        <span>{item.sipAccount}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="ecard-generation-account-info">
                      {item.webAccount ? (
                        <>
                          <strong>{item.userName}</strong>
                          <span>{item.webAccount}</span>
                        </>
                      ) : <span style={{ color: '#94a3b8' }}>-</span>}
                    </div>
                  </td>
                  <td>
                    {item.configured ? (
                      <img src={getFullImageUrl(item.ecardThumbnailUrl || item.avatarUrl)} alt="缩略图" className="ecard-generation-thumb-placeholder" style={{ objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="ecard-generation-thumb-empty">未配置</div>
                    )}
                  </td>
                  <td>
                    {item.validFrom ? (
                      <div className="ecard-generation-validity">
                        <span>{item.validFrom} ~</span>
                        <span>{item.validTo}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td>
                    <div className="ecard-generation-status-cell">
                      <button type="button" className={`ecard-generation-switch ${item.enabled ? 'on' : 'off'}`} tabIndex={-1}>
                        <span className="dot"></span>
                      </button>
                    </div>
                  </td>
                  <td>
                    {item.configured ? (
                      <a href={item.downloadUrl || `https://ecard.qrtalkie.org/d/${item.sipAccount}`} className="ecard-generation-link" target="_blank" rel="noreferrer" onClick={async (e) => {
                        e.preventDefault();
                        const url = item.downloadUrl || `https://ecard.qrtalkie.org/d/${item.sipAccount}`;
                        try {
                          await navigator.clipboard.writeText(url);
                        } catch {
                          const input = document.createElement('input'); input.value = url; document.body.appendChild(input); input.select(); document.execCommand('copy'); document.body.removeChild(input);
                        }
                        alert('下載連結已成功複製到剪贴板！');
                      }}>
                        {item.downloadUrl || `https://ecard.qrtalkie.org/d/${item.sipAccount}`} <Copy size={12} />
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td>
                    {item.accessUrl ? (
                      <a href={item.accessUrl} className="ecard-generation-link" target="_blank" rel="noreferrer" onClick={async (e) => {
                        e.preventDefault();
                        try {
                          await navigator.clipboard.writeText(item.accessUrl);
                          alert('访问連結已成功複製到剪贴板！');
                        } catch (err) {
                          alert('複製失败，請手动选中并複製。');
                        }
                      }}>
                        {item.accessUrl} <Copy size={12} />
                      </a>
                    ) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.createdBy || '—'}</td>
                  <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{item.createdAt || '—'}</td>
                  <td className="ecard-generation-action-cell">
                    <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button 
                        className="ghost-btn" 
                        type="button" 
                        style={{ fontSize: '12px', padding: '4px 6px', ...(!item.configured || !item.ecardThumbnailUrl ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} 
                        onClick={() => handlePreviewEcard(item)}
                      >
                        預覽
                      </button>
                      <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 6px' }} onClick={(e) => {
                        e.stopPropagation();
                        dropdownAnchorRef.current = e.currentTarget;
                        setOpenDropdownId(current => current === item.id ? null : item.id);
                      }}>更多</button>
                      {openDropdownId === item.id && createPortal(
                        <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                          <button type="button" className="dropdown-item" onClick={() => handleOpenEditor(item)}>
                            {item.configured ? '編輯' : '創建'}
                          </button>
                          <button type="button" className="dropdown-item" disabled={!item.configured || !(item.ecardImageUrl || item.ecardThumbnailUrl || item.thumbnailDataUrl)} onClick={(e) => handleDownloadEcardImage(item, e)}>下載</button>
                          <button type="button" className="dropdown-item" onClick={() => handleToggleStatus(item)}>{item.enabled ? '停用' : '啟用'}</button>
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

        {/* 分頁栏 */}
        <div className="ecard-generation-pagination">
          <div className="ecard-generation-total">共 {totalItems} 條</div>
          <div className="ecard-generation-page-controls">
            <select 
              value={pageSize} 
              onChange={(e) => {
                const val = e.target.value;
                setPageSize(val === 'all' ? 'all' : Number(val));
                setCurrentPage(1);
              }}
              style={{ height: '38px', padding: '0 32px 0 14px', borderRadius: '8px', border: '1px solid #d8e2ef', background: '#111827', color: '#9ca3af', fontSize: '11px', outline: 'none', cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', backgroundSize: '14px 14px' }}
            >
              <option value={10}>10 條/頁</option>
              <option value={20}>20 條/頁</option>
              <option value={50}>50 條/頁</option>
              <option value={100}>100 條/頁</option>
              <option value="all">全部</option>
            </select>
            <button type="button" className="ecard-generation-page-btn" disabled={safeCurrentPage <= 1} onClick={() => setCurrentPage(p => Math.max(1, Number(p) - 1))}>‹</button>
            <span className="ecard-generation-page-current">{safeCurrentPage}</span>
            <button type="button" className="ecard-generation-page-btn" disabled={safeCurrentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, Number(p) + 1))}>›</button>
            <span className="ecard-generation-page-jump">前往<input className="ecard-generation-page-input" value={currentPage} onChange={(e) => setCurrentPage(e.target.value)} onBlur={(e) => {
              let val = Number(e.target.value);
              if (isNaN(val) || val < 1) val = 1;
              if (val > totalPages) val = totalPages;
              setCurrentPage(val);
            }} />頁</span>
          </div>
        </div>
        
        {previewImageModalOpen && createPortal(
          <div className="ecard-template-preview-modal" onClick={() => setPreviewImageModalOpen(false)}>
            <div className="ecard-template-preview-content" style={{ flexDirection: 'column', gap: '16px', padding: '24px' }} onClick={e => e.stopPropagation()}>
              <button className="ecard-template-preview-close" onClick={() => setPreviewImageModalOpen(false)}>×</button>
              <img src={previewImageUrl} alt="Ecard Preview" style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 80px)', borderRadius: '8px', objectFit: 'contain' }} />
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>
                請扫描名片中的二維碼测试通话功能是否正常
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </section>
  );
});

export default EcardGeneration;