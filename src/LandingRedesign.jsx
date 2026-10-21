import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Landing from '../Landing';
import apiClient from './apiClient';
import './landing-redesign.css';

const slides = [
  { img: '/assets/landing/001.jpg', subtitle: '私有化部署・專屬即時通訊解決方案', lines: ['專屬私有部署', '解鎖無限可能'] },
  { img: '/assets/landing/002.jpg', subtitle: 'QRTalkie 全終端融合通訊平台', lines: ['打破設備邊界', '全終端一體互聯'] },
  { img: '/assets/landing/003.jpg', subtitle: 'QRTalkie 專屬電子名片', lines: ['掃碼即通', '訪客交流安全便捷'] },
  { img: '/assets/landing/004.jpg', subtitle: 'QRTalkie 全終端融合通訊平台', lines: ['打破設備邊界', '全終端一體互聯'] },
  { img: '/assets/landing/005.jpg', subtitle: '企業專屬 AI 助手', lines: ['靈活定制', '私有化部署的超級智囊'] },
  { img: '/assets/landing/006.jpg', subtitle: 'QRTalkie 7×24h 智能語音客服', lines: ['開頁即講', '全天候智能語音應答'] },
];

const features = [
  { title: '私有部署', desc: '資料主權自掌', icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></> },
  { title: '融合通讯', desc: '跨平台多設備全面支持', icon: <><rect x="2" y="2" width="6" height="6" /><rect x="16" y="2" width="6" height="6" /><rect x="9" y="16" width="6" height="6" /><line x1="5" y1="8" x2="5" y2="16" /><line x1="19" y1="8" x2="19" y2="16" /><line x1="5" y1="16" x2="12" y2="16" /><line x1="19" y1="16" x2="12" y2="16" /></> },
  { title: '电子名片', desc: '跨界互聯·安全無憂', icon: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><path d="M3 14h7v7H3z" /></> },
  { title: '设备远控', desc: '遠距設備智能操控', icon: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></> },
  { title: 'AI助手', desc: '高效生產力引擎', icon: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></> },
  { title: '客服中心', desc: '24hr客服 訂單不漏接', icon: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /> },
];

