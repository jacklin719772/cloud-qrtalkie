import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Landing from '../Landing';
import apiClient from './apiClient';
import { useVisitorChat } from './pages/ecard/useVisitorChat';
import { chatApi } from './pages/ecard/ecardChatApi';
import { LandingI18nProvider, useLandingI18n } from './landing/i18n/LandingI18n.jsx';
import LandingLanguageSwitch from './landing/LandingLanguageSwitch.jsx';
import './landing-redesign.css';

const ECardChatPanel = React.lazy(() => import('./pages/ecard/ECardChatPanel'));

const getSlides = (t) => [
  { img: '/assets/landing/001.jpg', subtitle: t('私有化部署・专属即时通讯解决方案'), lines: [t('专属私有部署'), t('解锁无限可能')] },
  { img: '/assets/landing/002.jpg', subtitle: t('QRTalkie 全终端融合通讯平台'), lines: [t('打破设备边界'), t('全终端一体互联')] },
  { img: '/assets/landing/003.jpg', subtitle: t('QRTalkie 专属电子名片'), lines: [t('扫码即通'), t('访客交流安全便捷')] },
  { img: '/assets/landing/004.jpg', subtitle: t('QRTalkie 全终端融合通讯平台'), lines: [t('打破设备边界'), t('全终端一体互联')] },
  { img: '/assets/landing/005.jpg', subtitle: t('企业专属 AI 助手'), lines: [t('灵活定制'), t('私有化部署的超级智囊')] },
  { img: '/assets/landing/006.jpg', subtitle: t('QRTalkie 7×24h 智能语音客服'), lines: [t('开页即讲'), t('全天候智能语音应答')] },
];

const getFeatures = (t) => [
  { title: t('私有部署'), desc: t('数据主权自掌'), icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></> },
  { title: t('融合通讯'), desc: t('跨平台多设备全面支持'), icon: <><rect x="2" y="2" width="6" height="6" /><rect x="16" y="2" width="6" height="6" /><rect x="9" y="16" width="6" height="6" /><line x1="5" y1="8" x2="5" y2="16" /><line x1="19" y1="8" x2="19" y2="16" /><line x1="5" y1="16" x2="12" y2="16" /><line x1="19" y1="16" x2="12" y2="16" /></> },
  { title: t('电子名片'), desc: t('跨界互联·安全无忧'), icon: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><path d="M3 14h7v7H3z" /></> },
  { title: t('设备远控'), desc: t('远距设备智能操控'), icon: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></> },
  { title: t('AI助手'), desc: t('高效生产力引擎'), icon: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></> },
  { title: t('客服中心'), desc: t('24hr客服 订单不漏接'), icon: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /> },
];

const getContentSlides = (t) => [
  {
    title: t('内部即时通讯'), img: '/assets/landing/im-01.jpg', logo: ['QRTalkie', 'Secure Messaging'],
    points: [
      { title: t('全消息类型'), desc: t('支持文本消息、动态表情、图片、语音、视频、附件、文件等 IM 功能；') },
      { title: t('强大的消息管理'), desc: t('一键实现消息引用、撤回、删除、编辑、转发、阅后即焚等管理操作，支持表情回复、输入状态、已读回执等社交化功能。') },
      { title: t('多端多设备消息同步'), desc: t('支持多端多设备同时登录并保持在线状态，无缝切换设备。') },
      { title: t('离线消息推送'), desc: t('深度整合 APNs、Google FCM、华为、荣耀、小米、OPPO、vivo、魅族等各大厂商消息推送通道，保障推送送达率及稳定性。') },
    ],
  },
  {
    title: t('高清视频会议'), img: '/assets/landing/conference01.jpg', logo: ['QRTalkie', 'Video Conference'],
    points: [
      { title: t('灵活配置'), desc: t('公有、私有、混合云灵活部署，第三方 Web Meet 轻松接入。') },
      { title: t('简单便捷'), desc: t('打通通讯录与聊天室，一键便捷发起视频会议。') },
      { title: t('超清流畅传输'), desc: t('超清视频，高保真语音，智能丢包视觉补偿。') },
      { title: t('功能丰富多样'), desc: t('会议功能一应俱全，满足多样的应用需求。') },
    ],
  },
  {
    title: t('远距设备管理'), img: '/assets/landing/device01.jpg', logo: ['QRTalkie', 'IoT Control'],
    points: [
      { title: t('统一接入'), desc: t('门禁、门锁、传感器等终端统一接入，设备台账与分组清晰可见。') },
      { title: t('实时监控'), desc: t('在线状态、运行数据与异常情况实时同步，设备状况一目了然。') },
      { title: t('可视化远程协助'), desc: t('通过实时视频呼叫查看设备现场，远程完成可视化操控与协助处理，无需人员到场。') },
      { title: t('安全可溯'), desc: t('设备接入认证、权限隔离与操作日志完整记录，每次操作有据可查。') },
    ],
  },
  {
    title: t('外部访客交流'), img: '/assets/landing/ecard01.jpg', logo: ['QRTalkie', 'Visitor Access'],
    points: [
      { title: t('名片配置'), desc: t('账号所有者设置头像、姓名、职务、公司与联系方式，保存后生成专属电子名片。') },
      { title: t('名片即码'), desc: t('每张名片自动生成专属二维码与访问链接，可直接分享给好友与合作伙伴。') },
      { title: t('扫码即联'), desc: t('对方扫码或打开链接，无需下载 App，即可进入名片页直接发起交流。') },
      { title: t('多元沟通'), desc: t('支持文字、语音、视频与留言，随时与名片主人保持联系。') },
      { title: t('消息管理'), desc: t('支持消息删除、撤回、归档与分享，重要内容可随时整理与转出。') },
    ],
  },
  {
    title: t('可定制化AI助手'), img: '/assets/landing/AI01.jpg', logo: ['QRTalkie', 'AI Assistant'],
    points: [
      { title: t('专属知识库构建'), desc: t('灵活构建企业专属知识库，支持文档导入与分类管理，持续沉淀专属知识系统。') },
      { title: t('角色定制'), desc: t('自定义助手角色、提示词与回答风格，适配客服、销售与内部支持场景。') },
      { title: t('智能语音'), desc: t('支持语音问答与 7×24 智能语音应答，服务与办公随时在线。') },
      { title: t('灵活接入'), desc: t('支持多种大模型灵活接入，按场景选择模型与能力，兼顾效果与成本。') },
      { title: t('多端随行'), desc: t('桌面、手机与 Web 随时调用，问答、检索与办公处理一个入口完成。') },
    ],
  },
  {
    title: t('呼叫转接&合并'), img: '/assets/landing/call01.jpg', logo: ['QRTalkie', 'Call Management'],
    points: [
      { title: t('一键转接'), desc: t('通话中一键转接给同事、部门或坐席，客户无需重复描述问题。') },
      { title: t('多方合并'), desc: t('支持两路或多路通话合并为多方会议，随时邀请相关人员加入。') },
      { title: t('通话控制'), desc: t('支持保持、恢复、静音与切换，沟通节奏灵活可控。') },
      { title: t('录音留痕'), desc: t('支持通话录音，转接、合并与通话结果全程记录，便于复盘与服务质量追溯。') },
    ],
  },
  {
    title: t('高可靠信息安全保障'), img: '/assets/landing/security01.jpg', logo: ['QRTalkie', 'Bank-Grade Security'],
    points: [
      { title: t('多重鉴权'), desc: t('账号、设备与接口多层鉴权，权限分级控制，防止未授权访问。') },
      { title: t('全链路加密'), desc: t('传输加密与存储加密结合，消息、通话与文件在传输和落盘时均受保护。') },
      { title: t('数据隔离'), desc: t('租户、账号与业务数据隔离，支持私有化部署，数据主权自主掌控。') },
      { title: t('点对点加密'), desc: t('支持点对点加密通讯，敏感会话在两端之间安全传递。') },
      { title: t('可控销毁'), desc: t('支持定制化阅后即焚与一键清空聊天记录，敏感信息按需清除。') },
    ],
  },
];

const getSolutions = (t) => [
  { title: t('私有化即时通讯'), img: '/assets/landing/001.jpg', tone: 'blue', desc: t('部署在企业自有环境，消息、文件与通话全程加密，多端同步，数据主权自主掌控。') },
  { title: t('SaaS公共服务'), img: '/assets/landing/002.jpg', tone: 'violet', desc: t('云端开箱即用，账号、消息与通话集中管理，按需开通，快速构建对外沟通服务。') },
  { title: t('云端呼叫中心'), img: '/assets/landing/call01.jpg', tone: 'dark', desc: t('灵活设置服务分类与坐席，轻松嵌入已有网站；支持音视频即时沟通与在线文字交流，转接、合并及录音留痕统一管理。') },
  { title: t('智能门禁管理'), img: '/assets/landing/004.jpg', tone: 'violet', desc: t('门禁、门锁与摄像头统一接入；访客扫码即可发起音视频呼叫，联系人核验后按授权一键解锁，通行记录实时可查。') },
  { title: t('远距设备操控'), img: '/assets/landing/device01.jpg', tone: 'dark', desc: t('物联网设备自主组网，运行状态实时可见；可灵活配置控制指令与操控权限，并支持视频呼叫与可视化远程协助，异常情况远程处置。') },
  { title: t('敏捷政务服务'), img: '/assets/landing/003.jpg', tone: 'blue', desc: t('打破跨组织、跨部门沟通鸿沟，政务窗口与社区协同更顺畅；借助呼叫转接与呼叫合并，一次通话解决全部问题，安全合规、办理高效。') },
];

