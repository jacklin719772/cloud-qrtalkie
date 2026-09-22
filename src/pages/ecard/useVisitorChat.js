import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  chatApi,
  createVisitorChatSocket,
  loadHiddenIds,
  loadStoredCode,
  loadStoredContact,
  saveHiddenIds,
  saveStoredCode,
  saveStoredContact,
} from './ecardChatApi';

const PAGE_SIZE = 50;

/**
 * 访客聊天会话：登记结果落地 → 历史 → 实时（WS）→ 发送 → 已读 → 聊天码。
 * 只负责数据与连接，UI 由 ECardChatPanel 呈现。
 */
export function useVisitorChat(slug) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [serverMessages, setServerMessages] = useState([]);
  const [hiddenIds, setHiddenIds] = useState(() => loadHiddenIds(slug));
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [connection, setConnection] = useState('idle');
  const [agentStatus, setAgentStatus] = useState('unknown'); // available | unavailable | unknown
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null); // null=无上传；0~100 上传中

  const socketRef = useRef(null);
  const tokenRef = useRef('');
  const oldestSeqRef = useRef(0);
  const audioUrlRef = useRef(new Map());
  tokenRef.current = session?.accessToken || '';

  useEffect(() => {
    setCode(loadStoredCode(slug));
    setHiddenIds(loadHiddenIds(slug));
  }, [slug]);

  /** 登记弹窗完成后进入聊天（session 来自 chat-register / chat-resume） */
  const start = useCallback(({ session: nextSession, contact, code: nextCode }) => {
    saveStoredContact(slug, contact);
    if (nextCode) saveStoredCode(slug, nextCode);
    if (nextCode) setCode(nextCode);
    setDialogOpen(false);
    setSession(nextSession || null);
    setAgentStatus(nextSession?.agentStatus?.state || 'unknown');
    setError('');
  }, [slug]);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  /** 拉取历史；before 为空取最新一页 */
  const fetchHistory = useCallback(async (before) => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    try {
      const data = await chatApi.history(slug, token, before ? { before, limit: PAGE_SIZE } : { limit: PAGE_SIZE });
      const list = Array.isArray(data?.messages) ? data.messages : [];
      if (data?.agentStatus?.state) setAgentStatus(data.agentStatus.state);
      setServerMessages((prev) => (before ? [...list, ...prev] : list));
      setHasMore(list.length >= PAGE_SIZE);
      if (!before) {
        oldestSeqRef.current = list.length ? Number(list[0].seq) || 0 : 0;
        const lastSeq = list.length ? Number(list[list.length - 1].seq) || 0 : 0;
        setError('');
        if (lastSeq > 0) chatApi.markRead(slug, token, lastSeq).catch(() => {});
      } else if (list.length) {
        oldestSeqRef.current = Number(list[0].seq) || oldestSeqRef.current;
      }
    } catch (err) {
      setError(err?.message || '訊息載入失敗');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadMore = useCallback(() => fetchHistory(oldestSeqRef.current || undefined), [fetchHistory]);

  /** 进入聊天：拉历史 + 建连（离开或换会话时清理） */
  useEffect(() => {
    if (!session?.accessToken) return undefined;
    let cancelled = false;
    fetchHistory();

    const close = createVisitorChatSocket({
      slug,
      getToken: () => tokenRef.current,
      onStateChange: (state) => { if (!cancelled) setConnection(state); },
      onEvent: (frame) => {
        if (cancelled) return;
        if (frame.type === 'ca.message.new' && frame.data) {
          const incoming = frame.data;
          setServerMessages((prev) => (prev.some((item) => item.id === incoming.id) ? prev : [...prev, incoming]));
          const seq = Number(incoming.seq) || 0;
          if (seq > 0 && incoming.senderType !== 'visitor') {
            chatApi.markRead(slug, tokenRef.current, seq).catch(() => {});
          }
        } else if (frame.type === 'ca.message.deleted' && frame.data?.messageId) {
          // 对方撤回/删除：本地实时移除
          const removedId = Number(frame.data.messageId);
          setServerMessages((prev) => prev.filter((item) => item.id !== removedId));
        } else if (frame.type === 'ca.message.read' && frame.data?.by === 'agent') {
          // 只有「客服读了」才把我发的消息刷成已读（自己读的不能算）
          const upto = Number(frame.data?.uptoSeq) || 0;
          if (upto > 0) {
            const stamp = new Date().toISOString();
            setServerMessages((prev) => prev.map((item) => (
              item.senderType === 'visitor' && Number(item.seq) <= upto && !item.readAt
                ? { ...item, readAt: stamp }
                : item
            )));
          }
        } else if (frame.type === 'ca.message.delivered' && frame.data?.by === 'agent') {
          // 同上：送达也只认客服侧的回执
          const upto = Number(frame.data?.uptoSeq) || 0;
          if (upto > 0) {
            const stamp = new Date().toISOString();
            setServerMessages((prev) => prev.map((item) => (
              item.senderType === 'visitor' && Number(item.seq) <= upto && !item.deliveredAt
                ? { ...item, deliveredAt: stamp }
                : item
            )));
          }
        } else if (frame.type === 'ca.agent.available') {
          setAgentStatus('available');
        } else if (frame.type === 'ca.agent.unavailable') {
          setAgentStatus('unavailable');
        }
      },
    });
    socketRef.current = close;

    return () => {
      cancelled = true;
      close();
      socketRef.current = null;
      setConnection('idle');
    };
  }, [session?.accessToken, slug, fetchHistory]);

  /** 发送成功返回 true（由面板决定是否清空输入框，失败时保留文案并给出错误） */
  const send = useCallback(async (text) => {
    const token = tokenRef.current;
    const content = String(text || '').trim();
    if (!content || sending) return false;
    if (!token) {
      setError('連線已過期，請重新整理頁面後再試');
      return false;
    }
    setSending(true);
    try {
      const clientMsgId = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await chatApi.send(slug, token, { content, clientMsgId });
      const message = result?.message;
      if (message) {
        setServerMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      } else {
        await fetchHistory();
      }
      setError('');
      return true;
    } catch (err) {
      setError(err?.message || '訊息發送失敗');
      return false;
    } finally {
      setSending(false);
    }
  }, [slug, sending, fetchHistory]);

  /** 撤回自己的消息：服务端真删（双方不可见）+ 本地移除 */
  const recallMessage = useCallback(async (message) => {
    const token = tokenRef.current;
    const messageId = Number(message?.id) || 0;
    if (!token || !messageId) return false;
    try {
      await chatApi.recallMessage(slug, token, messageId);
      setServerMessages((prev) => prev.filter((item) => item.id !== messageId));
      setError('');
      return true;
    } catch (err) {
      setError(err?.message || '撤回失敗');
      return false;
    }
  }, [slug]);

  /** 删除（仅对自己隐藏）：本地记 id，对方仍可见；重新进入也保持隐藏 */
  const hideMessage = useCallback((message) => {
    const messageId = Number(message?.id) || 0;
    if (!messageId) return;
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      saveHiddenIds(slug, next);
      return next;
    });
  }, [slug]);

  /** 对外可见的消息列表（过滤掉仅自己隐藏的） */
  const messages = useMemo(
    () => serverMessages.filter((item) => !hiddenIds.has(Number(item.id))),
    [serverMessages, hiddenIds],
  );

  /** 更换聊天码（旧码立即失效；服务端只存哈希，无法再次下发） */
  const rotateCode = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const result = await chatApi.rotateCode(slug, token);
      if (result?.resumeCode) {
        setCode(result.resumeCode);
        saveStoredCode(slug, result.resumeCode);
      }
    } catch (err) {
      setError(err?.message || '聊天碼更新失敗');
    }
  }, [slug]);

  /** 图片/文件：上传后按服务端判定的 kind 发 image/file 消息 */
  const sendAttachment = useCallback(async ({ blob, fileName, mimeType }) => {
    const token = tokenRef.current;
    if (!blob) return false;
    if (sending) {
      setError('上一則訊息還在傳送中，請稍候');
      return false;
    }
    if (!token) {
      setError('連線已過期，請重新整理頁面後再試');
      return false;
    }
    setSending(true);
    setUploadProgress(0);
    try {
      const uploaded = await chatApi.uploadAttachment(slug, token, {
        blob, fileName, mimeType, onProgress: (percent) => setUploadProgress(percent),
      });
      const key = uploaded?.key;
      if (!key) throw new Error('檔案上傳失敗');
      const contentType = uploaded?.kind === 'image' || uploaded?.kind === 'sticker' ? 'image' : 'file';
      const clientMsgId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await chatApi.sendAttachment(slug, token, {
        key,
        // 展示端（App/网页）看到的是这里传的原始文件名，不传就会退回随机存储名
        fileName,
        mimeType,
        contentType,
        clientMsgId,
      });
      const message = result?.message;
      if (message) {
        setServerMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      } else {
        await fetchHistory();
      }
      setError('');
      return true;
    } catch (err) {
      setError(err?.message || '檔案發送失敗');
      return false;
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  }, [slug, sending, fetchHistory]);

  /** 语音消息：上传录音（base64）→ 发 contentType=audio 的消息 */
  const sendVoice = useCallback(async ({ blob, mimeType, fileName, durationMs }) => {
    const token = tokenRef.current;
    if (!token || !blob || sending) return false;
    setSending(true);
    try {
      const uploaded = await chatApi.uploadVoice(slug, token, { blob, fileName, mimeType, durationMs });
      const key = uploaded?.key;
      if (!key) throw new Error('語音上傳失敗');
      const clientMsgId = `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await chatApi.sendVoice(slug, token, { key, fileName, durationMs, clientMsgId });
      const message = result?.message;
      if (message) {
        setServerMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
      } else {
        await fetchHistory();
      }
      setError('');
      return true;
    } catch (err) {
      setError(err?.message || '語音發送失敗');
      return false;
    } finally {
      setSending(false);
    }
  }, [slug, sending, fetchHistory]);

  /** 下载附件（带进度）：返回 blob，由面板触发保存 */
  const downloadAttachment = useCallback(async (message, onProgress) => {
    const attachmentId = Number(message?.attachment?.id) || 0;
    if (!attachmentId) return null;
    return chatApi.downloadAttachment(slug, tokenRef.current, attachmentId, { onProgress });
  }, [slug]);

  /** 语音气泡播放：附件需带 Bearer 取回，转成 objectURL 并缓存（卸载时释放） */
  const loadAudioUrl = useCallback(async (message) => {
    const attachmentId = message?.attachment?.id;
    if (!attachmentId) return null;
    const cached = audioUrlRef.current.get(attachmentId);
    if (cached) return cached;
    const blob = await chatApi.fetchAttachmentBlob(slug, tokenRef.current, attachmentId);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current.set(attachmentId, url);
    return url;
  }, [slug]);

  useEffect(() => () => {
    for (const url of audioUrlRef.current.values()) {
      try { URL.revokeObjectURL(url); } catch { /* 忽略 */ }
    }
    audioUrlRef.current.clear();
  }, []);

  // 看门狗：任何原因（含读文件阶段）导致 sending 卡住时自动复位，避免输入区整体失效
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setTimeout(() => {
      setSending(false);
      setError('傳送逾時，請重新整理頁面後重試');
    }, 150000);
    return () => clearTimeout(timer);
  }, [sending]);

  const statusTone = agentStatus === 'available' ? 'is-ok' : 'is-warn';
  const statusText = agentStatus === 'available'
    ? '在線'
    : agentStatus === 'unavailable' ? '離線，可先留言' : '狀態未知';

  return {
    dialogOpen, openDialog, closeDialog, start,
    session, messages, loading, sending, hasMore, loadMore, send, sendVoice, sendAttachment, loadAudioUrl,
    connection, agentStatus, code, rotateCode, error, uploadProgress,
    recallMessage, hideMessage, downloadAttachment,
    statusTone, statusText,
    storedContact: loadStoredContact(slug),
    storedCode: loadStoredCode(slug),
  };
}
