/**
 * Access Platform - WebRTC Voice/Video Calling Module
 * Self-contained, no dependencies on React or ecard code.
 */
(function () {
  'use strict';

  var JsSIP = null;
  var ua = null;
  var currentSession = null;
  var localStream = null;
  var callSessionData = null;
  var originalSend = null;
  var isIntentionalHangup = false;
  var activeCall = false;

  // ─── DOM helpers ───
  var callOverlay = document.getElementById('callOverlay');
  var callStatusEl = document.getElementById('callStatusText');
  var callRoomEl = document.getElementById('callRoomLabel');
  var callTimerEl = document.getElementById('callTimer');
  var btnHangup = document.getElementById('btnHangup');
  var btnToggleVideo = document.getElementById('btnToggleVideo');
  var btnRefreshSip = document.getElementById('btnRefreshSip');
  var localVideo = document.getElementById('localVideo');
  var remoteVideo = document.getElementById('remoteVideo');
  var remoteAudio = document.getElementById('remoteAudio');
  var callErrorEl = document.getElementById('callError');
  var webStatusDot = document.getElementById('webStatusDot');
  var webStatusText = document.getElementById('webStatusText');
  var sipStatusDot = document.getElementById('sipStatusDot');
  var sipStatusText = document.getElementById('sipStatusText');

  var callStartTime = 0;
  var callTimerInterval = null;
  var isVideoCall = false;
  var pendingRoomData = null;
  var pendingCallType = null;

  function updateTimer() {
    if (!callStartTime) return;
    var sec = Math.floor((Date.now() - callStartTime) / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    callTimerEl.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function startTimer() {
    callStartTime = Date.now();
    callTimerEl.textContent = '00:00';
    callTimerInterval = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    callStartTime = 0;
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    callTimerEl.textContent = '';
  }

  // ─── JsSIP loader ───
  function loadJsSIP() {
    return new Promise(function (resolve) {
      if (window.JsSIP) { JsSIP = window.JsSIP; resolve(JsSIP); return; }
      var script = document.createElement('script');
      script.src = '/visitor-assets/jssip.min.js';
      script.onload = function () { JsSIP = window.JsSIP; resolve(JsSIP); };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    });
  }

  // ─── SDP patch for NAT ───
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

  // ─── Cleanup ───
  function cleanupCall() {
    if (currentSession) { try { currentSession.terminate(); } catch (e) {} currentSession = null; }
    if (ua) { isIntentionalHangup = true; try { ua.stop(); } catch (e) {} ua = null; }
    if (localStream) {
      localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    activeCall = false;
    callSessionData = null;
    stopTimer();
    hideCallUI();
  }

  function showCallUI() {
    if (callOverlay) callOverlay.style.display = 'flex';
    if (callErrorEl) callErrorEl.style.display = 'none';
    setWebStatus('registering');
    if (btnRefreshSip) btnRefreshSip.style.display = '';
  }

  function hideCallUI() {
    if (callOverlay) callOverlay.style.display = 'none';
    if (btnToggleVideo) { btnToggleVideo.style.display = 'none'; btnToggleVideo.textContent = '📹'; }
    isVideoCall = false;
  }

  function setCallStatus(text, isError) {
    if (callStatusEl) { callStatusEl.textContent = text; callStatusEl.style.color = isError ? '#ef4444' : '#e5e7eb'; }
    if (callErrorEl && isError) { callErrorEl.textContent = text; callErrorEl.style.display = 'block'; }
  }

  // ─── Status indicators ───
  function setWebStatus(state) {
    if (!webStatusDot || !webStatusText) return;
    if (state === 'registered') { webStatusDot.style.background = '#22c55e'; webStatusText.textContent = 'Web 已註冊'; }
    else if (state === 'registering') { webStatusDot.style.background = '#f59e0b'; webStatusText.textContent = 'Web 註冊中'; }
    else { webStatusDot.style.background = '#ef4444'; webStatusText.textContent = 'Web 註冊失敗'; }
  }

  function setSipStatus(online) {
    if (!sipStatusDot || !sipStatusText) return;
    if (online) { sipStatusDot.style.background = '#22c55e'; sipStatusText.textContent = 'SIP 在線'; }
    else { sipStatusDot.style.background = '#6b7280'; sipStatusText.textContent = 'SIP 離線'; }
    if (btnRefreshSip) btnRefreshSip.style.display = '';
  }

  function refreshSipStatus() {
    if (!pendingRoomData || !callSessionData) return;
    if (btnRefreshSip) { btnRefreshSip.style.display = 'none'; sipStatusDot.style.background = '#f59e0b'; sipStatusText.textContent = 'SIP 查詢中'; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/access/room-sip-status?roomId=' + pendingRoomData.roomId + '&lockId=' + pendingRoomData.lockId);
    xhr.onload = function () {
      try { var r = JSON.parse(xhr.responseText); setSipStatus(r.data?.sipOnline); } catch(e) { setSipStatus(false); }
    };
    xhr.onerror = function () { setSipStatus(false); };
    xhr.send();
  }

  // ─── Audio binding ───
  function bindRemoteAudio(pc) {
    try {
      var audioReceiver = (pc.getReceivers() || []).find(function (r) { return r.track && r.track.kind === 'audio'; });
      if (!audioReceiver || !audioReceiver.track) return;
      var stream = new MediaStream([audioReceiver.track]);
      if (remoteAudio) { remoteAudio.srcObject = stream; remoteAudio.play().catch(function () {}); }
    } catch (e) {}
  }

  // ─── Hangup ───
  function hangup() {
    cleanupCall();
  }

  // ─── Toggle video ───
  function toggleVideo() {
    if (!localStream) return;
    var videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    btnToggleVideo.textContent = videoTrack.enabled ? '📹' : '📷';
  }

  // ─── Initiate call ───
  function startCall(roomData, video) {
    if (activeCall) return;
    isVideoCall = Boolean(video && callSessionData && callSessionData.enableVideo);
    setCallStatus(isVideoCall ? '正在建立視訊通話...' : '正在建立語音通話...');
    showCallUI();
    activeCall = true;

    navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall })
      .then(function (stream) {
        localStream = stream;
        if (isVideoCall && localVideo) localVideo.srcObject = stream;

        if (!callSessionData || !ua) { setCallStatus('呼叫配置未就緒', true); return; }

        var options = {
          mediaStream: stream,
          pcConfig: { iceServers: callSessionData.iceServers || [] },
          eventHandlers: {
            progressing: function () { setCallStatus('正在響鈴...'); },
            ringing: function () { setCallStatus('正在響鈴...'); },
            accepted: function () { setCallStatus('通話中'); startTimer(); },
            confirmed: function () { setCallStatus('通話中'); },
            failed: function () { setCallStatus('通話失敗', true); cleanupCall(); },
            ended: function () { setCallStatus('通話已結束'); cleanupCall(); },
            peerconnection: function (e) {
              var pc = e.peerconnection;
              pc.oniceconnectionstatechange = function () {
                if (pc.iceConnectionState === 'connected') bindRemoteAudio(pc);
              };
              pc.ontrack = function (evt) {
                if (evt.track.kind === 'video' && remoteVideo) {
                  remoteVideo.srcObject = new MediaStream([evt.track]);
                }
              };
            },
          },
        };

        currentSession = ua.call(callSessionData.targetSipUri, options);
      })
      .catch(function (err) {
        console.error('Media error:', err);
        setCallStatus('無法訪問麥克風/攝像頭', true);
        cleanupCall();
      });
  }

  // ─── Initialize UA ───
  function initUA(roomData) {
    if (ua) { try { ua.stop(); } catch (e) {} ua = null; }
    setCallStatus('正在連接通話服務...');
    showCallUI();

    var data = callSessionData;
    if (!data) { setCallStatus('無法取得通話配置', true); return; }

    loadJsSIP().then(function (JS) {
      if (!JS) { setCallStatus('JsSIP 載入失敗', true); return; }

      var socket = new JS.WebSocketInterface(data.wssUrl);
      ua = new JS.UA({
        sockets: [socket],
        uri: 'sip:' + data.webAccount + '@' + data.webrtcDomain,
        password: data.credential.value,
        register: true,
      });

      ua.on('registered', function () {
        setWebStatus('registered');
        injectSdpPatch(data.sipServerPublicIp);
        hideCallUI();
        startCall(roomData, isVideoCall);
      });

      ua.on('registrationFailed', function () {
        setWebStatus('failed');
        setCallStatus('通話服務註冊失敗', true);
        setTimeout(function () { hideCallUI(); cleanupCall(); }, 2000);
      });

      ua.on('unregistered', function () {
        if (!isIntentionalHangup) { setCallStatus('通話連接已斷開', true); }
        setWebStatus('failed');
        isIntentionalHangup = false;
      });

      ua.on('disconnected', function () {
        setWebStatus('failed');
        setCallStatus('通話服務已斷開', true);
        cleanupCall();
      });

      ua.start();
    });
  }

  // ─── Public API ───
  window.AccessCall = {
    /**
     * Start a voice or video call to a room.
     * @param {Object} roomData - { roomId, roomNumber, lockId }
     * @param {string} type - 'voice' or 'video'
     */
    call: function (roomData, type) {
      if (activeCall || !roomData || !roomData.roomId) return;
      var video = type === 'video';
      pendingRoomData = roomData;
      pendingCallType = type;

      // Fetch call session from server
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/access/room-call-session');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        try {
          var res = JSON.parse(xhr.responseText);
          if (res.success && res.data) {
            callSessionData = res.data;
            if (callRoomEl) callRoomEl.textContent = (roomData.roomNumber || '') + '室';
            if (btnToggleVideo) btnToggleVideo.style.display = video ? 'inline-flex' : 'none';
            setSipStatus(res.data.sipOnline);
            initUA(roomData, video);
          } else {
            setCallStatus(res.message || '無法取得通話配置', true);
            showCallUI();
            setTimeout(hideCallUI, 3000);
          }
        } catch (e) {
          setCallStatus('服務回應異常', true);
          showCallUI();
          setTimeout(hideCallUI, 3000);
        }
      };
      xhr.onerror = function () {
        setCallStatus('網絡錯誤', true);
        showCallUI();
        setTimeout(hideCallUI, 3000);
      };
      xhr.send(JSON.stringify({ roomId: roomData.roomId, lockId: roomData.lockId }));
    },

    hangup: hangup,
    toggleVideo: toggleVideo,
    refreshSipStatus: refreshSipStatus,
  };

  // ─── Button events ───
  if (btnHangup) btnHangup.addEventListener('click', hangup);
  if (btnToggleVideo) btnToggleVideo.addEventListener('click', toggleVideo);
})();