const getConceptFeatures = (t) => [
  { no: '01', title: t('私有部署'), desc: t('数据留在企业自有环境，安全、合规与数据主权自主掌控。') },
  { no: '02', title: t('融合通信'), desc: t('手机、桌面与 Web 消息同步，高清语音视频随时接入。') },
  { no: '03', title: t('安全加密'), desc: t('消息、通话与文件全程加密，敏感信息不出企业。') },
  { no: '04', title: t('电子名片'), desc: t('一张可定制的数字名片，扫码即可联系与分享。') },
  { no: '05', title: t('呼叫中心'), desc: t('坐席、在线交流、留言与呼叫转接/合并统一管理，咨询不漏接。') },
  { no: '06', title: t('设备管理'), desc: t('门禁、门锁等终端统一接入，远程控制与运行状态实时可见。') },
  { no: '07', title: t('AI 助手'), desc: t('企业私有知识问答与 7×24 智能语音应答，服务办公双提效。') },
  { no: '08', title: t('云管理平台'), desc: t('账号、订单、通话与运营数据集中管理，经营状态一目了然。') },
];

const getConceptMobileFeatures = (t) => [
  { no: '01', title: t('私有部署'), desc: t('数据主权自主掌控。') },
  { no: '02', title: t('融合通信'), desc: t('多端同步，语音视频随时接入。') },
  { no: '03', title: t('安全加密'), desc: t('消息与通话全程加密。') },
  { no: '04', title: t('电子名片'), desc: t('扫码即联，随时分享。') },
  { no: '05', title: t('呼叫中心'), desc: t('坐席、转接与留言统一管理。') },
  { no: '06', title: t('设备管理'), desc: t('终端统一接入，远程可控。') },
  { no: '07', title: t('AI 助手'), desc: t('私有知识问答与智能语音应答。') },
  { no: '08', title: t('云管理平台'), desc: t('账号、订单与运营一屏掌握。') },
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

const DEMO_ENTRY_CONFIG = {
  callcenter: { title: '呼叫中心演示', img: '/assets/landing/callcenter-demo01.jpg' },
  building: { title: '楼宇管理演示', img: '/assets/landing/building-demo01.jpg' },
};

const AI_DEMO_WELCOME = '您好，我是 QRTalkie AI 客服，可以为您介绍私有化部署、呼叫中心、电子名片、设备管理等方案。请问想了解什么？';
const AI_DEMO_QUICK_QUESTIONS = [
  'QRTalkie 能解决什么问题？',
  '支持私有化部署吗？',
  '呼叫中心怎么接入？',
];

const AI_DEMO_LIMIT_SECONDS = 180;
function formatDemoSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const SERVICE_STATUS_FALLBACK = {
  configured: false,
  sip: { state: 'unknown', label: 'SIP 未知', account: '' },
  web: { state: 'unconfigured', label: '未配置', account: '' },
};

function normalizeServiceStatus(data) {
  if (!data) return SERVICE_STATUS_FALLBACK;
  return {
    configured: Boolean(data.configured),
    sip: data.sip || SERVICE_STATUS_FALLBACK.sip,
    web: data.web || SERVICE_STATUS_FALLBACK.web,
  };
}

let jsSipPromise = null;
async function loadJsSip() {
  if (!jsSipPromise) {
    jsSipPromise = import('jssip').then((mod) => mod.default || mod);
  }
  return jsSipPromise;
}

function injectServiceSdpPatch(uaInstance, serverIp, originalSendRef) {
  if (!uaInstance?.transport || !serverIp || originalSendRef.current) return;
  originalSendRef.current = uaInstance.transport.send;
  uaInstance.transport.send = function patchedSend(...args) {
    if (args[0]?.body) {
      let body = args[0].body;
      if (body.includes('127.0.0.1') || body.includes('0.0.0.0')) {
        body = body
          .replace(/IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, `IN IP4 ${serverIp}`)
          .replace(/c=IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, `c=IN IP4 ${serverIp}`);
        args[0].body = body;
      }
    }
    return originalSendRef.current.apply(this, args);
  };
}

function applyServiceCodecPreferences(pc) {
  if (!pc || !window.RTCRtpSender?.getCapabilities) return;
  const audioTransceiver = pc.getTransceivers().find((item) => item.sender?.track?.kind === 'audio' || item.receiver?.track?.kind === 'audio');
  if (!audioTransceiver) return;
  try {
    const caps = window.RTCRtpSender.getCapabilities('audio');
    const pcmu = caps?.codecs?.find((codec) => String(codec.mimeType).toLowerCase() === 'audio/pcmu');
    const dtmf = caps?.codecs?.find((codec) => String(codec.mimeType).toLowerCase().includes('telephone-event'));
    if (pcmu && dtmf) audioTransceiver.setCodecPreferences([pcmu, dtmf]);
  } catch {}
}

function bindServiceRemoteAudio(pc, elementId = 'serviceRemoteAudio') {
  if (!pc) return;
  try {
    const receiver = pc.getReceivers().find((item) => item.track && item.track.kind === 'audio');
    if (!receiver?.track) return;
    const audioEl = document.getElementById(elementId);
    if (!audioEl) return;
    audioEl.srcObject = new MediaStream([receiver.track]);
    audioEl.play().catch(() => {});
  } catch {}
}

function tuneServiceVideoSender(pc, intervalRef) {
  if (!pc) return;
  try {
    const sender = pc.getSenders().find((item) => item.track && item.track.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings.forEach((encoding) => {
      encoding.maxBitrate = 300000;
      encoding.maxFramerate = 15;
    });
    sender.setParameters(params).catch(() => {});
    if (intervalRef.current) clearInterval(intervalRef.current);
    let alternate = false;
    intervalRef.current = setInterval(async () => {
      try {
        alternate = !alternate;
        const next = sender.getParameters();
        if (!next.encodings || next.encodings.length === 0) next.encodings = [{}];
        next.encodings.forEach((encoding) => {
          encoding.scaleResolutionDownBy = alternate ? 1.25 : 1;
          encoding.maxBitrate = 300000;
          encoding.maxFramerate = 15;
        });
        await sender.setParameters(next);
      } catch {}
    }, 2000);
  } catch {}
}

const SERVICE_CALL_DEFAULT = { open: false, video: false, status: '', muted: false, cameraOn: true };

const AI_ATTACHMENT_MAX = 3;
const AI_ATTACHMENT_MAX_TOTAL = 15 * 1024 * 1024;
const AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AI_DOC_EXTS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.xml'];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败'));
    image.src = dataUrl;
  });
}

async function compressAiImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function useLandingViewport() {
  useEffect(() => {
    document.documentElement.classList.add('qrt-landing-active');
    return () => {
      document.documentElement.classList.remove('qrt-landing-active');
      document.body.classList.remove('qrt-modal-open');
    };
  }, []);
}

export default function LandingRedesign() {
  return (
    <LandingI18nProvider>
      <LandingRedesignContent />
    </LandingI18nProvider>
  );
}

