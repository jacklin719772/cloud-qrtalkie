import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones, KeyRound, MessageSquareDashed, Mic, Paperclip, Pause, Play, Send, Trash2, Video } from 'lucide-react';
import './ecardChatTheme.css';

const MAX_RECORD_MS = 60000;

/** 录音容器优先级：mp4/AAC（iPhone 也能播）→ webm/opus（Android 兜底） */
function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  return candidates.find((type) => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  }) || '';
}

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
  onSendVoice,
  onLoadAudio,
  onGetCode,
  connection = 'idle',
  error = '',
}) {
  const [draft, setDraft] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [connIssue, setConnIssue] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState('');
  const listRef = useRef(null);
  const copyTimerRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const sendOnStopRef = useRef(false);
  const streamRef = useRef(null);

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

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    // 发送成功才清空：失败时保留文案（错误条会说明原因），避免静默丢消息
    const ok = await onSend?.(text);
    if (ok) setDraft('');
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

  function releaseRecorder() {
    clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => { try { track.stop(); } catch { /* 忽略 */ } });
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordSeconds(0);
  }

  async function startRecording() {
    if (recording || sending) return;
    setRecordError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecordError('此瀏覽器不支援錄音，請改用文字訊息');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const elapsed = Math.min(Date.now() - recordStartRef.current, MAX_RECORD_MS);
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const shouldSend = sendOnStopRef.current;
        const blob = new Blob(chunksRef.current, { type });
        releaseRecorder();
        if (!shouldSend || !blob.size) return;
        const baseMime = String(type).split(';')[0].trim();
        const fileName = baseMime === 'audio/mp4' ? `voice-${Date.now()}.m4a` : `voice-${Date.now()}.weba`;
        await onSendVoice?.({ blob, mimeType: baseMime, fileName, durationMs: elapsed });
      };

      recordStartRef.current = Date.now();
      sendOnStopRef.current = false;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - recordStartRef.current) / 1000);
        setRecordSeconds(seconds);
        if (Date.now() - recordStartRef.current >= MAX_RECORD_MS) stopRecording(true);
      }, 250);
    } catch (err) {
      releaseRecorder();
      setRecordError(err?.name === 'NotAllowedError'
        ? '麥克風權限被拒絕，請在瀏覽器設定中允許後重試'
        : '無法啟動錄音，請確認裝置麥克風可用');
    }
  }

  function stopRecording(shouldSend) {
    sendOnStopRef.current = Boolean(shouldSend);
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      releaseRecorder();
      return;
    }
    try { recorder.stop(); } catch { releaseRecorder(); }
  }

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop(); } catch { /* 忽略 */ }
    streamRef.current?.getTracks().forEach((track) => { try { track.stop(); } catch { /* 忽略 */ } });
  }, []);

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
              const isAudio = item.contentType === 'audio' && item.attachment;
              return (
                <div key={item.id} className={`ecard-chatMsg ${isVisitor ? 'is-visitor' : 'is-agent'}`}>
                  {isAudio ? (
                    <AudioBubble message={item} onLoadAudio={onLoadAudio} />
                  ) : (
                    <div className="ecard-chatBubble">{item.content}</div>
                  )}
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
          {recording ? (
            <>
              <span className="ecard-chatRecDot" />
              <span className="ecard-chatRecTime">{formatDuration(recordSeconds * 1000)}</span>
              <span className="ecard-chatRecHint">錄音中，最多 60 秒</span>
              <button
                type="button"
                className="ecard-chatIconButton"
                onClick={() => stopRecording(false)}
                title="取消錄音"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                className="ecard-chatSend"
                onClick={() => stopRecording(true)}
                disabled={recordSeconds < 1}
              >
                <Send size={15} style={{ marginRight: 6 }} />
                發送
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ecard-chatIconButton" disabled title="附件（待接入）">
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                className="ecard-chatIconButton"
                onClick={startRecording}
                disabled={sending}
                title="按住說話（錄音發送）"
              >
                <Mic size={16} />
              </button>
              <textarea
                className="ecard-chatInput"
                rows={1}
                value={draft}
                placeholder="輸入訊息…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  // 手机键盘弹出后视口变矮，延迟一点再滚到底，保证输入框与最新消息可见
                  setTimeout(() => {
                    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
                  }, 250);
                }}
              />
              <button type="button" className="ecard-chatSend" disabled={!draft.trim() || sending} onClick={handleSend}>
                <Send size={15} style={{ marginRight: 6 }} />
                發送
              </button>
            </>
          )}
        </div>

        {recordError ? <div className="ecard-chatConnBar is-error">{recordError}</div> : null}
      </section>
    </div>
  );
}

/** 语音气泡：播放/暂停 + 进度条 + 时长（附件需带 token 取回，这里走 onLoadAudio） */
function AudioBubble({ message, onLoadAudio }) {
  const [state, setState] = useState('idle'); // idle | loading | playing | error
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const urlRef = useRef('');

  const durationMs = Number(message?.attachment?.durationMs || 0) || 0;

  async function handleToggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (state === 'playing') {
      audio.pause();
      return;
    }
    try {
      if (!urlRef.current) {
        setState('loading');
        const url = await onLoadAudio?.(message);
        if (!url) throw new Error('missing url');
        urlRef.current = url;
        audio.src = url;
      }
      await audio.play();
    } catch {
      setState('error');
    }
  }

  return (
    <div className="ecard-chatVoice">
      <button type="button" className="ecard-chatVoiceButton" onClick={handleToggle} aria-label="播放語音">
        {state === 'playing' ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <span className="ecard-chatVoiceBar">
        <span className="ecard-chatVoiceProgress" style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
      <span className="ecard-chatVoiceTime">
        {state === 'error' ? '載入失敗' : formatDuration(durationMs)}
      </span>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setState('playing')}
        onPause={() => setState('idle')}
        onEnded={() => { setState('idle'); setProgress(0); }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration && Number.isFinite(el.duration)) setProgress(el.currentTime / el.duration);
        }}
        onError={() => setState('error')}
      />
    </div>
  );
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function callButtonStyle(enabled) {  return {
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
