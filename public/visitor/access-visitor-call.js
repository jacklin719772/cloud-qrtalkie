/**
 * Access Visitor - dedicated WebRTC Voice/Video calling module.
 * Self-contained and independent from ECard code.
 */
(function () {
  'use strict';

  var JsSIP = null;
  var ua = null;
  var currentSession = null;
  var currentPeerConnection = null;
  var localStream = null;
  var callSessionData = null;
  var originalSend = null;
  var isIntentionalHangup = false;
  var activeCall = false;
  var isVideoCall = false;
  var pendingRoomData = null;
  var pendingCallType = 'voice';
  var callUpgradeTimer = null;
  var callStartTime = 0;
  var callTimerInterval = null;
  var videoUpgradeInProgress = false;

  var callOverlay = document.getElementById('callOverlay');
  var callStatusEl = document.getElementById('callStatusText');
  var callRoomEl = document.getElementById('callRoomLabel');
  var callTimerEl = document.getElementById('callTimer');
  var btnHangup = document.getElementById('btnHangup');
  var btnToggleVideo = document.getElementById('btnToggleVideo');
  var localVideo = document.getElementById('localVideo');
  var remoteVideo = document.getElementById('remoteVideo');
  var remoteAudio = document.getElementById('remoteAudio');
  var callErrorEl = document.getElementById('callError');
  var webStatusDot = document.getElementById('webStatusDot');
  var webStatusText = document.getElementById('webStatusText');
  var sipStatusDot = document.getElementById('sipStatusDot');
  var sipStatusText = document.getElementById('sipStatusText');
  var btnRefreshCallSip = document.getElementById('btnRefreshSip');

  var confirmOverlay = document.getElementById('accessCallConfirm');
  var confirmTitleEl = document.getElementById('accessConfirmTitle');
  var confirmRoomEl = document.getElementById('accessConfirmRoom');
  var confirmResidentEl = document.getElementById('accessConfirmResident');
  var confirmHintEl = document.getElementById('accessConfirmHint');
  var confirmVoiceBtn = document.getElementById('accessConfirmVoiceBtn');
  var confirmVideoBtn = document.getElementById('accessConfirmVideoBtn');
  var confirmCancelBtn = document.getElementById('accessConfirmCancelBtn');
  var confirmWebDot = document.getElementById('confirmWebDot');
  var confirmWebText = document.getElementById('confirmWebText');
  var confirmSipDot = document.getElementById('confirmSipDot');
  var confirmSipText = document.getElementById('confirmSipText');
  var confirmCountdownEl = document.getElementById('accessConfirmCountdown');
  var confirmRefreshSip = document.getElementById('confirmRefreshSip');
  var confirmRefreshWeb = document.getElementById('confirmRefreshWeb');
  var confirmSubHintEl = document.getElementById('accessConfirmSubHint');

  var confirmCountdownTimer = null;
  var confirmCountdownSeconds = 0;
  var CONFIRM_TIMEOUT_SECONDS = 10;

  function logSafe(label, extra) {
    try {
      console.log('[AccessVisitorCall] ' + label, extra || {});
    } catch (err) {}
  }

  function updateTimer() {
    if (!callStartTime || !callTimerEl) return;
    var sec = Math.floor((Date.now() - callStartTime) / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    callTimerEl.textContent = (m < 10 ? '0' + m : String(m)) + ':' + (s < 10 ? '0' + s : String(s));
  }

  function startTimer() {
    callStartTime = Date.now();
    if (callTimerEl) callTimerEl.textContent = '00:00';
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    callStartTime = 0;
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    if (callTimerEl) callTimerEl.textContent = '';
  }

  function setCallStatus(text, isError) {
    if (callStatusEl) {
      callStatusEl.textContent = text || '';
      callStatusEl.style.color = isError ? '#ef4444' : '#e5e7eb';
    }
    if (callErrorEl) {
      callErrorEl.textContent = isError ? (text || '') : '';
      callErrorEl.style.display = isError ? 'block' : 'none';
    }
    logSafe('status', { text: text || '', isError: Boolean(isError) });
  }

  function setCallWebStatus(state) {
    if (!webStatusDot || !webStatusText) return;
    if (state === 'registered') { webStatusDot.style.background = '#22c55e'; webStatusText.textContent = 'Web 已註冊'; }
    else if (state === 'registering') { webStatusDot.style.background = '#f59e0b'; webStatusText.textContent = 'Web 註冊中'; }
    else { webStatusDot.style.background = '#ef4444'; webStatusText.textContent = 'Web 失敗'; }
  }

  function setCallSipStatus(online) {
    if (!sipStatusDot || !sipStatusText) return;
    if (online) { sipStatusDot.style.background = '#22c55e'; sipStatusText.textContent = 'SIP 在線'; }
    else { sipStatusDot.style.background = '#6b7280'; sipStatusText.textContent = 'SIP 離線'; }
    if (btnRefreshCallSip) btnRefreshCallSip.style.display = '';
  }

  function refreshCallSipStatus() {
    if (!pendingRoomData || !callSessionData) return;
    if (btnRefreshCallSip) { btnRefreshCallSip.style.display = 'none'; sipStatusDot.style.background = '#f59e0b'; sipStatusText.textContent = 'SIP 查詢中'; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/access/room-sip-status?roomId=' + pendingRoomData.roomId + '&lockId=' + pendingRoomData.lockId);
    xhr.onload = function () { try { var r = JSON.parse(xhr.responseText); setCallSipStatus(r.data?.sipOnline); } catch(e) { setCallSipStatus(false); } };
    xhr.onerror = function () { setCallSipStatus(false); };
    xhr.send();
  }

  function showCallUI() {
    if (callOverlay) callOverlay.style.display = 'flex';
    if (callErrorEl) callErrorEl.style.display = 'none';
  }

  function hideCallUI() {
    if (callOverlay) callOverlay.style.display = 'none';
    if (btnToggleVideo) {
      btnToggleVideo.style.display = 'none';
      btnToggleVideo.textContent = '📹';
    }
    if (localVideo) {
      localVideo.srcObject = null;
      localVideo.style.display = 'none';
    }
    if (remoteVideo) {
      remoteVideo.srcObject = null;
      remoteVideo.style.display = 'none';
    }
    isVideoCall = false;
  }

  function updateConfirmCountdown() {
    if (!confirmCountdownEl) return;
    confirmCountdownSeconds--;
    if (confirmCountdownSeconds <= 0) {
      clearConfirmCountdown();
      confirmCountdownEl.textContent = '';
      confirmCountdownEl.style.color = '#f1d37a';
      cancelConfirm();
      return;
    }
    confirmCountdownEl.textContent = confirmCountdownSeconds + ' 秒後自動關閉';
    confirmCountdownEl.style.color = confirmCountdownSeconds <= 3 ? '#ef4444' : '#f1d37a';
  }

  function startConfirmCountdown() {
    clearConfirmCountdown();
    confirmCountdownSeconds = CONFIRM_TIMEOUT_SECONDS;
    if (confirmCountdownEl) {
      confirmCountdownEl.textContent = confirmCountdownSeconds + ' 秒後自動關閉';
      confirmCountdownEl.style.color = '#f1d37a';
    }
    confirmCountdownTimer = setInterval(updateConfirmCountdown, 1000);
  }

  function clearConfirmCountdown() {
    if (confirmCountdownTimer) { clearInterval(confirmCountdownTimer); confirmCountdownTimer = null; }
    confirmCountdownSeconds = 0;
    if (confirmCountdownEl) confirmCountdownEl.textContent = '';
  }

  function showConfirmModal(roomData, callType) {
    pendingRoomData = roomData || null;
    pendingCallType = callType === 'video' ? 'video' : 'voice';
    if (!confirmOverlay) return;

    if (confirmTitleEl) {
      confirmTitleEl.textContent = pendingCallType === 'video' ? '確認視訊呼叫' : '確認語音呼叫';
    }
    if (confirmRoomEl) {
      confirmRoomEl.textContent = (roomData?.roomDisplay || roomData?.roomNumber || '') + (roomData?.roomDisplay ? '' : '室');
    }
    if (confirmResidentEl) {
      confirmResidentEl.textContent = '';
    }
    if (confirmHintEl) {
      confirmHintEl.textContent = pendingCallType === 'video'
        ? '確定要向該房間發起視訊呼叫嗎？'
        : '確定要向該房間發起語音呼叫嗎？';
    }
    if (confirmVoiceBtn) {
      confirmVoiceBtn.style.display = pendingCallType === 'voice' ? 'inline-flex' : 'none';
      confirmVoiceBtn.textContent = '確認';
    }
    if (confirmVideoBtn) {
      confirmVideoBtn.style.display = pendingCallType === 'video' ? 'inline-flex' : 'none';
      confirmVideoBtn.textContent = '開始視訊';
    }
    if (confirmOverlay) confirmOverlay.style.display = 'flex';

    // Init status indicators
    setConfirmWebStatus('registering');
    setConfirmSipLoading();
    fetchConfirmSipStatus();

    // Fetch call session and register Web account immediately
    fetchCallSessionForConfirm(roomData, callType);
  }

  function setConfirmWebStatus(state) {
    if (!confirmWebDot || !confirmWebText) return;
    if (state === 'registered') {
      confirmWebDot.style.background = '#22c55e';
      confirmWebText.textContent = 'Web 已註冊';
      if (confirmRefreshWeb) confirmRefreshWeb.style.display = 'none';
      if (confirmVoiceBtn) { confirmVoiceBtn.disabled = false; confirmVoiceBtn.style.opacity = '1'; }
      if (confirmVideoBtn) { confirmVideoBtn.disabled = false; confirmVideoBtn.style.opacity = '1'; }
      if (confirmSubHintEl) confirmSubHintEl.textContent = '';
    } else if (state === 'registering') {
      confirmWebDot.style.background = '#f59e0b';
      confirmWebText.textContent = 'Web 註冊中';
      if (confirmRefreshWeb) confirmRefreshWeb.style.display = 'none';
      if (confirmVoiceBtn) { confirmVoiceBtn.disabled = true; confirmVoiceBtn.style.opacity = '0.5'; }
      if (confirmVideoBtn) { confirmVideoBtn.disabled = true; confirmVideoBtn.style.opacity = '0.5'; }
      if (confirmSubHintEl) confirmSubHintEl.textContent = 'Web 註冊成功後可發起呼叫';
    } else {
      confirmWebDot.style.background = '#ef4444';
      confirmWebText.textContent = 'Web 註冊失敗';
      if (confirmRefreshWeb) confirmRefreshWeb.style.display = '';
      if (confirmVoiceBtn) { confirmVoiceBtn.disabled = true; confirmVoiceBtn.style.opacity = '0.5'; }
      if (confirmVideoBtn) { confirmVideoBtn.disabled = true; confirmVideoBtn.style.opacity = '0.5'; }
      if (confirmSubHintEl) confirmSubHintEl.textContent = '註冊失敗，請點擊 ↻ 重試';
    }
  }

  function setConfirmSipLoading() {
    if (confirmRefreshSip) confirmRefreshSip.style.display = 'none';
    if (confirmSipDot) confirmSipDot.style.background = '#f59e0b';
    if (confirmSipText) confirmSipText.textContent = '狀態查詢中';
  }

  var confirmCallSessionData = null;

  function fetchCallSessionForConfirm(roomData, callType) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/access/room-call-session');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      try {
        var res = JSON.parse(xhr.responseText);
        var normalized = res && res.success ? res.data : null;
        if (normalized && normalized.webAccount) {
          confirmCallSessionData = normalized;
          // Start Web registration
          initUAForConfirm(roomData, callType);
        } else {
          setConfirmWebStatus('failed');
          if (confirmHintEl) confirmHintEl.textContent = (res && res.message) || '無法取得通話配置，請稍後再試。';
        }
      } catch (e) {
        setConfirmWebStatus('failed');
        if (confirmHintEl) confirmHintEl.textContent = '服務回應異常，請稍後再試。';
      }
    };
    xhr.onerror = function () {
      setConfirmWebStatus('failed');
      if (confirmHintEl) confirmHintEl.textContent = '網絡錯誤，請稍後再試。';
    };
    xhr.send(JSON.stringify({ roomId: roomData.roomId, lockId: roomData.lockId }));
  }

  function initUAForConfirm(roomData, callType) {
    if (ua) { try { ua.stop(); } catch (e) {} ua = null; }
    var data = confirmCallSessionData;
    if (!data) return;

    ensureJsSIPLoaded().then(function (JS) {
      if (!JS) { setConfirmWebStatus('failed'); return; }
      var socket = new JS.WebSocketInterface(data.wssUrl);
      ua = new JS.UA({
        sockets: [socket],
        uri: 'sip:' + data.webAccount + '@' + data.webrtcDomain,
        password: data.credential.value,
        register: true,
      });
      ua.on('registered', function () {
        setConfirmWebStatus('registered');
        setCallSipStatus(data.sipOnline);
        startConfirmCountdown();
      });
      ua.on('registrationFailed', function () { setConfirmWebStatus('failed'); });
      ua.on('disconnected', function () { setConfirmWebStatus('failed'); });
      ua.start();
    });
  }

  function setConfirmSipStatus(online) {
    if (!confirmSipDot || !confirmSipText) return;
    if (online) { confirmSipDot.style.background = '#22c55e'; confirmSipText.textContent = '在線'; }
    else { confirmSipDot.style.background = '#6b7280'; confirmSipText.textContent = '離線'; }
    if (confirmRefreshSip) confirmRefreshSip.style.display = '';
  }

  function fetchConfirmSipStatus() {
    if (!pendingRoomData || !pendingRoomData.roomId || !pendingRoomData.lockId) return;
    if (confirmRefreshSip) confirmRefreshSip.style.display = 'none';
    if (confirmSipDot) confirmSipDot.style.background = '#f59e0b';
    if (confirmSipText) confirmSipText.textContent = 'SIP 查詢中';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/access/room-sip-status?roomId=' + pendingRoomData.roomId + '&lockId=' + pendingRoomData.lockId);
    xhr.onload = function () {
      try { var r = JSON.parse(xhr.responseText); setConfirmSipStatus(r.data?.sipOnline); } catch(e) { setConfirmSipStatus(false); }
    };
    xhr.onerror = function () { setConfirmSipStatus(false); };
    xhr.send();
  }

  function refreshConfirmSip() {
    fetchConfirmSipStatus();
  }

  function retryConfirmWeb() {
    if (!pendingRoomData) return;
    setConfirmWebStatus('registering');
    fetchCallSessionForConfirm(pendingRoomData, pendingCallType);
  }

  function hideConfirmModal() {
    if (confirmOverlay) confirmOverlay.style.display = 'none';
  }

  function resetCallState() {
    pendingRoomData = null;
    pendingCallType = 'voice';
    videoUpgradeInProgress = false;
    if (callUpgradeTimer) {
      clearTimeout(callUpgradeTimer);
      callUpgradeTimer = null;
    }
  }

  function cleanupCall() {
    if (currentSession) {
      try { currentSession.terminate(); } catch (e) {}
      currentSession = null;
    }
    if (ua) {
      isIntentionalHangup = true;
      try { ua.stop(); } catch (e) {}
      ua = null;
    }
    if (localStream) {
      try {
        localStream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
      } catch (e) {}
      localStream = null;
    }
    if (currentPeerConnection) {
      try { currentPeerConnection.oniceconnectionstatechange = null; } catch (e) {}
      try { currentPeerConnection.onconnectionstatechange = null; } catch (e) {}
      try { currentPeerConnection.ontrack = null; } catch (e) {}
      try { currentPeerConnection.onaddstream = null; } catch (e) {}
      try { currentPeerConnection.close(); } catch (e) {}
      currentPeerConnection = null;
    }
    activeCall = false;
    isVideoCall = false;
    callSessionData = null;
    stopTimer();
    hideCallUI();
    hideConfirmModal();
    resetCallState();
  }

  function hangup() {
    cleanupCall();
  }

  function toggleVideo() {
    if (!localStream) return;
    var videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    if (btnToggleVideo) btnToggleVideo.textContent = videoTrack.enabled ? '📹' : '📷';
  }

  function bindRemoteAudio(pc) {
    try {
      var receiver = (pc.getReceivers() || []).find(function (r) { return r.track && r.track.kind === 'audio'; });
      if (!receiver || !receiver.track || !remoteAudio) return;
      var stream = new MediaStream([receiver.track]);
      remoteAudio.srcObject = stream;
      remoteAudio.play().catch(function () {});
    } catch (err) {}
  }

  function secureContextCheck() {
    var mediaDevicesPresent = Boolean(navigator && navigator.mediaDevices);
    var getUserMediaPresent = Boolean(mediaDevicesPresent && navigator.mediaDevices.getUserMedia);
    logSafe('media capability', {
      isSecureContext: Boolean(window.isSecureContext),
      mediaDevicesPresent: mediaDevicesPresent,
      getUserMediaPresent: getUserMediaPresent,
    });

    if (!window.isSecureContext || !mediaDevicesPresent || !getUserMediaPresent) {
      if (!window.isSecureContext) {
        setCallStatus('瀏覽器不允許在非 HTTPS 頁面使用麥克風或攝像頭，請使用 HTTPS 訪問此門禁訪客頁面。', true);
      } else {
        setCallStatus('目前瀏覽器不支援語音/視頻通話，請更換瀏覽器後重試。', true);
      }
      return false;
    }
    return true;
  }

  function ensureJsSIPLoaded() {
    return new Promise(function (resolve) {
      logSafe('JsSIP load start', { windowJsSIPExists: Boolean(window.JsSIP) });
      if (window.JsSIP) {
        JsSIP = window.JsSIP;
        logSafe('JsSIP load success', { source: 'window.JsSIP', windowJsSIPExists: true });
        resolve(JsSIP);
        return;
      }
      var script = document.createElement('script');
      script.src = '/visitor-assets/jssip.min.js';
      script.onload = function () {
        JsSIP = window.JsSIP;
        logSafe('JsSIP load success', { source: 'local-bundle', windowJsSIPExists: Boolean(window.JsSIP) });
        resolve(JsSIP);
      };
      script.onerror = function () {
        logSafe('JsSIP load error', { src: script.src });
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }

  function injectSdpPatch(serverIp) {
    if (!ua || !ua.transport || !serverIp || originalSend) return;
    originalSend = ua.transport.send;
    ua.transport.send = function () {
      var args = Array.prototype.slice.call(arguments);
      if (args[0] && args[0].body) {
        args[0].body = args[0].body
          .replace(/IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, 'IN IP4 ' + serverIp)
          .replace(/c=IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, 'c=IN IP4 ' + serverIp);
      }
      return originalSend.apply(this, args);
    };
  }

  function getMediaErrorMessage(error) {
    var errorName = error && error.name ? String(error.name) : '';
    if (errorName === 'NotAllowedError') {
      return '麥克風或攝像頭權限被拒絕，請在瀏覽器中允許權限後重試。';
    }
    if (errorName === 'NotFoundError') {
      return '未找到可用的麥克風或攝像頭設備。';
    }
    if (errorName === 'NotReadableError') {
      return '麥克風或攝像頭目前被其他應用佔用，請關閉其他應用後重試。';
    }
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return '瀏覽器不允許在非 HTTPS 頁面使用麥克風或攝像頭，請使用 HTTPS 訪問此門禁訪客頁面。';
    }
    return '無法訪問麥克風/攝像頭';
  }

  function bindPeerConnectionEvents(pc) {
    currentPeerConnection = pc;
    try {
      pc.oniceconnectionstatechange = function () {
        logSafe('ice state', { state: pc.iceConnectionState || '' });
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          bindRemoteAudio(pc);
        }
      };
    } catch (e) {}
    try {
      pc.onconnectionstatechange = function () {
        logSafe('connection state', { state: pc.connectionState || '' });
      };
    } catch (e) {}
    try {
      pc.onsignalingstatechange = function () {
        logSafe('signaling state', { state: pc.signalingState || '' });
      };
    } catch (e) {}
    try {
      pc.ontrack = function (evt) {
        if (!evt || !evt.track) return;
        if (evt.track.kind === 'video' && remoteVideo) {
          remoteVideo.srcObject = new MediaStream([evt.track]);
          remoteVideo.style.display = 'block';
        }
        if (evt.track.kind === 'audio') {
          bindRemoteAudio(pc);
        }
        logSafe('remote track', {
          kind: evt.track.kind,
          enabled: evt.track.enabled,
          muted: evt.track.muted,
          readyState: evt.track.readyState,
        });
      };
    } catch (e) {}
    try {
      pc.onaddstream = function (evt) {
        if (evt && evt.stream && remoteAudio) {
          remoteAudio.srcObject = evt.stream;
          remoteAudio.play().catch(function () {});
        }
      };
    } catch (e) {}
  }

  function logLocalTracks(stream, label) {
    var audioTracks = stream ? stream.getAudioTracks() : [];
    var videoTracks = stream ? stream.getVideoTracks() : [];
    logSafe(label, {
      localAudioTracks: audioTracks.length,
      localVideoTracks: videoTracks.length,
    });
  }

  function normalizeCallSessionResponse(raw) {
    var payload = raw && raw.data && raw.data.webAccount ? raw.data : raw;
    payload = payload || {};
    return {
      success: raw && raw.success === true || payload.success === true,
      webAccount: payload.webAccount || '',
      credential: payload.credential || null,
      webrtcDomain: payload.webrtcDomain || '',
      wssUrl: payload.wssUrl || '',
      targetSipUri: payload.targetSipUri || payload.targetUri || payload.sipUri || payload.calleeUri || '',
      iceServers: Array.isArray(payload.iceServers) ? payload.iceServers : [],
      enableVoice: payload.enableVoice !== false,
      enableVideo: payload.enableVideo === true,
      roomNumber: payload.roomNumber || payload.roomDisplayName || '',
      sipDomain: payload.sipDomain || '',
      sipServerPublicIp: payload.sipServerPublicIp || '',
    };
  }

  function validateCallSession(session, callType) {
    var hasWebAccount = Boolean(session && session.webAccount);
    var hasCredential = Boolean(session && session.credential && session.credential.value);
    var credentialLength = hasCredential ? String(session.credential.value).length : 0;
    var hasWssUrl = Boolean(session && session.wssUrl);
    var hasWebrtcDomain = Boolean(session && session.webrtcDomain);
    var hasTargetSipUri = Boolean(session && session.targetSipUri);
    var iceServersCount = Array.isArray(session && session.iceServers) ? session.iceServers.length : 0;
    var enableVoice = Boolean(session && session.enableVoice !== false);
    var enableVideo = Boolean(session && session.enableVideo === true);

    var requiredOk = hasWebAccount && hasCredential && hasWssUrl && hasWebrtcDomain && hasTargetSipUri;
    if (callType === 'video') {
      requiredOk = requiredOk && enableVideo;
    }
    if (!requiredOk) {
      logSafe('config validation failed', {
        hasWebAccount: hasWebAccount,
        hasCredential: hasCredential,
        credentialLength: credentialLength,
        hasWssUrl: hasWssUrl,
        hasWebrtcDomain: hasWebrtcDomain,
        hasTargetSipUri: hasTargetSipUri,
        iceServersCount: iceServersCount,
        enableVoice: enableVoice,
        enableVideo: enableVideo,
        callType: callType || 'voice',
      });
    }
    return requiredOk;
  }

  function startTimerIfNeeded() {
    if (!callStartTime) startTimer();
  }

  function prepareAndCall(roomData, callType) {
    if (activeCall) return;
    if (!callSessionData) {
      setCallStatus('呼叫配置未就緒', true);
      return;
    }

    if (!validateCallSession(callSessionData, callType)) {
      setCallStatus('呼叫配置未就緒', true);
      return;
    }

    if (callType === 'video' && !callSessionData.enableVideo) {
      setCallStatus('目前未開放視訊呼叫', true);
      return;
    }
    if (callType !== 'video' && !callSessionData.enableVoice) {
      setCallStatus('目前未開放語音呼叫', true);
      return;
    }

    if (!secureContextCheck()) {
      return;
    }

    isVideoCall = Boolean(callType === 'video' && callSessionData.enableVideo);
    activeCall = true;
    showCallUI();
    if (callRoomEl) callRoomEl.textContent = (roomData.roomDisplay || roomData.roomNumber || '') + '室';
    if (btnToggleVideo) btnToggleVideo.style.display = isVideoCall ? 'inline-flex' : 'none';
    setCallStatus(isVideoCall ? '正在建立語音/視訊通話...' : '正在建立語音通話...');

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        localStream = stream;
        logLocalTracks(stream, 'local media ready');
        if (isVideoCall && localVideo) {
          localVideo.srcObject = stream;
          localVideo.style.display = 'block';
        }
        // UA already registered from confirm modal, skip recreation
        if (ua && ua.isRegistered()) {
          logSafe('UA already registered, reuse', {});
          callViaUa(roomData);
        } else {
          return ensureJsSIPLoaded().then(function (JS) {
            if (!JS) throw new Error('JsSIP 載入失敗');
            JsSIP = JS;
            if (ua) { try { ua.stop(); } catch (e) {} ua = null; }
            var socket = new JsSIP.WebSocketInterface(callSessionData.wssUrl);
            ua = new JsSIP.UA({
              sockets: [socket],
              uri: 'sip:' + callSessionData.webAccount + '@' + callSessionData.webrtcDomain,
              password: callSessionData.credential.value,
              register: true,
            });
            registerNewUA(roomData);
          });
        }
      })
      .catch(function (err) {
        logSafe('prepare call error', { name: err && err.name ? String(err.name) : '', message: err && err.message ? String(err.message) : '' });
        setCallStatus(getMediaErrorMessage(err), true);
        cleanupCall();
      });
  }

  function registerNewUA(roomData) {
    var data = callSessionData;
    if (!ua || !data) return;
    logSafe('UA create', {
      uri: 'sip:' + data.webAccount + '@' + data.webrtcDomain,
      wssUrl: data.wssUrl,
    });
    ua.on('connected', function () {
      logSafe('JsSIP connected', { wssUrl: data.wssUrl });
    });
    ua.on('registered', function () {
      logSafe('JsSIP registered', { webAccount: data.webAccount, webrtcDomain: data.webrtcDomain });
      setCallWebStatus('registered');
      injectSdpPatch(data.sipServerPublicIp);
      setCallStatus('正在撥號...');
      callViaUa(roomData);
    });
    ua.on('unregistered', function () {
      logSafe('JsSIP unregistered', {});
      if (!isIntentionalHangup) { setCallStatus('通話連接已斷開', true); }
      isIntentionalHangup = false;
    });
    ua.on('registrationFailed', function (e) {
      logSafe('JsSIP registrationFailed', { cause: e?.cause || '' });
      setCallStatus('通話服務註冊失敗', true);
      setTimeout(function () { cleanupCall(); }, 2000);
    });
    ua.on('disconnected', function () {
      logSafe('JsSIP disconnected', {});
      setCallStatus('通話服務已斷開', true);
      cleanupCall();
    });
    logSafe('ua.start called', {});
    ua.start();
  }

  function callViaUa(roomData) {
    if (!ua || !localStream || !callSessionData) {
      setCallStatus('呼叫配置未就緒', true);
      return;
    }
    var options = {
      mediaStream: localStream,
      pcConfig: { iceServers: callSessionData.iceServers || [] },
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: Boolean(isVideoCall),
      },
      eventHandlers: {
        progressing: function () { setCallStatus('正在響鈴...'); },
        ringing: function () { setCallStatus('正在響鈴...'); },
        accepted: function () {
          setCallStatus('通話中');
          startTimerIfNeeded();
        },
        confirmed: function () {
          setCallStatus('通話中');
          startTimerIfNeeded();
          if (isVideoCall) {
            if (callUpgradeTimer) clearTimeout(callUpgradeTimer);
            callUpgradeTimer = setTimeout(function () { upgradeToVideo(roomData); }, 4500);
          }
        },
        failed: function (e) {
          logSafe('call failed', {
            cause: e && e.cause ? String(e.cause) : '',
            statusCode: e && e.response && e.response.status_code ? e.response.status_code : '',
            reasonPhrase: e && e.response && e.response.reason_phrase ? String(e.response.reason_phrase) : '',
          });
          setCallStatus('通話失敗', true);
          cleanupCall();
        },
        ended: function () {
          setCallStatus('通話已結束');
          cleanupCall();
        },
        peerconnection: function (e) {
          bindPeerConnectionEvents(e.peerconnection);
        },
      },
    };

    logSafe('ua.call', {
      targetSipUri: callSessionData.targetSipUri,
      iceServersCount: (callSessionData.iceServers || []).length,
      isVideoCall: Boolean(isVideoCall),
    });

    currentSession = ua.call(callSessionData.targetSipUri, options);
  }

  function upgradeToVideo(roomData) {
    if (!currentSession || !currentPeerConnection || !isVideoCall || videoUpgradeInProgress) return;
    if (!secureContextCheck()) return;
    videoUpgradeInProgress = true;
    setCallStatus('正在啟用視訊...');
    logSafe('upgradeToVideo start', {
      roomNumber: roomData && roomData.roomNumber ? String(roomData.roomNumber) : '',
    });

    navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 20 },
    }).then(function (videoStream) {
      var videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('攝像頭不可用');
      if (localStream && videoTrack) localStream.addTrack(videoTrack);
      if (videoTrack) {
        currentPeerConnection.addTrack(videoTrack, localStream || videoStream);
      }
      if (localVideo) {
        localVideo.srcObject = localStream || videoStream;
        localVideo.style.display = 'block';
      }
      logSafe('upgradeToVideo local track added', {
        localAudioTracks: localStream ? localStream.getAudioTracks().length : 0,
        localVideoTracks: localStream ? localStream.getVideoTracks().length : 0,
      });
      setTimeout(function () {
        try {
          currentSession.renegotiate({
            useAudio: true,
            useVideo: true,
            rtcOfferConstraints: {
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            },
          });
          logSafe('upgradeToVideo renegotiate called', {});
        } catch (err) {
          logSafe('upgradeToVideo renegotiate error', {
            name: err && err.name ? String(err.name) : '',
            message: err && err.message ? String(err.message) : '',
          });
          setCallStatus('視訊啟用失敗，已保持語音通話', true);
        } finally {
          videoUpgradeInProgress = false;
        }
      }, 500);
    }).catch(function (err) {
      videoUpgradeInProgress = false;
      logSafe('upgradeToVideo error', {
        name: err && err.name ? String(err.name) : '',
        message: err && err.message ? String(err.message) : '',
      });
      setCallStatus(getMediaErrorMessage(err), true);
    });
  }

  function fetchCallSession(roomData, callType) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/access/room-call-session');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      try {
        var res = JSON.parse(xhr.responseText || '{}');
        var normalized = normalizeCallSessionResponse(res);
        logSafe('call-session summary', {
          success: Boolean(normalized && normalized.success),
          webAccount: normalized.webAccount,
          credentialPresent: Boolean(normalized.credential && normalized.credential.value),
          credentialLength: normalized.credential && normalized.credential.value ? String(normalized.credential.value).length : 0,
          wssUrl: normalized.wssUrl,
          targetSipUri: normalized.targetSipUri,
          iceServersCount: normalized.iceServers.length,
        });
        if (normalized.success && normalized.webAccount) {
          callSessionData = normalized;
          setCallSipStatus(normalized.sipOnline);
          prepareAndCall(roomData, callType);
        } else {
          setCallStatus((res && res.message) || '此房間暫時無法呼叫，請稍後再試。', true);
          setTimeout(function () { cleanupCall(); }, 3000);
        }
      } catch (err) {
        logSafe('call-session parse error', { message: err && err.message ? String(err.message) : '' });
        setCallStatus('服務回應異常，請稍後再試。', true);
        setTimeout(function () { cleanupCall(); }, 3000);
      }
    };
    xhr.onerror = function () {
      logSafe('call-session network error', {});
      setCallStatus('網絡錯誤，請稍後再試。', true);
      setTimeout(function () { cleanupCall(); }, 3000);
    };
    xhr.send(JSON.stringify({
      roomId: roomData.roomId,
      lockId: roomData.lockId,
    }));
  }

  function requestCall(roomData, callType) {
    if (!roomData || !roomData.roomId) {
      alert('無法獲取房間或設備資訊，請重新整理頁面。');
      return;
    }
    if (activeCall) return;
    showConfirmModal(roomData, callType);
  }

  function confirmCall() {
    if (!pendingRoomData) return;
    clearConfirmCountdown();
    hideConfirmModal();
    // UA already registered, session data already loaded
    callSessionData = confirmCallSessionData;
    setCallSipStatus(callSessionData?.sipOnline);
    prepareAndCall(pendingRoomData, pendingCallType);
  }

  function cancelConfirm() {
    clearConfirmCountdown();
    hideConfirmModal();
    // Stop UA and cleanup web registration
    if (ua) { isIntentionalHangup = true; try { ua.stop(); } catch (e) {} ua = null; }
    confirmCallSessionData = null;
    resetCallState();
  }

  window.AccessVisitorCall = {
    requestCall: requestCall,
    confirmCall: confirmCall,
    cancelConfirm: cancelConfirm,
    hangup: hangup,
    toggleVideo: toggleVideo,
    cleanup: cleanupCall,
    refreshConfirmSip: refreshConfirmSip,
    retryConfirmWeb: retryConfirmWeb,
    refreshCallSip: refreshCallSipStatus,
  };

  // Backward compatibility for existing call handlers
  window.AccessCall = window.AccessVisitorCall;

  window.handleAccessVoiceCall = function (btn) {
    requestCall(extractRoomDataFromButton(btn), 'voice');
  };

  window.handleAccessVideoCall = function (btn) {
    requestCall(extractRoomDataFromButton(btn), 'video');
  };

  window.handleCall = function (btn, callType) {
    requestCall(extractRoomDataFromButton(btn), callType || 'voice');
  };

  function extractRoomDataFromButton(btn) {
    var row = btn && btn.closest ? btn.closest('.room-row') : null;
    var roomNumber = row ? (row.dataset.roomNum || row.querySelector('.room-number')?.textContent?.replace('室', '') || '') : '';
    var lockId = (new URLSearchParams(location.search)).get('lockId') || '';
    return {
      roomId: row ? parseInt(row.dataset.roomId, 10) : 0,
      roomNumber: roomNumber,
      roomDisplay: roomNumber ? roomNumber + '室' : '',
      residentName: row ? (row.dataset.residentName || row.querySelector('.room-contact')?.textContent || '') : '',
      lockId: lockId,
      sipAccount: row ? (row.dataset.sipAccount || '') : '',
      webAccount: row ? (row.dataset.webAccount || '') : '',
    };
  }

  if (confirmVoiceBtn) {
    confirmVoiceBtn.addEventListener('click', function () {
      pendingCallType = 'voice';
      confirmCall();
    });
  }
  if (confirmVideoBtn) {
    confirmVideoBtn.addEventListener('click', function () {
      pendingCallType = 'video';
      confirmCall();
    });
  }
  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', cancelConfirm);
  }
  if (btnHangup) btnHangup.addEventListener('click', hangup);
  if (btnToggleVideo) btnToggleVideo.addEventListener('click', toggleVideo);

  window.addEventListener('beforeunload', function () {
    cleanupCall();
  });
})();
