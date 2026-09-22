import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { chatApi } from './ecardChatApi';
import './ecardChatDialog.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 访客登记弹窗（聊天入口必经）。必须填写姓名 + 电子邮箱才能进入聊天；
 * 聊天码选填 —— 填入后点右侧刷新按钮验证，成功即回填上次登记信息并接续原会话。
 * focusCode=true 时（从「已有聊天碼？」入口进来）自动聚焦聊天码输入框。
 */
export default function ECardChatRegisterDialog({ slug, defaultContact, defaultCode = '', focusCode = false, onClose, onReady }) {
  const [form, setForm] = useState({
    name: defaultContact?.name || '',
    email: defaultContact?.email || '',
    phone: defaultContact?.phone || '',
    subject: defaultContact?.subject || '',
  });
  const [code, setCode] = useState(defaultCode);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verified, setVerified] = useState(null); // { session, snapshot }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (focusCode) codeInputRef.current?.focus();
  }, [focusCode]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (verified) setVerified(null);
  }

  async function handleVerify() {
    const value = code.trim();
    if (!value || verifying) return;
    setVerifying(true);
    setVerifyError('');
    try {
      const session = await chatApi.resume(slug, value);
      const contact = session?.contact || {};
      setVerified({ session, snapshot: contact });
      setForm({
        name: contact.name || session?.nickname || '',
        email: contact.email || '',
        phone: contact.phone || '',
        subject: contact.subject || '',
      });
    } catch (error) {
      setVerified(null);
      setVerifyError(error?.message || '聊天碼驗證失敗');
    } finally {
      setVerifying(false);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name || !email) {
      setSubmitError('請填寫姓名與電子郵件');
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setSubmitError('電子郵件格式不正確');
      return;
    }

    const contact = { name, email, phone: form.phone.trim(), subject: form.subject.trim() };
    const unchanged = verified && ['name', 'email', 'phone', 'subject']
      .every((key) => (verified.snapshot?.[key] || '') === contact[key]);

    setSubmitting(true);
    setSubmitError('');
    try {
      if (unchanged) {
        // 用聊天码找回且资料未改 → 直接用已验证的会话进入
        onReady({ session: verified.session, contact, code: code.trim(), resumed: true });
        return;
      }
      // 新登记，或（用码找回后）资料被修改 → 走登记接口：Cookie 会把身份落回原访客并更新登记信息
      const session = await chatApi.register(slug, contact);
      onReady({ session, contact, code: session?.resumeCode || code.trim(), resumed: Boolean(verified) });
    } catch (error) {
      setSubmitError(error?.message || '登記失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ecard-chatDialogOverlay" onClick={onClose}>
      <div className="ecard-chatDialog" onClick={(event) => event.stopPropagation()}>
        <div className="ecard-chatDialogHeader">
          <div className="ecard-chatDialogTitle">線上諮詢</div>
          <button type="button" className="ecard-chatDialogClose" onClick={onClose} aria-label="close">
            <X size={18} />
          </button>
        </div>

        <div className="ecard-chatDialogBody">
          <p className="ecard-chatDialogIntro">請先留下聯絡方式，方便客服回覆您。</p>

          <label className="ecard-chatField">
            <span className="ecard-chatFieldLabel">
              <KeyRound size={12} />
              聊天碼（選填）
            </span>
            <span className="ecard-chatCodeRow">
              <input
                ref={codeInputRef}
                className="ecard-chatDialogInput ecard-chatCodeInput"
                value={code}
                placeholder="QT-XXXX-XXXX"
                onChange={(event) => { setCode(event.target.value); setVerifyError(''); setVerified(null); }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleVerify(); } }}
              />
              <button
                type="button"
                className="ecard-chatVerifyButton"
                onClick={handleVerify}
                disabled={verifying || !code.trim()}
                title="驗證聊天碼並取回上次登記信息"
              >
                {verifying ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              </button>
            </span>
          </label>

          {verifyError ? <div className="ecard-chatHint is-error">{verifyError}</div> : null}
          {verified ? (
            <div className="ecard-chatHint is-ok">
              ✓ 已找到上次的對話{verified.snapshot?.name ? `（${verified.snapshot.name}）` : ''}，資料已回填，可直接進入或修改後進入
            </div>
          ) : null}

          <label className="ecard-chatField">
            <span className="ecard-chatFieldLabel">姓名 *</span>
            <input
              className="ecard-chatDialogInput"
              value={form.name}
              maxLength={120}
              onChange={(event) => updateField('name', event.target.value)}
            />
          </label>

          <label className="ecard-chatField">
            <span className="ecard-chatFieldLabel">電子郵件 *</span>
            <input
              className="ecard-chatDialogInput"
              value={form.email}
              maxLength={128}
              placeholder="name@example.com"
              onChange={(event) => updateField('email', event.target.value)}
            />
          </label>

          <div className="ecard-chatFieldRow">
            <label className="ecard-chatField">
              <span className="ecard-chatFieldLabel">手機</span>
              <input
                className="ecard-chatDialogInput"
                value={form.phone}
                maxLength={64}
                onChange={(event) => updateField('phone', event.target.value)}
              />
            </label>
            <label className="ecard-chatField">
              <span className="ecard-chatFieldLabel">事由</span>
              <input
                className="ecard-chatDialogInput"
                value={form.subject}
                maxLength={200}
                onChange={(event) => updateField('subject', event.target.value)}
              />
            </label>
          </div>

          {submitError ? <div className="ecard-chatHint is-error">{submitError}</div> : null}
        </div>

        <div className="ecard-chatDialogFooter">
          <button type="button" className="ecard-chatDialogCancel" onClick={onClose}>取消</button>
          <button type="button" className="ecard-chatDialogSubmit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <LoaderCircle size={15} className="spin" /> : null}
            進入聊天室
          </button>
        </div>
      </div>
    </div>
  );
}
