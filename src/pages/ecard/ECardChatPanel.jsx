import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, KeyRound, MessageSquareDashed, Paperclip, Send, Video } from 'lucide-react';
import './ecardChatTheme.css';

/**
 * 名片页内的访客聊天面板（PC 两栏 / 窄屏单栏）。
 *
 * 当前为样式阶段：渲染结构、配色、气泡与输入区都按最终形态呈现，
 * 但消息与发送尚未接后端（见 previewMessages / handleSend 的临时本地回显）。
 * 接线时替换为 chat-session → 历史 → WS 即可，DOM 与样式不动。
 */
export default function ECardChatPanel({
  ecardData,
  displayName,
  statusTone = 'is-warn',
  statusText = '未知',
  chatCode = '',
  avatarUrl = '',
  fallbackAvatar = '',
  callEnabled = false,
  onBack,
  onCall,
  previewMessages = [],
}) {
  const [messages, setMessages] = useState(previewMessages);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    setMessages(previewMessages);
  }, [previewMessages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  // 临时本地回显：接线后改为 POST /chat/messages + WS 回执
  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, senderType: 'visitor', content: text, createdAt: new Date().toISOString() },
    ]);
    setDraft('');
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(chatCode);
    } catch { /* 剪貼板不可用時靜默 */ }
  }

  return (
    <div className="ecard-chatBody">
      <aside className="ecard-chatAside">
        <div className="ecard-profileTop">
          <div className="ecard-avatarWrap">
            <img
              src={avatarUrl || fallbackAvatar}
              alt={ecardData?.name || ''}
              className="ecard-avatar"
              onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
            />
            <div className="ecard-avatarRing" />
          </div>
          <div className="ecard-profileMain">
            <h1 className="ecard-name">{ecardData?.name || '—'}</h1>
            <div className="ecard-duty">{ecardData?.duty || '—'}</div>
            <div className="ecard-company"><b>{ecardData?.tenantName || 'QRTalkie'}</b></div>
          </div>
        </div>

        <div className="ecard-contactGrid">
          <div className="ecard-contactItem">
            <div className="ecard-contactLabel">手機</div>
            <div className="ecard-contactValue">{ecardData?.phone || '—'}</div>
          </div>
          <div className="ecard-contactItem">
            <div className="ecard-contactLabel">郵箱</div>
            <div className="ecard-contactValue">{ecardData?.email || '—'}</div>
          </div>
          <div className="ecard-contactItem">
            <div className="ecard-contactLabel">SIP 目標</div>
            <div className="ecard-contactValue ecard-sipTarget">{ecardData?.sipAccount || '—'}</div>
          </div>
        </div>

        <div className="ecard-callButtons">
          <button
            type="button"
            className="ecard-callButton"
            disabled={!callEnabled}
            onClick={() => onCall?.(false)}
            style={callButtonStyle(callEnabled)}
          >
            <Headphones size={16} style={{ marginRight: 6 }} />
            語音
          </button>
          <button
            type="button"
            className="ecard-callButton"
            disabled={!callEnabled}
            onClick={() => onCall?.(true)}
            style={callButtonStyle(callEnabled)}
          >
            <Video size={16} style={{ marginRight: 6 }} />
            視頻
          </button>
        </div>
      </aside>

      <section className="ecard-chatMain">
        <header className="ecard-chatHeader">
          <button type="button" className="ecard-chatBack" onClick={onBack}>
            <ArrowLeft size={14} />
            名片
          </button>
          <div className="ecard-chatHeadMain">
            <div className="ecard-chatTitle">{displayName || '線上諮詢'}</div>
            <div className="ecard-chatSubstate">
              <span className={`ecard-statusDot ${statusTone}`} />
              {statusText}
            </div>
          </div>
          {chatCode ? (
            <button type="button" className="ecard-chatCode" onClick={handleCopyCode} title="點擊複製聊天碼">
              <KeyRound size={13} />
              {chatCode}
            </button>
          ) : null}
        </header>

        <div className="ecard-chatMessages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="ecard-chatEmpty">
              <MessageSquareDashed size={30} />
              <div>尚無訊息，輸入您的問題即可開始諮詢</div>
            </div>
          ) : (
            messages.map((item) => {
              if (item.senderType === 'system') {
                return (
                  <div key={item.id} className="ecard-chatSystem">{item.content}</div>
                );
              }
              const isVisitor = item.senderType === 'visitor';
              return (
                <div key={item.id} className={`ecard-chatMsg ${isVisitor ? 'is-visitor' : 'is-agent'}`}>
                  <div className="ecard-chatBubble">{item.content}</div>
                  <div className="ecard-chatMeta">{formatTime(item.createdAt)}</div>
                </div>
              );
            })
          )}
        </div>

        <div className="ecard-chatComposer">
          <button type="button" className="ecard-chatIconButton" disabled title="附件（待接入）">
            <Paperclip size={16} />
          </button>
          <textarea
            className="ecard-chatInput"
            rows={1}
            value={draft}
            placeholder="輸入訊息…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="ecard-chatSend" disabled={!draft.trim()} onClick={handleSend}>
            <Send size={15} style={{ marginRight: 6 }} />
            發送
          </button>
        </div>
      </section>
    </div>
  );
}

function callButtonStyle(enabled) {
  return {
    minHeight: 40,
    borderRadius: 12,
    border: '1px solid rgba(212, 175, 55, 0.24)',
    background: enabled
      ? 'linear-gradient(180deg, #7d1010 0%, #4c0a0a 100%)'
      : 'linear-gradient(180deg, #343941 0%, #23272f 100%)',
    color: enabled ? '#fff4dd' : '#8a93a3',
    fontSize: 12,
    fontWeight: 800,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

function formatTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
