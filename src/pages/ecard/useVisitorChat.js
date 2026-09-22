import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chatApi,
  createVisitorChatSocket,
  loadStoredCode,
  loadStoredContact,
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
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [connection, setConnection] = useState('idle');
  const [agentStatus, setAgentStatus] = useState('unknown'); // available | unavailable | unknown
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const socketRef = useRef(null);
  const tokenRef = useRef('');
  const oldestSeqRef = useRef(0);
  tokenRef.current = session?.accessToken || '';

  useEffect(() => {
    setCode(loadStoredCode(slug));
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
      setMessages((prev) => (before ? [...list, ...prev] : list));
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
          setMessages((prev) => (prev.some((item) => item.id === incoming.id) ? prev : [...prev, incoming]));
          const seq = Number(incoming.seq) || 0;
          if (seq > 0 && incoming.senderType !== 'visitor') {
            chatApi.markRead(slug, tokenRef.current, seq).catch(() => {});
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
        setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
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

  const statusTone = agentStatus === 'available' ? 'is-ok' : 'is-warn';
  const statusText = agentStatus === 'available'
    ? '客服在線'
    : agentStatus === 'unavailable' ? '客服離線，可先留言' : '狀態未知';

  return {
    dialogOpen, openDialog, closeDialog, start,
    session, messages, loading, sending, hasMore, loadMore, send,
    connection, agentStatus, code, rotateCode, error,
    statusTone, statusText,
    storedContact: loadStoredContact(slug),
    storedCode: loadStoredCode(slug),
  };
}