function LandingRedesignContent() {
  const { t } = useLandingI18n();
  const slides = useMemo(() => getSlides(t), [t]);
  const features = useMemo(() => getFeatures(t), [t]);
  const contentSlides = useMemo(() => getContentSlides(t), [t]);
  const solutions = useMemo(() => getSolutions(t), [t]);
  const conceptFeatures = useMemo(() => getConceptFeatures(t), [t]);
  const conceptMobileFeatures = useMemo(() => getConceptMobileFeatures(t), [t]);
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
  const [demoLinks, setDemoLinks] = useState({ callcenter: '', building: '' });
  const [qrModal, setQrModal] = useState(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [ecardDemoOpen, setEcardDemoOpen] = useState(false);
  const [demoEntry, setDemoEntry] = useState(null);
  const [aiDemoOpen, setAiDemoOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [aiSending, setAiSending] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNotice, setAiNotice] = useState('');
  const [aiAttachments, setAiAttachments] = useState([]);
  const [aiVoiceConfig, setAiVoiceConfig] = useState({ available: false, reason: t('正在读取配置…') });
  const [aiCall, setAiCall] = useState({ open: false, status: '', muted: false });
  const [aiDemoSecondsLeft, setAiDemoSecondsLeft] = useState(AI_DEMO_LIMIT_SECONDS);
  const [aiCallSecondsLeft, setAiCallSecondsLeft] = useState(AI_DEMO_LIMIT_SECONDS);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceNotice, setServiceNotice] = useState('');
  const [serviceProfile, setServiceProfile] = useState(null);
  const [serviceStatus, setServiceStatus] = useState(SERVICE_STATUS_FALLBACK);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false);
  const [serviceWebState, setServiceWebState] = useState('idle');
  const [serviceWebAccount, setServiceWebAccount] = useState('');
  const [serviceWebRetry, setServiceWebRetry] = useState(0);
  const [serviceCall, setServiceCall] = useState(SERVICE_CALL_DEFAULT);
  const serviceUaRef = useRef(null);
  const serviceCallSessionRef = useRef(null);
  const serviceCurrentCallRef = useRef(null);
  const serviceLocalStreamRef = useRef(null);
  const serviceRemoteVideoRef = useRef(null);
  const serviceLocalVideoRef = useRef(null);
  const serviceKeyframeKickRef = useRef(null);
  const serviceOriginalSendRef = useRef(null);
  const serviceCallBusyRef = useRef(false);
  const serviceRegNameRef = useRef(null);
  const serviceChat = useVisitorChat(serviceProfile?.ecardSlug || '');
  const [serviceRegForm, setServiceRegForm] = useState({ name: '', email: '', phone: '', subject: '' });
  const [serviceRegistering, setServiceRegistering] = useState(false);
  const [serviceWebMeetLoading, setServiceWebMeetLoading] = useState(false);
  const [serviceEcardData, setServiceEcardData] = useState(null);
  const aiErrorTimer = useRef(null);
  const aiNoticeTimer = useRef(null);
  const serviceNoticeTimer = useRef(null);
  const aiListRef = useRef(null);
  const aiFileInputRef = useRef(null);
  const aiUaRef = useRef(null);
  const aiCurrentCallRef = useRef(null);
  const aiLocalStreamRef = useRef(null);
  const aiOriginalSendRef = useRef(null);
  const aiCallBusyRef = useRef(false);
  const aiCallTimerRef = useRef(null);
  const aiEndingRef = useRef(false);

  useEffect(() => {
    if (!demoOpen && !ecardDemoOpen && !demoEntry && !aiDemoOpen && !serviceOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (serviceOpen) setServiceOpen(false);
      else if (demoEntry) setDemoEntry(null);
      else if (aiDemoOpen) setAiDemoOpen(false);
      else if (ecardDemoOpen) setEcardDemoOpen(false);
      else setDemoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoOpen, ecardDemoOpen, demoEntry, aiDemoOpen, serviceOpen]);

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
    if (aiErrorTimer.current) window.clearTimeout(aiErrorTimer.current);
    if (aiNoticeTimer.current) window.clearTimeout(aiNoticeTimer.current);
    if (serviceNoticeTimer.current) window.clearTimeout(serviceNoticeTimer.current);
    cleanupAiVoiceResources();
  }, []);

  useEffect(() => {
    if (!aiDemoOpen) return undefined;
    let cancelled = false;
    setAiVoiceConfig({ available: false, reason: t('正在检查 AI 语音配置…') });
    apiClient.get('/public/settings/homepage-ai-voice')
      .then((data) => {
        if (cancelled) return;
        const settings = data?.settings || {};
        setAiVoiceConfig({
          available: Boolean(settings.available),
          reason: settings.reason || (settings.available ? '' : t('AI 语音问答未配置')),
        });
      })
      .catch(() => {
        if (!cancelled) setAiVoiceConfig({ available: false, reason: t('无法读取 AI 语音配置') });
      });
    return () => { cancelled = true; };
  }, [aiDemoOpen]);

  useEffect(() => {
    if (aiDemoOpen) return undefined;
    cleanupAiVoiceResources();
    return undefined;
  }, [aiDemoOpen]);

  useEffect(() => {
    if (!aiDemoOpen) {
      setAiDemoSecondsLeft(AI_DEMO_LIMIT_SECONDS);
      return undefined;
    }
    if (aiCall.open || aiDemoSecondsLeft <= 0) return undefined;
    const timer = window.setInterval(() => {
      setAiDemoSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiDemoOpen, aiCall.open, aiDemoSecondsLeft <= 0]);

  useEffect(() => {
    if (!aiDemoOpen || aiCall.open || aiDemoSecondsLeft > 0) return undefined;
    showAiNotice(t('演示时间已到（3 分钟），窗口将自动关闭。'));
    const timer = window.setTimeout(() => setAiDemoOpen(false), 1500);
    return () => window.clearTimeout(timer);
  }, [aiDemoOpen, aiCall.open, aiDemoSecondsLeft]);

  useEffect(() => {
    if (!aiCall.open) {
      setAiCallSecondsLeft(AI_DEMO_LIMIT_SECONDS);
      return undefined;
    }
    setAiCallSecondsLeft(AI_DEMO_LIMIT_SECONDS);
    const timer = window.setInterval(() => {
      setAiCallSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiCall.open]);

  useEffect(() => {
    if (!aiCall.open || aiCallSecondsLeft > 0) return undefined;
    endAiVoiceCall(t('演示通话已满 3 分钟，已自动挂断。'));
    return undefined;
  }, [aiCall.open, aiCallSecondsLeft]);

  useEffect(() => {
    const list = aiListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [aiMessages, aiSending, aiDemoOpen]);

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get('/public/settings/homepage-callcenter').catch(() => null),
      apiClient.get('/public/settings/homepage-building').catch(() => null),
      apiClient.get('/public/settings/homepage-livechat').catch(() => null),
    ]).then(([callCenter, building, livechat]) => {
      if (cancelled) return;
      setDemoLinks({
        callcenter: callCenter?.settings?.url || '',
        building: building?.settings?.url || '',
      });
      setServiceProfile(livechat?.settings?.account || null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!serviceOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      setServiceStatusLoading(true);
      try {
        const data = await apiClient.get('/public/livechat/status');
        if (!cancelled && data) setServiceStatus(normalizeServiceStatus(data));
      } catch {
      } finally {
        if (!cancelled) setServiceStatusLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serviceOpen]);

  useEffect(() => {
    if (!serviceOpen || !serviceProfile?.ecardSlug) return undefined;
    let cancelled = false;
    setServiceWebState('registering');
    const start = async () => {
      try {
        const res = await apiClient.post(`/ecard/public/${serviceProfile.ecardSlug}/call-session`);
        if (!res?.success) throw new Error(res?.message || t('Web 账号注册失败'));
        const data = res.data || {};
        if (!data.webAccount || !data.credential?.value || !data.wssUrl || !data.webrtcDomain) {
          throw new Error(t('呼叫配置不完整'));
        }
        if (cancelled) return;
        setServiceWebAccount(String(data.webAccount));
        serviceCallSessionRef.current = data;
        const JsSIP = await loadJsSip();
        if (cancelled) return;
        const socket = new JsSIP.WebSocketInterface(data.wssUrl);
        const ua = new JsSIP.UA({
          sockets: [socket],
          uri: `sip:${data.webAccount}@${data.webrtcDomain}`,
          password: data.credential.value,
          register: true,
        });
        serviceUaRef.current = ua;
        let registrationFailed = false;
        ua.on('registered', () => {
          if (!cancelled) setServiceWebState('registered');
          injectServiceSdpPatch(ua, data.sipServerPublicIp, serviceOriginalSendRef);
        });
        ua.on('unregistered', () => {
          if (!cancelled && !registrationFailed) setServiceWebState('idle');
        });
        ua.on('registrationFailed', () => {
          registrationFailed = true;
          if (!cancelled) setServiceWebState('failed');
          try { ua.stop(); } catch {}
        });
        ua.on('disconnected', () => {
          registrationFailed = true;
          if (!cancelled) setServiceWebState('failed');
          try { ua.stop(); } catch {}
        });
        ua.start();
      } catch {
        if (!cancelled) setServiceWebState('failed');
      }
    };
    start();
    return () => {
      cancelled = true;
      cleanupServiceCallResources();
      setServiceCall(SERVICE_CALL_DEFAULT);
      serviceCallSessionRef.current = null;
      serviceOriginalSendRef.current = null;
      const ua = serviceUaRef.current;
      serviceUaRef.current = null;
      if (ua) {
        try { ua.stop(); } catch {}
      }
    };
  }, [serviceOpen, serviceProfile?.ecardSlug, serviceWebRetry]);

  useEffect(() => {
    if (!serviceCall.open || !serviceCall.video) return;
    if (serviceLocalVideoRef.current && serviceLocalStreamRef.current) {
      serviceLocalVideoRef.current.srcObject = serviceLocalStreamRef.current;
    }
  }, [serviceCall.open, serviceCall.video]);

  useEffect(() => {
    if (serviceOpen) return;
    cleanupServiceCallResources();
    setServiceCall(SERVICE_CALL_DEFAULT);
  }, [serviceOpen]);

  useEffect(() => {
    const slug = serviceProfile?.ecardSlug;
    if (!slug) {
      setServiceEcardData(null);
      return undefined;
    }
    let cancelled = false;
    apiClient.get(`/ecard/public/${slug}`)
      .then((data) => {
        if (!cancelled && data?.success) setServiceEcardData(data.data || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [serviceProfile?.ecardSlug]);

  useEffect(() => {
    const stored = serviceChat.storedContact;
    if (!stored) return;
    setServiceRegForm((prev) => ({
      name: prev.name || stored.name || '',
      email: prev.email || stored.email || '',
      phone: prev.phone || stored.phone || '',
      subject: prev.subject || stored.subject || '',
    }));
  }, [serviceChat.storedContact]);

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
    const title = type === 'privacy' ? t('隐私权政策') : t('会员服务条款');
    const endpoint = type === 'privacy' ? '/public/settings/privacy-policy' : '/public/settings/terms-of-service';
    setLegalViewer({ open: true, title, content: '', loading: true });
    try {
      const data = await apiClient.get(endpoint);
      setLegalViewer({ open: true, title, content: data?.content || t('暂无内容，请联系管理员。'), loading: false });
    } catch {
      setLegalViewer({ open: true, title, content: t('内容加载失败，请稍后再试。'), loading: false });
    }
  };

  const handleEnterPlatform = () => {
    try {
      const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
      const userType = localStorage.getItem('qrtalkieUserType') || sessionStorage.getItem('qrtalkieUserType');
      if (!token) {
        setEnterError(t('登录状态已失效，请重新登录。'));
        return;
      }
      localStorage.setItem('qrtalkieHandoffToken', token);
      localStorage.setItem('qrtalkieHandoffExpiresAt', String(Date.now() + 5 * 60 * 1000));
      if (userType) localStorage.setItem('qrtalkieHandoffUserType', userType);
      else localStorage.removeItem('qrtalkieHandoffUserType');
      setEntered(true);
      setEnterError('');
    } catch {
      setEnterError(t('无法保存登录状态，请重试。'));
    }
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const openDemoLink = (key) => {
    setDemoOpen(false);
    setDemoEntry(key);
  };

  const demoEntryConfig = demoEntry ? DEMO_ENTRY_CONFIG[demoEntry] : null;
  const demoEntryUrl = demoEntry ? String(demoLinks[demoEntry] || '').trim() : '';
  const demoEntryAbsoluteUrl = demoEntryUrl ? absoluteDownloadUrl(demoEntryUrl) : '';

  const showAiError = (text) => {
    setAiError(text);
    if (aiErrorTimer.current) window.clearTimeout(aiErrorTimer.current);
    aiErrorTimer.current = window.setTimeout(() => setAiError(''), 4000);
  };

  const showAiNotice = (text) => {
    setAiNotice(text);
    if (aiNoticeTimer.current) window.clearTimeout(aiNoticeTimer.current);
    aiNoticeTimer.current = window.setTimeout(() => setAiNotice(''), 4000);
  };

  const openAiDemo = () => {
    setDemoOpen(false);
    setAiDemoOpen(true);
    setAiMessages([{ role: 'assistant', content: t(AI_DEMO_WELCOME) }]);
    setAiInput('');
    setAiAttachments([]);
    setAiError('');
    setAiNotice('');
    setAiSending(false);
    setAiDemoSecondsLeft(AI_DEMO_LIMIT_SECONDS);
    setAiCallSecondsLeft(AI_DEMO_LIMIT_SECONDS);
  };

  const removeAiAttachment = (id) => {
    setAiAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAiFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    const next = [...aiAttachments];
    for (const file of files) {
      if (next.length >= AI_ATTACHMENT_MAX) {
        showAiError(t('最多上传 {count} 个附件。', { count: AI_ATTACHMENT_MAX }));
        break;
      }
      const isImage = AI_IMAGE_TYPES.includes(file.type);
      const ext = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
      const isDoc = AI_DOC_EXTS.includes(ext);
      if (!isImage && !isDoc) {
        showAiError(t('不支持的文件类型：{name}', { name: file.name }));
        continue;
      }
      if (isImage && file.size > 8 * 1024 * 1024) {
        showAiError(t('图片不能超过 8MB。'));
        continue;
      }
      if (!isImage && file.size > 10 * 1024 * 1024) {
        showAiError(t('文件不能超过 10MB。'));
        continue;
      }
      const currentTotal = next.reduce((sum, item) => sum + (item.size || 0), 0);
      if (currentTotal + file.size > AI_ATTACHMENT_MAX_TOTAL) {
        showAiError(t('附件总大小不能超过 15MB。'));
        break;
      }
      try {
        if (isImage) {
          const dataUrl = await compressAiImage(file);
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'image',
            name: file.name,
            mimeType: 'image/jpeg',
            dataUrl,
            size: file.size,
          });
        } else {
          const dataUrl = await readFileAsDataUrl(file);
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'file',
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: String(dataUrl).split(',')[1] || '',
            size: file.size,
          });
        }
      } catch (err) {
        showAiError(err.message || t('读取 {name} 失败。', { name: file.name }));
      }
    }
    setAiAttachments(next);
  };

  const sendAiMessage = async (text) => {
    const content = String(text !== undefined ? text : aiInput).trim();
    if ((!content && aiAttachments.length === 0) || aiSending) return;
    const attachments = aiAttachments.map((item) => (item.kind === 'image'
      ? { id: item.id, kind: 'image', name: item.name, mimeType: item.mimeType, dataUrl: item.dataUrl }
      : { id: item.id, kind: 'file', name: item.name, mimeType: item.mimeType, dataBase64: item.dataBase64 }));
    const userMessage = { role: 'user', content: content || t('请分析我上传的附件。'), attachments };
    const nextMessages = [...aiMessages, userMessage];
    setAiMessages(nextMessages);
    setAiInput('');
    setAiAttachments([]);
    setAiSending(true);
    setAiError('');
    try {
      const payloadMessages = nextMessages.slice(-10).map((message, index, array) => (
        index === array.length - 1
          ? message
          : { role: message.role, content: message.content }
      ));
      const data = await apiClient.post(
        '/public/demo/ai-chat',
        { messages: payloadMessages },
        { timeoutMs: 60000 },
      );
      const reply = String(data?.reply || '').trim();
      if (!reply) throw new Error(t('AI 客服未返回内容，请稍后再试。'));
      setAiMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      showAiError(err.message || t('AI 客服暂时无法回复，请稍后再试。'));
    } finally {
      setAiSending(false);
    }
  };

  const showServiceNotice = (text) => {
    setServiceNotice(text);
    if (serviceNoticeTimer.current) window.clearTimeout(serviceNoticeTimer.current);
    serviceNoticeTimer.current = window.setTimeout(() => setServiceNotice(''), 4000);
  };

  const openServiceDemo = () => {
    setDemoOpen(false);
    setServiceOpen(true);
    setServiceNotice('');
    setServiceStatus(SERVICE_STATUS_FALLBACK);
    setServiceWebState('idle');
    setServiceWebAccount('');
    setServiceWebRetry(0);
  };

  const refreshServiceStatus = async () => {
    setServiceStatusLoading(true);
    try {
      const data = await apiClient.get('/public/livechat/status');
      if (data) setServiceStatus(normalizeServiceStatus(data));
    } catch {
    } finally {
      setServiceStatusLoading(false);
    }
  };

  function cleanupServiceCallResources() {
    if (serviceKeyframeKickRef.current) {
      window.clearInterval(serviceKeyframeKickRef.current);
      serviceKeyframeKickRef.current = null;
    }
    const currentCall = serviceCurrentCallRef.current;
    serviceCurrentCallRef.current = null;
    if (currentCall) {
      try { currentCall.terminate(); } catch {}
    }
    const stream = serviceLocalStreamRef.current;
    serviceLocalStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
    }
    if (serviceRemoteVideoRef.current) serviceRemoteVideoRef.current.srcObject = null;
    if (serviceLocalVideoRef.current) serviceLocalVideoRef.current.srcObject = null;
    const audioEl = document.getElementById('serviceRemoteAudio');
    if (audioEl) audioEl.srcObject = null;
    serviceCallBusyRef.current = false;
  }

  function endServiceCall(message) {
    cleanupServiceCallResources();
    setServiceCall(SERVICE_CALL_DEFAULT);
    if (message) showServiceNotice(message);
  }

  const updateServiceCallStatus = (status) => {
    setServiceCall((prev) => ({ ...prev, status }));
  };

  const startServiceCall = async (video) => {
    if (serviceCallBusyRef.current || serviceCall.open) return;
    if (serviceWebState !== 'registered' || !serviceUaRef.current || !serviceCallSessionRef.current) {
      showServiceNotice(t('Web 账号尚未注册完成，请稍后再试。'));
      return;
    }
    const callSession = serviceCallSessionRef.current;
    if (video && !callSession.enableVideo) {
      showServiceNotice(t('当前未开启视频呼叫。'));
      return;
    }
    if (!video && !callSession.enableVoice) {
      showServiceNotice(t('当前未开启语音呼叫。'));
      return;
    }
    if (serviceStatus.sip?.state === 'online_busy') {
      showServiceNotice(t('客服正在通话中，请稍后再试。'));
      return;
    }
    if (serviceStatus.sip?.state === 'offline') {
      showServiceNotice(t('客服 SIP 账号离线，暂时无法呼叫。'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showServiceNotice(t('当前浏览器不支持语音/视频呼叫。'));
      return;
    }
    serviceCallBusyRef.current = true;
    let stream = null;
    let withVideo = video;
    try {
      stream = await navigator.mediaDevices.getUserMedia(withVideo
        ? { audio: true, video: { width: { max: 320 }, height: { max: 240 }, frameRate: { max: 15 } } }
        : { audio: true });
    } catch {
      if (withVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          withVideo = false;
          showServiceNotice(t('摄像头不可用，已改为语音呼叫。'));
        } catch {
          serviceCallBusyRef.current = false;
          showServiceNotice(t('无法访问麦克风，请检查浏览器权限。'));
          return;
        }
      } else {
        serviceCallBusyRef.current = false;
        showServiceNotice(t('无法访问麦克风，请检查浏览器权限。'));
        return;
      }
    }
    serviceLocalStreamRef.current = stream;
    setServiceCall({ ...SERVICE_CALL_DEFAULT, open: true, video: withVideo, status: t('呼叫中…') });
    const ua = serviceUaRef.current;
    const options = {
      mediaStream: stream,
      pcConfig: {
        iceServers: Array.isArray(callSession.iceServers) ? callSession.iceServers : [],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 0,
      },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: withVideo },
      eventHandlers: {
        progress: () => updateServiceCallStatus(t('正在响铃…')),
        ringing: () => updateServiceCallStatus(t('正在响铃…')),
        accepted: () => updateServiceCallStatus(t('通话中')),
        confirmed: () => updateServiceCallStatus(t('通话中')),
        failed: () => endServiceCall(t('呼叫失败，请稍后再试。')),
        ended: () => endServiceCall(t('通话已结束。')),
        peerconnection: (event) => {
          const pc = event.peerconnection;
          applyServiceCodecPreferences(pc);
          if (withVideo) tuneServiceVideoSender(pc, serviceKeyframeKickRef);
          pc.ontrack = (trackEvent) => {
            if (trackEvent.track.kind === 'video' && serviceRemoteVideoRef.current) {
              serviceRemoteVideoRef.current.srcObject = new MediaStream([trackEvent.track]);
            }
            if (trackEvent.track.kind === 'audio') bindServiceRemoteAudio(pc);
          };
          pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected') bindServiceRemoteAudio(pc);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
              endServiceCall(t('通话中断。'));
            }
          };
        },
      },
    };
    try {
      serviceCurrentCallRef.current = ua.call(callSession.targetSipUri, options);
    } catch {
      endServiceCall(t('呼叫失败，请稍后再试。'));
    } finally {
      serviceCallBusyRef.current = false;
    }
  };

  const toggleServiceMute = () => {
    const stream = serviceLocalStreamRef.current;
    if (!stream) return;
    const nextMuted = !serviceCall.muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setServiceCall((prev) => ({ ...prev, muted: nextMuted }));
  };

  const toggleServiceCamera = () => {
    const stream = serviceLocalStreamRef.current;
    if (!stream) return;
    const nextOn = !serviceCall.cameraOn;
    stream.getVideoTracks().forEach((track) => { track.enabled = nextOn; });
    setServiceCall((prev) => ({ ...prev, cameraOn: nextOn }));
  };

  const handleServiceRegister = async (event) => {
    event.preventDefault();
    if (serviceRegistering) return;
    const slug = serviceProfile?.ecardSlug;
    if (!slug) {
      showServiceNotice(t('客服账号尚未配置，暂时无法在线交流。'));
      return;
    }
    const name = serviceRegForm.name.trim();
    const email = serviceRegForm.email.trim();
    if (!name || !email) {
      showServiceNotice(t('请填写姓名与电子邮箱。'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showServiceNotice(t('电子邮箱格式不正确。'));
      return;
    }
    const contact = {
      name,
      email,
      phone: serviceRegForm.phone.trim(),
      subject: serviceRegForm.subject.trim(),
    };
    setServiceRegistering(true);
    try {
      const session = await chatApi.register(slug, contact);
      serviceChat.start({ session, contact, code: session?.resumeCode || '' });
    } catch (error) {
      showServiceNotice(error?.message || t('登记失败，请稍后再试。'));
    } finally {
      setServiceRegistering(false);
    }
  };

  const handleServiceWebMeet = async () => {
    if (serviceWebMeetLoading) return;
    const slug = serviceProfile?.ecardSlug;
    if (!slug) {
      showServiceNotice(t('客服账号尚未配置，暂时无法发起 Web 会议。'));
      return;
    }
    const token = serviceChat.session?.accessToken;
    if (!token) {
      showServiceNotice(t('请先填写姓名与电子邮箱，点击「在线交流」进入会话后再发起 Web 会议。'));
      serviceRegNameRef.current?.focus();
      return;
    }
    setServiceWebMeetLoading(true);
    try {
      const data = await chatApi.webMeet(slug, token);
      const meetingUri = String(data?.meeting?.meetingUri || '').trim();
      if (!meetingUri) throw new Error(t('会议链接生成失败，请稍后再试。'));
      const sent = await serviceChat.send(t('技术支持邀请您加入 Web 会议：{url}', { url: meetingUri }));
      showServiceNotice(sent
        ? t('会议链接已发送，请在会话中点击链接加入。')
        : t('会议已创建，但链接发送失败，请稍后重试。'));
    } catch (error) {
      showServiceNotice(error?.message || t('Web 会议创建失败，请稍后再试。'));
    } finally {
      setServiceWebMeetLoading(false);
    }
  };

  function cleanupAiVoiceResources() {
    aiEndingRef.current = true;
    if (aiCallTimerRef.current) {
      window.clearTimeout(aiCallTimerRef.current);
      aiCallTimerRef.current = null;
    }
    const currentCall = aiCurrentCallRef.current;
    aiCurrentCallRef.current = null;
    if (currentCall) {
      try { currentCall.terminate(); } catch {}
    }
    const ua = aiUaRef.current;
    aiUaRef.current = null;
    if (ua) {
      try { ua.stop(); } catch {}
    }
    const stream = aiLocalStreamRef.current;
    aiLocalStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
    }
    aiOriginalSendRef.current = null;
    const audioEl = document.getElementById('aiRemoteAudio');
    if (audioEl) audioEl.srcObject = null;
    aiCallBusyRef.current = false;
    setAiCall({ open: false, status: '', muted: false });
  }

  function endAiVoiceCall(message) {
    cleanupAiVoiceResources();
    if (message) showAiNotice(message);
  }

  const updateAiCallStatus = (status) => {
    setAiCall((prev) => ({ ...prev, status }));
  };

  const toggleAiMute = () => {
    const stream = aiLocalStreamRef.current;
    if (!stream) return;
    const nextMuted = !aiCall.muted;
    stream.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setAiCall((prev) => ({ ...prev, muted: nextMuted }));
  };

  const startAiVoiceCall = async () => {
    if (aiCallBusyRef.current || aiCall.open) return;
    if (!aiVoiceConfig.available) {
      showAiNotice(aiVoiceConfig.reason || t('AI 语音问答未配置。'));
      return;
    }
    aiCallBusyRef.current = true;
    aiEndingRef.current = false;
    setAiCall({ open: true, status: t('连接中…'), muted: false });
    let stream = null;
    try {
      const session = await apiClient.post('/public/ai-voice/call-session', {}, { timeoutMs: 20000 });
      if (!session?.success) throw new Error(session?.message || t('AI 语音呼叫暂不可用。'));
      const data = session.data || {};
      if (!data.webAccount || !data.wssUrl || !data.webrtcDomain || !data.targetSipUri || !data.credential?.value) {
        throw new Error(t('呼叫配置不完整。'));
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      aiLocalStreamRef.current = stream;
      const JsSIP = await loadJsSip();
      const socket = new JsSIP.WebSocketInterface(data.wssUrl);
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${data.webAccount}@${data.webrtcDomain}`,
        password: data.credential.value,
        register: true,
      });
      aiUaRef.current = ua;
      let failed = false;
      ua.on('registered', () => {
        if (failed || aiEndingRef.current) return;
        injectServiceSdpPatch(ua, data.sipServerPublicIp, aiOriginalSendRef);
        updateAiCallStatus(t('正在呼叫 AI…'));
        const options = {
          mediaStream: stream,
          pcConfig: {
            iceServers: Array.isArray(data.iceServers) ? data.iceServers : [],
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 0,
          },
          rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
          eventHandlers: {
            progress: () => updateAiCallStatus(t('正在响铃…')),
            ringing: () => updateAiCallStatus(t('正在响铃…')),
            accepted: () => updateAiCallStatus(t('通话中')),
            confirmed: () => updateAiCallStatus(t('通话中')),
            failed: () => {
              if (!aiEndingRef.current) endAiVoiceCall(t('AI 通话失败，请稍后再试。'));
            },
            ended: () => {
              if (!aiEndingRef.current) endAiVoiceCall(t('通话已结束。'));
            },
            peerconnection: (event) => {
              const pc = event.peerconnection;
              applyServiceCodecPreferences(pc);
              pc.ontrack = (trackEvent) => {
                if (trackEvent.track.kind === 'audio') bindServiceRemoteAudio(pc, 'aiRemoteAudio');
              };
              pc.oniceconnectionstatechange = () => {
                if (pc.iceConnectionState === 'connected') bindServiceRemoteAudio(pc, 'aiRemoteAudio');
                if ((pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') && !aiEndingRef.current) {
                  endAiVoiceCall(t('AI 通话连接中断。'));
                }
              };
            },
          },
        };
        try {
          aiCurrentCallRef.current = ua.call(data.targetSipUri, options);
        } catch {
          endAiVoiceCall(t('AI 通话发起失败。'));
        }
      });
      ua.on('registrationFailed', () => {
        failed = true;
        if (!aiEndingRef.current) endAiVoiceCall(t('AI 语音连接失败。'));
      });
      ua.on('disconnected', () => {
        failed = true;
        if (!aiEndingRef.current) endAiVoiceCall(t('AI 语音连接中断。'));
      });
      ua.start();
      aiCallTimerRef.current = window.setTimeout(() => {
        if (!failed && !aiCurrentCallRef.current && !aiEndingRef.current) {
          endAiVoiceCall(t('AI 语音连接超时。'));
        }
      }, 15000);
    } catch (error) {
      endAiVoiceCall(error?.message || t('AI 语音呼叫暂不可用。'));
    } finally {
      aiCallBusyRef.current = false;
    }
  };

  const serviceAvatar = serviceProfile?.avatarUrl
    ? absoluteDownloadUrl(serviceProfile.avatarUrl)
    : '/assets/landing/service-avatar.jpg';
  const serviceName = serviceProfile?.name || t('客服小雅');
  const serviceDuty = serviceProfile?.duty || t('在线客服专员');
  const serviceChatEcardData = {
    name: serviceProfile?.name || serviceEcardData?.profile?.name || serviceName,
    duty: serviceProfile?.duty || serviceEcardData?.profile?.duty || serviceDuty,
    tenantName: serviceProfile?.company || serviceEcardData?.tenantName || 'QRTalkie',
    phone: serviceEcardData?.profile?.phone || '',
    email: serviceEcardData?.profile?.email || '',
    sipAccount: serviceProfile?.sipAccount || serviceEcardData?.callConfigSummary?.sipAccount || '',
  };
  const sipState = serviceStatus.sip?.state || 'unknown';
  const avatarStatusClass = sipState === 'online_idle'
    ? 'online'
    : sipState === 'online_busy' ? 'busy' : sipState === 'offline' ? 'offline' : 'unknown';
  const sipTone = sipState === 'online_idle'
    ? 'ok'
    : sipState === 'online_busy' ? 'busy' : sipState === 'offline' ? 'bad' : 'unknown';
  const webTone = serviceWebState === 'registered'
    ? 'ok'
    : serviceWebState === 'registering' ? 'busy' : serviceWebState === 'failed' ? 'bad' : 'unknown';
  const webLabel = serviceWebState === 'registered'
    ? t('已注册')
    : serviceWebState === 'registering' ? t('注册中') : serviceWebState === 'failed' ? t('注册失败') : t('未注册');

  return (
    <div className="qrt-landing" id="qrt-top">
      <div className="qrt-marketing">
      <header className="qrt-site-header">
        <div className="qrt-logo-area">
          <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie Logo" className="qrt-logo-img" />
        </div>
        <nav>
          <ul>
            <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>{t('首页')}</a></li>
            <li><a href="#design-philosophy">{t('产品介绍')}</a></li>
            <li><a href="#scenarios">{t('解决方案')}</a></li>
            <li><a href="#footer">{t('资源下载')}</a></li>
            <li><a href="#" onClick={openAuth}>{t('云管理平台')}</a></li>
            <LandingLanguageSwitch />
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
          <h2 className="qrt-section-title">{t('设计理念')}</h2>
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
              <p>{t('一个平台，满足各类沟通协作需求')}</p>
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
              <h2 className="qrt-section-title">{t('丰富应用场景')}</h2>
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
            <p>{t(footerSettings.brandSubtitleZh)}</p>
          </div>
          <div className="qrt-footer-col qrt-quick-links">
            <h4>{t('快速链接')}</h4>
            <ul>
              <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>{t('首页')}</a></li>
              <li><a href="#design-philosophy">{t('产品介绍')}</a></li>
              <li><a href="#scenarios">{t('解决方案')}</a></li>
              <li><a href="#footer">{t('资源下载')}</a></li>
              <li><a href="#" onClick={openAuth}>{t('云管理平台')}</a></li>
            </ul>
          </div>
          <div className="qrt-footer-col qrt-contact-info">
            <h4>{t('联系我们')}</h4>
            <p>{t('地址：')}{footerSettings.address || '-'}</p>
            <p>✉️ {t('邮箱：')}{footerSettings.email ? <a href={`mailto:${footerSettings.email}`}>{footerSettings.email}</a> : '-'}</p>
          </div>
          <div className="qrt-footer-col qrt-download-col">
            <h4>{t('资源下载')}</h4>
            <div className="qrt-download-item">
              <a
                href={footerSettings.desktopDownloadUrl || '#'}
                className="qrt-desktop-download"
                onClick={(e) => { if (!footerSettings.desktopDownloadUrl) e.preventDefault(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                <span className="qrt-dl-text"><span className="qrt-dl-title">{t('桌面版 (Windows)')}</span><span className="qrt-dl-sub">{footerSettings.desktopVersion ? `v${footerSettings.desktopVersion} · ${t('点击下载')}` : t('点击下载')}</span></span>
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
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">Android</span><span className="qrt-scan-tip">{footerSettings.androidDownloadUrl ? t('点击获取 Android 二维码') : t('暂无可用二维码')}</span></div>
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
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">iOS</span><span className="qrt-scan-tip">{footerSettings.iosDownloadUrl ? t('点击获取 iOS 二维码') : t('暂无可用二维码')}</span></div>
              </a>
            </div>
          </div>
        </div>
        <div className="qrt-footer-bottom">
          <div className="qrt-container">
            <p>{footerSettings.copyright} | <a href={footerSettings.privacyUrl || '#'} onClick={(e) => { if (!footerSettings.privacyUrl || footerSettings.privacyUrl === '#') e.preventDefault(); }}>{t('隐私政策')}</a></p>
          </div>
        </div>
      </footer>

      <button
        type="button"
        className={`qrt-demo-launcher${demoOpen ? ' hidden' : ''}`}
        aria-label={t('在线演示')}
        aria-expanded={demoOpen}
        onClick={() => setDemoOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
          <path d="M10.5 7.5v5l4-2.5-4-2.5z" fill="currentColor" stroke="none" />
        </svg>
        <span>{t('演示')}</span>
      </button>

      {demoOpen && <div className="qrt-demo-backdrop" onClick={() => setDemoOpen(false)}></div>}
      <aside className={`qrt-demo-drawer${demoOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label={t('在线演示')} aria-hidden={!demoOpen}>
        <div className="qrt-demo-head">
          <span className="qrt-online-dot"></span>
          <h3>{t('在线演示')}</h3>
          <button type="button" className="qrt-demo-close" onClick={() => setDemoOpen(false)} aria-label={t('关闭')}>×</button>
        </div>
        <div className="qrt-demo-list">
          <button type="button" className="qrt-demo-item" onClick={() => { setDemoOpen(false); setEcardDemoOpen(true); }}><i>📇</i><span>{t('电子名片')}</span><em>›</em></button>
          <button type="button" className="qrt-demo-item" onClick={openAiDemo}><i>🤖</i><span>{t('AI客服')}</span><em>›</em></button>
          <button type="button" className="qrt-demo-item" onClick={openServiceDemo}><i>💬</i><span>{t('线上客服')}</span><em>›</em></button>
          <button type="button" className="qrt-demo-item" onClick={() => openDemoLink('callcenter')}><i>📞</i><span>{t('呼叫中心')}</span><em>›</em></button>
          <button type="button" className="qrt-demo-item" onClick={() => openDemoLink('building')}><i>🏢</i><span>{t('楼宇管理')}</span><em>›</em></button>
        </div>
        <p className="qrt-demo-hint">{t('选择要体验的在线演示')}</p>
      </aside>

      {ecardDemoOpen && (
        <div
          className="qrt-ecard-demo-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('电子名片在线演示')}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEcardDemoOpen(false); }}
        >
          <button type="button" className="qrt-ecard-demo-close" aria-label={t('关闭')} onClick={() => setEcardDemoOpen(false)}>×</button>
          <figure className="qrt-ecard-demo-figure">
            <img src="/assets/landing/ecard-demo01.png" alt={t('电子名片演示')} />
            <figcaption>{t('扫描图中二维码，体验电子名片')}</figcaption>
          </figure>
        </div>
      )}
      <button type="button" id="qrt-back-to-top" className={`qrt-back-to-top-btn${showBackTop ? ' show' : ''}`} aria-label={t('回到顶部')} onClick={scrollTop}>↑</button>
      </div>

      {demoEntry && demoEntryConfig && (
        <div
          className="qrt-demo-entry-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t(demoEntryConfig.title)}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDemoEntry(null); }}
        >
          <button type="button" className="qrt-demo-entry-close" aria-label={t('关闭')} onClick={() => setDemoEntry(null)}>×</button>
          <div className="qrt-demo-entry-dialog">
            {demoEntryConfig.img && (
              <img className="qrt-demo-entry-media" src={demoEntryConfig.img} alt={t(demoEntryConfig.title)} />
            )}
            <div className="qrt-demo-entry-body">
              <h3>{t(demoEntryConfig.title)}</h3>
              <p className="qrt-demo-entry-sub">{t('扫描二维码或点击链接进入在线演示')}</p>
              {demoEntryUrl ? (
                <div className="qrt-demo-entry-actions">
                  <div className="qrt-demo-entry-qr">
                    <div className="qrt-demo-entry-qr-box">
                      <QRCodeSVG value={demoEntryAbsoluteUrl} size={200} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                    </div>
                    <span>{t('扫描二维码进入')}</span>
                  </div>
                  <a className="qrt-demo-entry-link" href={demoEntryAbsoluteUrl} target="_blank" rel="noopener noreferrer">
                    {t('点击链接进入')}
                  </a>
                </div>
              ) : (
                <p className="qrt-demo-entry-empty">{t('演示链接尚未配置，请联系管理员在「首页设置」中设置。')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {aiDemoOpen && (
        <div
          className="qrt-ai-demo-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('AI客服在线演示')}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAiDemoOpen(false); }}
        >
          <button type="button" className="qrt-ai-demo-close" aria-label={t('关闭')} onClick={() => setAiDemoOpen(false)}>×</button>
          <div className="qrt-ai-demo-dialog">
            <img className="qrt-ai-demo-banner" src="/assets/landing/ai-demo01.jpg" alt={t('AI客服在线演示')} />
            <div className="qrt-ai-chat">
              <div className="qrt-ai-demo-limit">
                <span className="qrt-ai-demo-limit-text">{t('演示限时 3 分钟 · 文字聊天与语音通话到时自动结束')}</span>
                <span className={`qrt-ai-demo-countdown${aiDemoSecondsLeft <= 30 ? ' is-warning' : ''}`}>
                  {aiCall.open ? t('语音通话中') : t('剩余 {time}', { time: formatDemoSeconds(aiDemoSecondsLeft) })}
                </span>
              </div>
              <div className="qrt-ai-messages" ref={aiListRef}>
                {aiMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`qrt-ai-msg ${message.role}`}>
                    {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                      <div className="qrt-ai-msg-attachments">
                        {message.attachments.map((attachment) => (attachment.kind === 'image' ? (
                          <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
                        ) : (
                          <span key={attachment.id} className="qrt-ai-msg-file">📄 {attachment.name}</span>
                        )))}
                      </div>
                    )}
                    {message.content && <span className="qrt-ai-msg-text">{message.content}</span>}
                  </div>
                ))}
                {aiSending && (
                  <div className="qrt-ai-msg assistant qrt-ai-typing" aria-label={t('AI 正在回复')}>
                    <span></span><span></span><span></span>
                  </div>
                )}
              </div>
              {aiMessages.length <= 1 && !aiSending && (
                <div className="qrt-ai-quick">
                  {AI_DEMO_QUICK_QUESTIONS.map((question) => (
                    <button key={question} type="button" onClick={() => sendAiMessage(question)}>{t(question)}</button>
                  ))}
                </div>
              )}
              {aiAttachments.length > 0 && (
                <div className="qrt-ai-attachments">
                  {aiAttachments.map((attachment) => (
                    <div key={attachment.id} className="qrt-ai-attach">
                      {attachment.kind === 'image' ? (
                        <img src={attachment.dataUrl} alt={attachment.name} />
                      ) : (
                        <span className="qrt-ai-attach-name">📄 {attachment.name}</span>
                      )}
                      <button type="button" onClick={() => removeAiAttachment(attachment.id)} disabled={aiSending} aria-label={t('移除附件')}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={aiFileInputRef}
                type="file"
                multiple
                hidden
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log,.xml,image/png,image/jpeg,image/webp"
                onChange={handleAiFiles}
              />
              <form className="qrt-ai-input-row" onSubmit={(e) => { e.preventDefault(); sendAiMessage(); }}>
                <button
                  type="button"
                  className="qrt-ai-attach-btn"
                  onClick={() => aiFileInputRef.current?.click()}
                  disabled={aiSending}
                  aria-label={t('上传图片或文件')}
                  title={t('上传图片或文件')}
                >+</button>
                <input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={t('输入问题，或点击 + 上传图片/文件…')}
                  maxLength={500}
                  autoComplete="off"
                  aria-label={t('输入问题')}
                />
                <button type="submit" disabled={aiSending || (!aiInput.trim() && aiAttachments.length === 0)}>{aiSending ? t('回复中…') : t('发送')}</button>
                <button
                  type="button"
                  className="qrt-ai-call-btn"
                  onClick={startAiVoiceCall}
                  disabled={aiSending || !aiVoiceConfig.available || aiCall.open}
                  aria-label={t('语音呼叫')}
                  title={aiVoiceConfig.available ? t('语音呼叫 QRTalkie AI') : (aiVoiceConfig.reason || t('AI 语音问答未配置'))}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.66 2.61a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.47-1.23a2 2 0 0 1 2.11-.45c.83.32 1.71.54 2.61.66A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>
              </form>
              {aiNotice && <p className="qrt-ai-notice">{aiNotice}</p>}
              {aiError && <p className="qrt-ai-error">{aiError}</p>}
            </div>
          </div>
          {aiCall.open && (
            <div className="qrt-service-call-layer" role="dialog" aria-modal="true" aria-label={t('AI 语音通话')}>
              <audio id="aiRemoteAudio" autoPlay playsInline style={{ display: 'none' }}></audio>
              <div className="qrt-service-call-card">
                <div className="qrt-service-call-avatar qrt-ai-call-avatar">
                  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="12" y="14" width="24" height="20" rx="7" />
                    <path d="M24 8v6" />
                    <circle cx="18" cy="24" r="2" fill="currentColor" stroke="none" />
                    <circle cx="30" cy="24" r="2" fill="currentColor" stroke="none" />
                    <path d="M20 30h8" />
                    <path d="M8 22v6M40 22v6" />
                  </svg>
                </div>
                <div className="qrt-service-call-info">
                  <h3>QRTalkie AI</h3>
                  <p>{aiCall.status || t('连接中…')}</p>
                  <p className={`qrt-ai-call-limit${aiCallSecondsLeft <= 30 ? ' is-warning' : ''}`}>
                    {t('演示通话限时 3 分钟 · 剩余 {time}', { time: formatDemoSeconds(aiCallSecondsLeft) })}
                  </p>
                </div>
                <div className="qrt-service-call-actions">
                  <button type="button" onClick={toggleAiMute}>{aiCall.muted ? t('取消静音') : t('静音')}</button>
                  <button type="button" className="is-hangup" onClick={() => endAiVoiceCall(t('通话已结束。'))}>{t('挂断')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {serviceOpen && (
        <div
          className="qrt-service-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('线上客服')}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setServiceOpen(false); }}
        >
          <button type="button" className="qrt-service-close" aria-label={t('关闭')} onClick={() => setServiceOpen(false)}>×</button>
          <div className="qrt-service-panel">
            <aside className="qrt-service-left">
              <div className="qrt-service-banner" style={{ backgroundImage: "url('/assets/landing/service03.jpg')" }}></div>
              <div className="qrt-service-profile">
                <div className="qrt-service-avatar">
                  <img src={serviceAvatar} alt={serviceName} />
                  <span
                    className={`qrt-service-status ${avatarStatusClass}`}
                    title={t(serviceStatus.sip?.label || '状态未知')}
                    aria-label={t(serviceStatus.sip?.label || '状态未知')}
                  ></span>
                </div>
                <h2>{serviceName}</h2>
                <p className="qrt-service-role">{serviceDuty}</p>
                <div className="qrt-service-statuses">
                  <div className="qrt-service-status-card">
                    <div className="qrt-service-status-head">
                      <span className="qrt-service-status-title">{t('Web 账号状态')}</span>
                      <button
                        type="button"
                        className="qrt-service-status-refresh"
                        onClick={() => setServiceWebRetry((value) => value + 1)}
                        disabled={serviceWebState === 'registering'}
                        aria-label={t('重新注册 Web 账号')}
                      >
                        <svg className={serviceWebState === 'registering' ? 'qrt-spin' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                          <path d="M21 3v6h-6" />
                        </svg>
                      </button>
                    </div>
                    <span className="qrt-service-status-sub">{serviceWebAccount || serviceProfile?.webAccount || t('未配置 Web 账号')}</span>
                    <span className={`qrt-service-status-pill is-${webTone}`}>{webLabel}</span>
                  </div>
                  <div className="qrt-service-status-card">
                    <div className="qrt-service-status-head">
                      <span className="qrt-service-status-title">{t('SIP 账号状态')}</span>
                      <button
                        type="button"
                        className="qrt-service-status-refresh"
                        onClick={refreshServiceStatus}
                        disabled={serviceStatusLoading}
                        aria-label={t('刷新 SIP 账号状态')}
                      >
                        <svg className={serviceStatusLoading ? 'qrt-spin' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                          <path d="M21 3v6h-6" />
                        </svg>
                      </button>
                    </div>
                    <span className="qrt-service-status-sub">{serviceStatus.sip?.account || serviceProfile?.sipAccount || '—'}</span>
                    <span className={`qrt-service-status-pill is-${sipTone}`}>{t(serviceStatus.sip?.label || 'SIP 未知')}</span>
                  </div>
                </div>
                <div className="qrt-service-actions">
                  <button type="button" onClick={() => startServiceCall(false)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.66 2.61a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.47-1.23a2 2 0 0 1 2.11-.45c.83.32 1.71.54 2.61.66A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span>{t('语音呼叫')}</span>
                  </button>
                  <button type="button" onClick={() => startServiceCall(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="6" width="12" height="12" rx="2" />
                      <path d="M15 10.5 21 7v10l-6-3.5" />
                    </svg>
                    <span>{t('视频呼叫')}</span>
                  </button>
                  <button type="button" onClick={handleServiceWebMeet} disabled={serviceWebMeetLoading}>
                    <svg className={serviceWebMeetLoading ? 'qrt-spin' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="13" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                      <path d="M8 12l2.5-2 2 1.5L16 8" />
                    </svg>
                    <span>{serviceWebMeetLoading ? t('生成中…') : t('Web会议')}</span>
                  </button>
                </div>
              </div>
            </aside>
            <section className={`qrt-service-chat${serviceChat.session ? ' is-chatting' : ''}`}>
              {serviceChat.session ? (
                <React.Suspense fallback={<div className="qrt-service-chat-loading">{t('会话加载中…')}</div>}>
                  <ECardChatPanel
                    ecardData={serviceChatEcardData}
                    displayName={serviceChatEcardData.name}
                    statusTone={serviceChat.statusTone}
                    statusText={serviceChat.statusText}
                    avatarUrl={serviceAvatar}
                    fallbackAvatar="/assets/landing/service-avatar.jpg"
                    callEnabled={serviceWebState === 'registered' && serviceStatus.sip?.state !== 'online_busy' && serviceStatus.sip?.state !== 'offline'}
                    onCall={(video) => startServiceCall(video)}
                    messages={serviceChat.messages}
                    loading={serviceChat.loading}
                    sending={serviceChat.sending}
                    hasMore={serviceChat.hasMore}
                    onLoadMore={serviceChat.loadMore}
                    onSend={serviceChat.send}
                    onSendVoice={serviceChat.sendVoice}
                    onSendAttachment={serviceChat.sendAttachment}
                    onLoadAudio={serviceChat.loadAudioUrl}
                    onRecall={serviceChat.recallMessage}
                    onHideMessage={serviceChat.hideMessage}
                    onDownloadAttachment={serviceChat.downloadAttachment}
                    uploadProgress={serviceChat.uploadProgress}
                    chatCode={serviceChat.code}
                    onGetCode={serviceChat.rotateCode}
                    connection={serviceChat.connection}
                    error={serviceChat.error}
                    embedMode
                  />
                </React.Suspense>
              ) : (
                <div className="qrt-service-register">
                  <h3>{t('在线咨询')}</h3>
                  <p className="qrt-service-register-intro">{t('请先留下联系方式，方便客服回复您。登记后即可与客服在线交流，客服会在 App 的「访客」中收到您的消息。')}</p>
                  <form className="qrt-service-register-form" onSubmit={handleServiceRegister}>
                    <label>
                      <span>{t('姓名 *')}</span>
                      <input
                        ref={serviceRegNameRef}
                        value={serviceRegForm.name}
                        onChange={(e) => setServiceRegForm((prev) => ({ ...prev, name: e.target.value }))}
                        maxLength={120}
                        autoComplete="name"
                      />
                    </label>
                    <label>
                      <span>{t('电子邮箱 *')}</span>
                      <input
                        type="email"
                        value={serviceRegForm.email}
                        onChange={(e) => setServiceRegForm((prev) => ({ ...prev, email: e.target.value }))}
                        maxLength={128}
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </label>
                    <label>
                      <span>{t('手机')}</span>
                      <input
                        value={serviceRegForm.phone}
                        onChange={(e) => setServiceRegForm((prev) => ({ ...prev, phone: e.target.value }))}
                        maxLength={64}
                        autoComplete="tel"
                      />
                    </label>
                    <label>
                      <span>{t('事由')}</span>
                      <input
                        value={serviceRegForm.subject}
                        onChange={(e) => setServiceRegForm((prev) => ({ ...prev, subject: e.target.value }))}
                        maxLength={200}
                      />
                    </label>
                    {!serviceProfile?.ecardSlug && (
                      <p className="qrt-service-register-hint">{t('客服账号尚未配置，暂时无法在线交流。')}</p>
                    )}
                    <button type="submit" className="qrt-service-register-submit" disabled={serviceRegistering || !serviceProfile?.ecardSlug}>
                      {serviceRegistering ? t('登记中…') : t('在线交流')}
                    </button>
                  </form>
                </div>
              )}
              {serviceNotice && <p className="qrt-service-notice">{serviceNotice}</p>}
            </section>
          </div>
          {serviceCall.open && (
            <div className="qrt-service-call-layer" role="dialog" aria-modal="true" aria-label={serviceCall.video ? t('视频通话') : t('语音通话')}>
              <audio id="serviceRemoteAudio" autoPlay playsInline style={{ display: 'none' }}></audio>
              <div className={`qrt-service-call-card${serviceCall.video ? ' is-video' : ''}`}>
                {serviceCall.video ? (
                  <video className="qrt-service-call-remote" ref={serviceRemoteVideoRef} autoPlay playsInline muted></video>
                ) : (
                  <div className="qrt-service-call-avatar">
                    <img src={serviceAvatar} alt={serviceName} />
                  </div>
                )}
                <div className="qrt-service-call-info">
                  <h3>{serviceName}</h3>
                  <p>{serviceCall.status || t('呼叫中…')}</p>
                </div>
                {serviceCall.video && (
                  <video className="qrt-service-call-local" ref={serviceLocalVideoRef} autoPlay playsInline muted></video>
                )}
                <div className="qrt-service-call-actions">
                  <button type="button" onClick={toggleServiceMute}>{serviceCall.muted ? t('取消静音') : t('静音')}</button>
                  {serviceCall.video && (
                    <button type="button" onClick={toggleServiceCamera}>{serviceCall.cameraOn ? t('关闭摄像头') : t('开启摄像头')}</button>
                  )}
                  <button type="button" className="is-hangup" onClick={() => endServiceCall(t('通话已结束。'))}>{t('挂断')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {authOpen && (
        <div className="qrt-auth-modal" role="dialog" aria-modal="true" aria-label={t('云管理平台登录')} onMouseDown={(e) => { if (e.target === e.currentTarget) closeAuth(); }}>
          <div className="qrt-auth-dialog">
            <div className="qrt-auth-left">
              <img src="/assets/landing/login02.jpg" alt="QRTalkie Cloud" />
              <div className="qrt-auth-left-text">
                <span className="qrt-auth-left-kicker">{t('欢迎使用')}</span>
                <strong>{t('QRTalkie 云管理平台')}</strong>
              </div>
            </div>
            <div className="qrt-auth-right">
              <button type="button" className="qrt-auth-close" onClick={closeAuth} aria-label={t('关闭')}>×</button>
              <div className="qrt-auth-brand">
                <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie" />
              </div>
              {authSuccess ? (
                <div className="qrt-auth-success">
                  <h2>{t('登录成功')}</h2>
                  <p>{t('管理平台将在新标签页打开，官网会保留在当前标签页。')}</p>
                  <a
                    className="qrt-enter-platform"
                    href="/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleEnterPlatform}
                  >
                    {t('进入管理平台')}
                  </a>
                  {entered && <p className="qrt-auth-hint">{t('已在新标签页打开管理平台。')}</p>}
                  {enterError && <p className="qrt-auth-error">{enterError}</p>}
                  <p className="qrt-auth-legal-note">
                    {t('登录即表示您已阅读并同意')}
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('terms')}>{t('《会员服务条款》')}</button>
                    {t('和')}
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('privacy')}>{t('《隐私权政策》')}</button>
                  </p>
                  <button type="button" className="qrt-auth-secondary" onClick={closeAuth}>{t('留在官网')}</button>
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
              <button type="button" className="qrt-legal-close" aria-label={t('关闭')} onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>×</button>
            </div>
            <div className="qrt-legal-body">
              {legalViewer.loading ? (
                <p className="qrt-legal-loading">{t('内容加载中…')}</p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalViewer.content || ''}</ReactMarkdown>
              )}
            </div>
            <div className="qrt-legal-footer">
              <button type="button" className="qrt-legal-confirm" onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>{t('我知道了')}</button>
            </div>
          </div>
        </div>
      )}

      {qrModal && (
        <div
          className="qrt-qr-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t('{platform} 安装二维码', { platform: qrModal.platform })}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeQrModal(); }}
        >
          <div className="qrt-qr-dialog">
            <button type="button" className="qrt-qr-close" onClick={closeQrModal} aria-label={t('关闭')}>×</button>
            <h3>{t('{platform} 安装二维码', { platform: qrModal.platform })}</h3>
            {qrModal.version && <p className="qrt-qr-version">{t('版本 v{version}', { version: qrModal.version })}</p>}
            <div className="qrt-qr-large">
              <QRCodeSVG value={absoluteDownloadUrl(qrModal.url)} size={300} bgColor="#ffffff" fgColor="#0f172a" level="M" />
            </div>
            <p className="qrt-qr-scan-tip">
              {t('扫码安装')}
              {qrModal.platform === 'Android' && (
                <>
                  {t('或')}
                  <a
                    className="qrt-qr-download-link"
                    href={absoluteDownloadUrl(qrModal.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('点击下载')}
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