const contentSlides = [
  {
    title: '内部即时通讯', img: '/assets/landing/im-01.jpg', logo: ['QRTalkie', 'Secure Messaging'],
    points: [
      { title: '全消息类型', desc: '支持文本消息、动态表情、图片、语音、视频、附件、文件等 IM 功能；' },
      { title: '强大的消息管理', desc: '一键实现消息引用、撤回、删除、编辑、转发、阅后即焚等管理操作，支持表情回复、输入状态、已读回执等社交化功能。' },
      { title: '多端多设备消息同步', desc: '支持多端多设备同时登录并保持在线状态，无缝切换设备。' },
      { title: '离线消息推送', desc: '深度整合 APNs、Google FCM、华为、荣耀、小米、OPPO、vivo、魅族等各大厂商消息推送通道，保障推送送达率及稳定性。' },
    ],
  },
  {
    title: '高清视频会议', img: '/assets/landing/conference01.jpg', logo: ['QRTalkie', 'Video Conference'],
    points: [
      { title: '灵活配置', desc: '公有、私有、混合云灵活部署，第三方 Web Meet 轻松接入。' },
      { title: '简单便捷', desc: '打通通讯录与聊天室，一键便捷发起视频会议。' },
      { title: '超清流畅传输', desc: '超清视频，高保真语音，智能丢包视觉补偿。' },
      { title: '功能丰富多样', desc: '会议功能一应俱全，满足多样的应用需求。' },
    ],
  },
  {
    title: '远距设备管理', img: '/assets/landing/device01.jpg', logo: ['QRTalkie', 'IoT Control'],
    points: [
      { title: '统一接入', desc: '门禁、门锁、传感器等终端统一接入，设备台账与分组清晰可见。' },
      { title: '实时监控', desc: '在线状态、运行数据与异常情况实时同步，设备状况一目了然。' },
      { title: '可视化远程协助', desc: '通过实时视频呼叫查看设备现场，远程完成可视化操控与协助处理，无需人员到场。' },
      { title: '安全可溯', desc: '设备接入认证、权限隔离与操作日志完整记录，每次操作有据可查。' },
    ],
  },
  {
    title: '外部访客交流', img: '/assets/landing/ecard01.jpg', logo: ['QRTalkie', 'Visitor Access'],
    points: [
      { title: '名片配置', desc: '账号所有者设置头像、姓名、职务、公司与联系方式，保存后生成专属电子名片。' },
      { title: '名片即码', desc: '每张名片自动生成专属二维码与访问链接，可直接分享给好友与合作伙伴。' },
      { title: '扫码即联', desc: '对方扫码或打开链接，无需下载 App，即可进入名片页直接发起交流。' },
      { title: '多元沟通', desc: '支持文字、语音、视频与留言，随时与名片主人保持联系。' },
      { title: '消息管理', desc: '支持消息删除、撤回、归档与分享，重要内容可随时整理与转出。' },
    ],
  },
  {
    title: '可定制化AI助手', img: '/assets/landing/AI01.jpg', logo: ['QRTalkie', 'AI Assistant'],
    points: [
      { title: '专属知识库构建', desc: '灵活构建企业专属知识库，支持文档导入与分类管理，持续沉淀专属知识系统。' },
      { title: '角色定制', desc: '自定义助手角色、提示词与回答风格，适配客服、销售与内部支持场景。' },
      { title: '智能语音', desc: '支持语音问答与 7×24 智能语音应答，服务与办公随时在线。' },
      { title: '灵活接入', desc: '支持多种大模型灵活接入，按场景选择模型与能力，兼顾效果与成本。' },
      { title: '多端随行', desc: '桌面、手机与 Web 随时调用，问答、检索与办公处理一个入口完成。' },
    ],
  },
  {
    title: '呼叫转接&合并', img: '/assets/landing/call01.jpg', logo: ['QRTalkie', 'Call Management'],
    points: [
      { title: '一键转接', desc: '通话中一键转接给同事、部门或坐席，客户无需重复描述问题。' },
      { title: '多方合并', desc: '支持两路或多路通话合并为多方会议，随时邀请相关人员加入。' },
      { title: '通话控制', desc: '支持保持、恢复、静音与切换，沟通节奏灵活可控。' },
      { title: '录音留痕', desc: '支持通话录音，转接、合并与通话结果全程记录，便于复盘与服务质量追溯。' },
    ],
  },
  {
    title: '高可靠信息安全保障', img: '/assets/landing/security01.jpg', logo: ['QRTalkie', 'Bank-Grade Security'],
    points: [
      { title: '多重鉴权', desc: '账号、设备与接口多层鉴权，权限分级控制，防止未授权访问。' },
      { title: '全链路加密', desc: '传输加密与存储加密结合，消息、通话与文件在传输和落盘时均受保护。' },
      { title: '数据隔离', desc: '租户、账号与业务数据隔离，支持私有化部署，数据主权自主掌控。' },
      { title: '点对点加密', desc: '支持点对点加密通讯，敏感会话在两端之间安全传递。' },
      { title: '可控销毁', desc: '支持定制化阅后即焚与一键清空聊天记录，敏感信息按需清除。' },
    ],
  },
];

