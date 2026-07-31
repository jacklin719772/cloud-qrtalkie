export const prototypeUsers = [
  { name: "Alice Chen", username: "alice", status: "online", devices: "2 臺", lastSeen: "1 分鐘前" },
  { name: "Bob Li", username: "bob", status: "online", devices: "1 臺", lastSeen: "4 分鐘前" },
  { name: "Support Desk", username: "support", status: "failed", devices: "0 臺", lastSeen: "密碼錯誤" },
  { name: "Nina Wang", username: "nina", status: "offline", devices: "0 臺", lastSeen: "昨天 18:42" },
];

export const prototypeRegistrations = [
  { username: "alice", contact: "sip:alice@10.10.2.14:5060", agent: "Linphone iOS 5.3", transport: "TLS", expires: "3580 秒", state: "online" },
  { username: "bob", contact: "sip:bob@198.51.100.18:7443", agent: "WebRTC Client", transport: "WSS", expires: "1210 秒", state: "online" },
  { username: "support", contact: "203.0.113.42", agent: "Zoiper 5", transport: "TCP", expires: "403 Forbidden", state: "failed" },
];

export const pageTitles = {
  dashboard: "控制台",
  users: "SIP 使用者",
  registrations: "註冊狀態",
  domain: "套餐管理",
  "purchase-plan": "購買套餐",
  tenant: "租戶設定",
};

export const legalTexts = {
  terms: {
    title: "服務條款",
    body: `
      <p>以下為 QRTalkie Cloud 服務條款說明，請詳閱後再進行使用。本平臺提供租戶管理、帳號註冊與 SIP 服務監控等功能。</p>
      <h3>使用說明</h3>
      <p>使用者應依照本平臺提供的功能進行操作，不得進行違規或未授權的行為。</p>
      <h3>服務內容</h3>
      <p>本平臺提供即時通訊、SIP 註冊與監控、使用者管理與系統報表等功能。</p>
      <h3>安全責任</h3>
      <p>平臺將維護系統安全，但使用者仍需保管帳號與密碼，避免未授權存取。</p>
    `,
  },
  privacy: {
    title: "隱私政策",
    body: `
      <p>本平臺重視隱私保護，所有個人資料僅於服務範圍內處理，不會未經授權對外揭露。</p>
      <h3>資料收集</h3>
      <p>僅蒐集提供服務所需資訊，如註冊資料、聯絡資訊與使用紀錄。</p>
      <h3>資料使用</h3>
      <p>資料僅用於帳號管理、客服支援與系統最佳化，不作其他用途。</p>
      <h3>資料保護</h3>
      <p>平臺採取合理技術措施保護資料安全，避免資料外洩與未授權存取。</p>
    `,
  },
};

export const planFeatureLabels = {
  pro: "標準通訊功能",
  business: "含團隊管理",
  enterprise: "進階支援",
  ultimate: "完整功能",
};
