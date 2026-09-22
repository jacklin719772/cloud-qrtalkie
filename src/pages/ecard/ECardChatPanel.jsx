import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, KeyRound, MessageSquareDashed, Paperclip, Send, Video } from 'lucide-react';
import './ecardChatTheme.css';

/**
 * 名片页内的访客聊天面板（PC 两栏 / 窄屏单栏）。
 * 纯呈现：消息、发送、聊天码、连接状态都由 ECardVisitorPage 注入。
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
  messages = [],
  loading = false,
  sending = false,
  hasMore = false,
  onLoadMore,
  onSend,
  onGetCode,
  connection = 'idle',
  error = '',
}) {
  const [draft, setDraft] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [connIssue, setConnIssue] = useState(false);
  const listRef = useRef(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  // 断线提示延迟 3 秒出现：避免刚进入（首次连线上线中）就闪一下「連線中斷」
  useEffect(() => {
    if (connection !== 'disconnected') {
      setConnIssue(false);
      return undefined;
    }
    const timer = setTimeout(() => setConnIssue(true), 3000);
    return () => clearTimeout(timer);
  }, [connection]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    onSend?.(text);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  async function handleCopyCode() {
    if (!chatCode) return;
    try {
      await navigator.clipboard.writeText(chatCode);
    } catch { /* 剪貼板不可用時仍給出提示 */ }
    setCodeCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCodeCopied(false), 1500);
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
          <button type="button" className="ecard-callButton" disabled={!callEnabled} onClick={() => onCall?.(false)} style={callButtonStyle(callEnabled)}>
            <Headphones size={16} style={{ marginRight: 6 }} />
            語音
          </button>
          <button type="button" className="ecard-callButton" disabled={!callEnabled} onClick={() => onCall?.(true)} style={callButtonStyle(callEnabled)}>
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
              {codeCopied ? '已複製' : chatCode}
            </button>
          ) : (
            <button type="button" className="ecard-chatCode is-empty" onClick={onGetCode} title="取得聊天碼（用於換裝置後找回本次對話）">
              <KeyRound size={13} />
              取得聊天碼
            </button>
          )}
        </header>

        <div className="ecard-chatMessages" ref={listRef}>
          {hasMore ? (
            <button type="button" className="ecard-chatLoadMore" onClick={onLoadMore} disabled={loading}>
              {loading ? '載入中…' : '載入更早的訊息'}
            </button>
          ) : null}

          {messages.length === 0 ? (
            <div className="ecard-chatEmpty">
              <MessageSquareDashed size={30} />
              <div>{loading ? '載入中…' : '尚無訊息，輸入您的問題即可開始諮詢'}</div>
            </div>
          ) : (
            messages.map((item) => {
              if (item.senderType === 'system') {
                return <div key={item.id} className="ecard-chatSystem">{item.content}</div>;
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

        {connIssue ? (
          <div className="ecard-chatConnBar">連線中斷，正在重新連線…</div>
        ) : null}

        {error ? <div className="ecard-chatConnBar is-error">{error}</div> : null}

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
          <button type="button" className="ecard-chatSend" disabled={!draft.trim() || sending} onClick={handleSend}>
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