const solutions = [
  { title: '私有化即时通讯', img: '/assets/landing/001.jpg', tone: 'blue', desc: '部署在企业自有环境，消息、文件与通话全程加密，多端同步，数据主权自主掌控。' },
  { title: 'SaaS公共服务', img: '/assets/landing/002.jpg', tone: 'violet', desc: '云端开箱即用，账号、消息与通话集中管理，按需开通，快速构建对外沟通服务。' },
  { title: '云端呼叫中心', img: '/assets/landing/call01.jpg', tone: 'dark', desc: '灵活设置服务分类与坐席，轻松嵌入已有网站；支持音视频即时沟通与在线文字交流，转接、合并及录音留痕统一管理。' },
  { title: '智能门禁管理', img: '/assets/landing/004.jpg', tone: 'violet', desc: '门禁、门锁与摄像头统一接入；访客扫码即可发起音视频呼叫，联系人核验后按授权一键解锁，通行记录实时可查。' },
  { title: '远距设备操控', img: '/assets/landing/device01.jpg', tone: 'dark', desc: '物联网设备自主组网，运行状态实时可见；可灵活配置控制指令与操控权限，并支持视频呼叫与可视化远程协助，异常情况远程处置。' },
  { title: '敏捷政务服务', img: '/assets/landing/003.jpg', tone: 'blue', desc: '打破跨组织、跨部门沟通鸿沟，政务窗口与社区协同更顺畅；借助呼叫转接与呼叫合并，一次通话解决全部问题，安全合规、办理高效。' },
];

const conceptFeatures = [
  { no: '01', title: '私有部署', desc: '数据留在企业自有环境，安全、合规与数据主权自主掌控。' },
  { no: '02', title: '融合通信', desc: '手机、桌面与 Web 消息同步，高清语音视频随时接入。' },
  { no: '03', title: '安全加密', desc: '消息、通话与文件全程加密，敏感信息不出企业。' },
  { no: '04', title: '电子名片', desc: '一张可定制的数字名片，扫码即可联系与分享。' },
  { no: '05', title: '呼叫中心', desc: '坐席、在线交流、留言与呼叫转接/合并统一管理，咨询不漏接。' },
  { no: '06', title: '设备管理', desc: '门禁、门锁等终端统一接入，远程控制与运行状态实时可见。' },
  { no: '07', title: 'AI 助手', desc: '企业私有知识问答与 7×24 智能语音应答，服务办公双提效。' },
  { no: '08', title: '云管理平台', desc: '账号、订单、通话与运营数据集中管理，经营状态一目了然。' },
];

const conceptMobileFeatures = [
  { no: '01', title: '私有部署', desc: '数据主权自主掌控。' },
  { no: '02', title: '融合通信', desc: '多端同步，语音视频随时接入。' },
  { no: '03', title: '安全加密', desc: '消息与通话全程加密。' },
  { no: '04', title: '电子名片', desc: '扫码即联，随时分享。' },
  { no: '05', title: '呼叫中心', desc: '坐席、转接与留言统一管理。' },
  { no: '06', title: '设备管理', desc: '终端统一接入，远程可控。' },
  { no: '07', title: 'AI 助手', desc: '私有知识问答与智能语音应答。' },
  { no: '08', title: '云管理平台', desc: '账号、订单与运营一屏掌握。' },
];

const FOOTER_DEFAULTS = {
  brandTitle: 'QRTalkie',
  brandSubtitleEn: 'Secure Instant Messaging & IoT App',
  brandSubtitleZh: '安全即时通讯与物联网应用',
  address: '台中市西區五權西四街57號3樓',
  email: 'qtalkie@gmail.com',
  desktopDownloadUrl: '',
  androidDownloadUrl: '',
  iosDownloadUrl: '',
  desktopVersion: '',
  androidVersion: '',
  iosVersion: '',
  copyright: '© 2026 QRTalkie. All Rights Reserved.',
  privacyUrl: '#',
};

function absoluteDownloadUrl(url) {
  const text = String(url || '');
  if (!text) return '';
  return text.startsWith('/') ? `${window.location.origin}${text}` : text;
}

function useLandingViewport() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'QRTalkie - Secure Instant Messaging & IoT App';
    document.documentElement.classList.add('qrt-landing-active');
    return () => {
      document.title = previousTitle;
      document.documentElement.classList.remove('qrt-landing-active');
      document.body.classList.remove('qrt-modal-open');
    };
  }, []);
}

export default function LandingRedesign() {
  useLandingViewport();
  const initialAuth = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('verifyEmailToken') || params.get('resetPasswordToken'));
  }, []);
  const [slideIndex, setSlideIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [contentIndex, setContentIndex] = useState(0);
  const [contentPaused, setContentPaused] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [authOpen, setAuthOpen] = useState(initialAuth);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [enterError, setEnterError] = useState('');
  const [entered, setEntered] = useState(false);
  const [legalViewer, setLegalViewer] = useState({ open: false, title: '', content: '', loading: false });
  const [trialNotice, setTrialNotice] = useState('');
  const trialNoticeTimer = useRef(null);
  const [footerSettings, setFooterSettings] = useState(FOOTER_DEFAULTS);
  const [qrModal, setQrModal] = useState(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [ecardDemoOpen, setEcardDemoOpen] = useState(false);

  useEffect(() => {
    if (!demoOpen && !ecardDemoOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (ecardDemoOpen) setEcardDemoOpen(false);
      else setDemoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoOpen, ecardDemoOpen]);

  useEffect(() => {
    if (carouselPaused) return undefined;
    const timer = window.setInterval(() => {
      setSlideIndex((index) => (index + 1) % slides.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [carouselPaused]);

  useEffect(() => {
    if (contentPaused) return undefined;
    const timer = window.setInterval(() => {
      setContentIndex((index) => (index + 1) % contentSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [contentPaused]);

  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 300);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('qrt-modal-open', authOpen);
    return () => document.body.classList.remove('qrt-modal-open');
  }, [authOpen]);

  useEffect(() => () => {
    if (trialNoticeTimer.current) window.clearTimeout(trialNoticeTimer.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/public/settings/homepage-footer')
      .then((data) => {
        if (!cancelled && data?.settings) {
          setFooterSettings({ ...FOOTER_DEFAULTS, ...data.settings });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const showTrialNotice = (message) => {
    setTrialNotice(message);
    if (trialNoticeTimer.current) window.clearTimeout(trialNoticeTimer.current);
    trialNoticeTimer.current = window.setTimeout(() => setTrialNotice(''), 6000);
  };

  const openAuth = (event) => {
    event?.preventDefault();
    setAuthOpen(true);
    setAuthSuccess(false);
    setEnterError('');
    setEntered(false);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setAuthSuccess(false);
    setEnterError('');
    setEntered(false);
    setTrialNotice('');
    if (trialNoticeTimer.current) {
      window.clearTimeout(trialNoticeTimer.current);
      trialNoticeTimer.current = null;
    }
  };

  const handleAuthSuccess = () => {
    setAuthSuccess(true);
    setEnterError('');
  };

  const openQrModal = (platform, version, url) => {
    if (!url) return;
    setQrModal({ platform, version: version || '', url });
  };

  const closeQrModal = () => setQrModal(null);

  const openLegal = async (type) => {
    const title = type === 'privacy' ? '隱私權政策' : '會員服務條款';
    const endpoint = type === 'privacy' ? '/public/settings/privacy-policy' : '/public/settings/terms-of-service';
    setLegalViewer({ open: true, title, content: '', loading: true });
    try {
      const data = await apiClient.get(endpoint);
      setLegalViewer({ open: true, title, content: data?.content || '暫無內容，請聯絡管理員。', loading: false });
    } catch {
      setLegalViewer({ open: true, title, content: '內容載入失敗，請稍後再試。', loading: false });
    }
  };

  const handleEnterPlatform = () => {
    try {
      const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
      const userType = localStorage.getItem('qrtalkieUserType') || sessionStorage.getItem('qrtalkieUserType');
      if (!token) {
        setEnterError('登入狀態已失效，請重新登入。');
        return;
      }
      localStorage.setItem('qrtalkieHandoffToken', token);
      localStorage.setItem('qrtalkieHandoffExpiresAt', String(Date.now() + 5 * 60 * 1000));
      if (userType) localStorage.setItem('qrtalkieHandoffUserType', userType);
      else localStorage.removeItem('qrtalkieHandoffUserType');
      setEntered(true);
      setEnterError('');
    } catch {
      setEnterError('無法保存登入狀態，請重試。');
    }
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="qrt-landing" id="qrt-top">
      <div className="qrt-marketing">
      <header className="qrt-site-header">
        <div className="qrt-logo-area">
          <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie Logo" className="qrt-logo-img" />
        </div>
        <nav>
          <ul>
            <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>首页</a></li>
            <li><a href="#design-philosophy">产品介绍</a></li>
            <li><a href="#scenarios">解决方案</a></li>
            <li><a href="#footer">资源下载</a></li>
            <li><a href="#" onClick={openAuth}>云管理平台</a></li>
          </ul>
        </nav>
      </header>

      <main>
        <section
          className="qrt-banner-carousel"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
        >
          {slides.map((slide, index) => (
            <div key={slide.img} className={`qrt-carousel-slide${index === slideIndex ? ' active' : ''}`}>
              <img src={slide.img} alt={`Banner ${index + 1}`} />
              <div className="qrt-banner-content">
                <p className="qrt-banner-subtitle">{slide.subtitle}</p>
                {slide.lines.map((line) => <h1 key={line} className="qrt-banner-title">{line}</h1>)}
              </div>
            </div>
          ))}
          <button type="button" className="qrt-carousel-btn qrt-prev-btn" onClick={() => setSlideIndex((i) => (i - 1 + slides.length) % slides.length)}>&#10094;</button>
          <button type="button" className="qrt-carousel-btn qrt-next-btn" onClick={() => setSlideIndex((i) => (i + 1) % slides.length)}>&#10095;</button>
        </section>

        <div
          className="qrt-feature-nav-bar"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
        >
          {features.map((feature, index) => (
            <button
              key={feature.title}
              type="button"
              className={`qrt-feature-item${index === slideIndex ? ' active' : ''}`}
              onClick={() => setSlideIndex(index)}
            >
              <svg className="qrt-feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{feature.icon}</svg>
              <span className="qrt-feature-title">{feature.title}</span>
              <span className="qrt-feature-desc">{feature.desc}</span>
            </button>
          ))}
        </div>

        <section className="qrt-brand-concept" id="design-philosophy">
          <h2 className="qrt-section-title">设计理念</h2>
          <p className="qrt-section-subtitle">Design Philosophy</p>
          <div className="qrt-concept-visual qrt-concept-desktop" style={{ backgroundImage: "url('/assets/landing/why05.jpg')" }}>
            <div className="qrt-concept-grid">
              {conceptFeatures.map((item) => (
                <div className="qrt-concept-item" key={item.no}>
                  <div className="qrt-concept-copy">
                    <span className="qrt-concept-number">{item.no}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="qrt-concept-visual qrt-concept-mobile" style={{ backgroundImage: "url('/assets/landing/why07.jpg')" }}>
            <div className="qrt-concept-grid">
              {conceptMobileFeatures.map((item) => (
                <div className="qrt-concept-item" key={item.no}>
                  <div className="qrt-concept-copy">
                    <span className="qrt-concept-number">{item.no}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="qrt-integrated-block">
          <div className="qrt-container">
            <div className="qrt-block-header">
              <h2>All IN One</h2>
              <p>一個平台，满足各类沟通协作需求</p>
              <div className="qrt-block-divider"></div>
            </div>
            <div
              className="qrt-block-tags"
              onMouseEnter={() => setContentPaused(true)}
              onMouseLeave={() => setContentPaused(false)}
            >
              {contentSlides.map((slide, index) => (
                <button
                  key={slide.title}
                  type="button"
                  className={`qrt-tag-item${index === contentIndex ? ' active' : ''}`}
                  onClick={() => setContentIndex(index)}
                >
                  <h3>{slide.title}</h3>
                </button>
              ))}
            </div>
            <div
              className="qrt-content-viewport"
              onMouseEnter={() => setContentPaused(true)}
              onMouseLeave={() => setContentPaused(false)}
            >
              <div className="qrt-content-track" style={{ transform: `translateX(-${contentIndex * 100}%)` }}>
                {contentSlides.map((slide) => (
                  <div className="qrt-content-slide" key={slide.title}>
                    <div className="qrt-content-image">
                      <img src={slide.img} alt={slide.title} />
                      <div className="qrt-slide-title">{slide.title}</div>
                      <div className="qrt-slide-logo">{slide.logo[0]}<br />{slide.logo[1]}</div>
                    </div>
                    <div className="qrt-content-text">
                      <h4>{slide.title}</h4>
                      {slide.points ? (
                        <div className="qrt-im-points">
                          {slide.points.map((point) => (
                            <div className="qrt-im-point" key={point.title}>
                              <h5>{point.title}</h5>
                              <p>{point.desc}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        slide.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="qrt-scenarios-block" id="scenarios">
          <div className="qrt-container">
            <div className="qrt-scenarios-header">
              <h2 className="qrt-section-title">丰富应用场景</h2>
              <p className="qrt-section-subtitle">Rich Application Scenarios</p>
            </div>
            <div className="qrt-solutions-grid">
              {solutions.map((solution) => (
                <article key={solution.title} className={`qrt-solution-card tone-${solution.tone}`}>
                  <div className="qrt-solution-head">
                    <h3>{solution.title}</h3>
                    <img src={solution.img} alt="" loading="lazy" />
                  </div>
                  <p className="qrt-solution-desc">{solution.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="qrt-site-footer" id="footer" style={{ backgroundImage: "url('/assets/landing/foot03.jpg')" }}>
        <div className="qrt-container qrt-footer-content">
          <div className="qrt-footer-col qrt-brand-info">
            <h3>{footerSettings.brandTitle}</h3>
            <p>{footerSettings.brandSubtitleEn}</p>
            <p>{footerSettings.brandSubtitleZh}</p>
          </div>
          <div className="qrt-footer-col qrt-quick-links">
            <h4>快速链接</h4>
            <ul>
              <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>首页</a></li>
              <li><a href="#design-philosophy">产品介绍</a></li>
              <li><a href="#scenarios">解决方案</a></li>
              <li><a href="#footer">资源下载</a></li>
              <li><a href="#" onClick={openAuth}>云管理平台</a></li>
            </ul>
          </div>
          <div className="qrt-footer-col qrt-contact-info">
            <h4>联系我们</h4>
            <p>地址：{footerSettings.address || '-'}</p>
            <p>✉️ 邮箱：{footerSettings.email ? <a href={`mailto:${footerSettings.email}`}>{footerSettings.email}</a> : '-'}</p>
          </div>
          <div className="qrt-footer-col qrt-download-col">
            <h4>资源下载</h4>
            <div className="qrt-download-item">
              <a
                href={footerSettings.desktopDownloadUrl || '#'}
                className="qrt-desktop-download"
                onClick={(e) => { if (!footerSettings.desktopDownloadUrl) e.preventDefault(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                <span className="qrt-dl-text"><span className="qrt-dl-title">桌面版 (Windows)</span><span className="qrt-dl-sub">{footerSettings.desktopVersion ? `v${footerSettings.desktopVersion} · 点击下载` : '点击下载'}</span></span>
              </a>
            </div>
            <div className="qrt-download-item">
              <a
                className="qrt-qr-download-item"
                href={footerSettings.androidDownloadUrl || '#'}
                target={footerSettings.androidDownloadUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openQrModal('Android', footerSettings.androidVersion, footerSettings.androidDownloadUrl); }}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <div className="qrt-qr-mini">
                  {footerSettings.androidDownloadUrl ? (
                    <QRCodeSVG value={absoluteDownloadUrl(footerSettings.androidDownloadUrl)} size={60} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  ) : (
                    <div className="qrt-qr-placeholder-mini"></div>
                  )}
                </div>
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">Android</span><span className="qrt-scan-tip">{footerSettings.androidDownloadUrl ? '点击获取Android二维码' : '暂无可用二维码'}</span></div>
              </a>
            </div>
            <div className="qrt-download-item">
              <a
                className="qrt-qr-download-item"
                href={footerSettings.iosDownloadUrl || '#'}
                target={footerSettings.iosDownloadUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openQrModal('iOS', footerSettings.iosVersion, footerSettings.iosDownloadUrl); }}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <div className="qrt-qr-mini">
                  {footerSettings.iosDownloadUrl ? (
                    <QRCodeSVG value={absoluteDownloadUrl(footerSettings.iosDownloadUrl)} size={60} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  ) : (
                    <div className="qrt-qr-placeholder-mini"></div>
                  )}
                </div>
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">iOS</span><span className="qrt-scan-tip">{footerSettings.iosDownloadUrl ? '点击获取iOS二维码' : '暂无可用二维码'}</span></div>
              </a>
            </div>
          </div>
        </div>
        <div className="qrt-footer-bottom">
          <div className="qrt-container">
            <p>{footerSettings.copyright} | <a href={footerSettings.privacyUrl || '#'} onClick={(e) => { if (!footerSettings.privacyUrl || footerSettings.privacyUrl === '#') e.preventDefault(); }}>隐私政策</a></p>
          </div>
        </div>
      </footer>

      <button
        type="button"
        className={`qrt-demo-launcher${demoOpen ? ' hidden' : ''}`}
        aria-label="在线演示"
        aria-expanded={demoOpen}
        onClick={() => setDemoOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
          <path d="M10.5 7.5v5l4-2.5-4-2.5z" fill="currentColor" stroke="none" />
        </svg>
        <span>演示</span>
      </button>

      {demoOpen && <div className="qrt-demo-backdrop" onClick={() => setDemoOpen(false)}></div>}
      <aside className={`qrt-demo-drawer${demoOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="在线显示" aria-hidden={!demoOpen}>
        <div className="qrt-demo-head">
          <span className="qrt-online-dot"></span>
          <h3>在线显示</h3>
          <button type="button" className="qrt-demo-close" onClick={() => setDemoOpen(false)} aria-label="关闭">×</button>
        </div>
        <div className="qrt-demo-list">
          <button type="button" className="qrt-demo-item" onClick={() => { setDemoOpen(false); setEcardDemoOpen(true); }}><i>📇</i><span>电子名片</span><em>›</em></button>
          <button type="button" className="qrt-demo-item"><i>🤖</i><span>AI客服</span><em>›</em></button>
          <button type="button" className="qrt-demo-item"><i>📞</i><span>呼叫中心</span><em>›</em></button>
          <button type="button" className="qrt-demo-item"><i>🏢</i><span>楼宇管理</span><em>›</em></button>
        </div>
        <p className="qrt-demo-hint">选择要体验的在线演示</p>
      </aside>

      {ecardDemoOpen && (
        <div
          className="qrt-ecard-demo-modal"
          role="dialog"
          aria-modal="true"
          aria-label="电子名片在线演示"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEcardDemoOpen(false); }}
        >
          <button type="button" className="qrt-ecard-demo-close" aria-label="关闭" onClick={() => setEcardDemoOpen(false)}>×</button>
          <figure className="qrt-ecard-demo-figure">
            <img src="/assets/landing/ecard-demo01.png" alt="电子名片演示" />
            <figcaption>扫描图中二维码，体验电子名片</figcaption>
          </figure>
        </div>
      )}
      <button type="button" id="qrt-back-to-top" className={`qrt-back-to-top-btn${showBackTop ? ' show' : ''}`} aria-label="回到顶部" onClick={scrollTop}>↑</button>
      </div>

      {authOpen && (
        <div className="qrt-auth-modal" role="dialog" aria-modal="true" aria-label="云管理平台登录" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAuth(); }}>
          <div className="qrt-auth-dialog">
            <div className="qrt-auth-left">
              <img src="/assets/landing/login02.jpg" alt="QRTalkie Cloud" />
              <div className="qrt-auth-left-text">
                <span className="qrt-auth-left-kicker">歡迎使用</span>
                <strong>QRTalkie雲管理平台</strong>
              </div>
            </div>
            <div className="qrt-auth-right">
              <button type="button" className="qrt-auth-close" onClick={closeAuth} aria-label="關閉">×</button>
              <div className="qrt-auth-brand">
                <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie" />
              </div>
              {authSuccess ? (
                <div className="qrt-auth-success">
                  <h2>登入成功</h2>
                  <p>管理平台將在新分頁開啟，官網會保留在目前分頁。</p>
                  <a
                    className="qrt-enter-platform"
                    href="/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleEnterPlatform}
                  >
                    進入管理平台
                  </a>
                  {entered && <p className="qrt-auth-hint">已在新分頁開啟管理平台。</p>}
                  {enterError && <p className="qrt-auth-error">{enterError}</p>}
                  <p className="qrt-auth-legal-note">
                    確認登錄表明您已閱讀並同意
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('terms')}>《會員服務條款》</button>
                    和
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('privacy')}>《隱私權政策》</button>
                  </p>
                  <button type="button" className="qrt-auth-secondary" onClick={closeAuth}>留在官網</button>
                </div>
              ) : (
                <Landing embedded onLogin={handleAuthSuccess} onTrialUnavailable={showTrialNotice} />
              )}
            </div>
            {trialNotice && <div className="qrt-auth-notice" role="status">{trialNotice}</div>}
          </div>
        </div>
      )}

      {legalViewer.open && (
        <div
          className="qrt-legal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={legalViewer.title}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setLegalViewer((v) => ({ ...v, open: false })); }}
        >
          <div className="qrt-legal-dialog">
            <div className="qrt-legal-header">
              <h2>{legalViewer.title}</h2>
              <button type="button" className="qrt-legal-close" aria-label="關閉" onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>×</button>
            </div>
            <div className="qrt-legal-body">
              {legalViewer.loading ? (
                <p className="qrt-legal-loading">內容載入中...</p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalViewer.content || ''}</ReactMarkdown>
              )}
            </div>
            <div className="qrt-legal-footer">
              <button type="button" className="qrt-legal-confirm" onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>我知道了</button>
            </div>
          </div>
        </div>
      )}

      {qrModal && (
        <div
          className="qrt-qr-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${qrModal.platform} 安裝二維碼`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeQrModal(); }}
        >
          <div className="qrt-qr-dialog">
            <button type="button" className="qrt-qr-close" onClick={closeQrModal} aria-label="關閉">×</button>
            <h3>{qrModal.platform} 安裝二維碼</h3>
            {qrModal.version && <p className="qrt-qr-version">版本 v{qrModal.version}</p>}
            <div className="qrt-qr-large">
              <QRCodeSVG value={absoluteDownloadUrl(qrModal.url)} size={300} bgColor="#ffffff" fgColor="#0f172a" level="M" />
            </div>
            <p className="qrt-qr-scan-tip">
              扫码安装
              {qrModal.platform === 'Android' && (
                <>
                  或
                  <a
                    className="qrt-qr-download-link"
                    href={absoluteDownloadUrl(qrModal.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    点击下载
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
