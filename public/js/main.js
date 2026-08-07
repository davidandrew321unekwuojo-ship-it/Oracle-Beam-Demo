// Oracle Beam — main app script
// Extracted from the inline <script> block in index.html (Sprint 2)
const statusEl = document.getElementById('status');
const myIdText = document.getElementById('myIdText');
const copyIdBtn = document.getElementById('copyIdBtn');
const changeIdBtn = document.getElementById('changeIdBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const videoCallBtn = document.getElementById('videoCallBtn');
const audioCallBtn = document.getElementById('audioCallBtn');
const callScreen = document.getElementById('callScreen');
const callInfo = document.getElementById('callInfo');
const audioOnlyLabel = document.getElementById('audioOnlyLabel');
const callHangupBtn = document.getElementById('callHangupBtn');
const incomingScreen = document.getElementById('incomingScreen');
const incomingLabel = document.getElementById('incomingLabel');
const incomingSubLabel = document.getElementById('incomingSubLabel');
const acceptBtn = document.getElementById('acceptBtn');
const declineBtn = document.getElementById('declineBtn');
const recordBtn = document.getElementById('recordBtn');
const recIndicator = document.getElementById('recIndicator');
const recordCanvas = document.getElementById('recordCanvas');
const contactsList = document.getElementById('contactsList');
const saveContactBar = document.getElementById('saveContactBar');
const saveContactName = document.getElementById('saveContactName');

let fullStream = null;
let currentCall = null;
let pendingIncomingCall = null;
let audioCtx = null;
let ringInterval = null;
let currentIsAudioOnly = false;
let currentRemoteIdForSaving = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordCanvasCtx = null;
let recordDrawLoopId = null;
let isRecording = false;
// --- Contacts book, stored locally on this device only ---
function getContacts() {
  return JSON.parse(localStorage.getItem('oracleBeamContacts') || '{}');
}
function saveContact(id, name) {
  const contacts = getContacts();
  contacts[id] = name;
  localStorage.setItem('oracleBeamContacts', JSON.stringify(contacts));
  renderContacts();
}
function renderContacts() {
  const contacts = getContacts();
  contactsList.innerHTML = '';
  Object.entries(contacts).forEach(([id, name]) => {
    const btn = document.createElement('button');
    btn.className = 'contactChip';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      document.getElementById('remoteId').value = id;
    });
    contactsList.appendChild(btn);
  });
}

// --- Permanent 4-digit "phone number" style ID, stored on this device ---
function generateFourDigitId() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
function getOrCreateMyPermanentId() {
  let id = localStorage.getItem('oracleBeamMyId');
  if (!id) {
    id = generateFourDigitId();
    localStorage.setItem('oracleBeamMyId', id);
  }
  return id;
}


let myPermanentId = getOrCreateMyPermanentId();
let peer;

function connectPeer() {
  peer = new Peer(myPermanentId, {
  host: location.hostname,
  port: location.port || 9000,
  path: '/',
  secure: true,
  config: {
    iceServers: []
  }
});

  peer.on('open', (id) => { myIdText.textContent = id; });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      myPermanentId = generateFourDigitId();
      localStorage.setItem('oracleBeamMyId', myPermanentId);
      connectPeer();
      return;
    }
    statusEl.textContent = 'Error: ' + err.type;
    stopRingtone();
  });

  peer.on('call', (call) => {
    const isAudioOnly = call.metadata && call.metadata.audioOnly;
    pendingIncomingCall = { call, isAudioOnly };
    currentRemoteIdForSaving = call.peer;
    incomingLabel.textContent = isAudioOnly ? 'Incoming audio call' : 'Incoming video call';
    const contacts = getContacts();
    const callerName = contacts[call.peer] || `ID ${call.peer}`;
    incomingSubLabel.textContent = `from ${callerName}`;
    incomingScreen.style.display = 'flex';
    playRingtone();
  });
}
async function initMedia() {
  try {
    const captureAspect = window.innerWidth / window.innerHeight;
    fullStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640, min: 480 },
        aspectRatio: { ideal: captureAspect },
        frameRate: { ideal: 20, max: 24 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
    });

    // TEMPORARY DIAGNOSTIC — shows what the camera actually delivered
    // vs. what was requested. Remove once no longer needed.
    const vTrack = fullStream.getVideoTracks()[0];
    const settings = vTrack.getSettings ? vTrack.getSettings() : {};
    const diag = document.createElement('div');
    diag.style.cssText = 'position:fixed;top:200px;left:12px;z-index:99;background:black;color:#0f0;font-size:11px;padding:8px;border-radius:6px;max-width:250px;';
    diag.textContent = 'Requested aspect: ' + captureAspect.toFixed(3) +
      ' | Delivered: ' + settings.width + '\u00D7' + settings.height +
      ' | aspectRatio: ' + (settings.aspectRatio ? settings.aspectRatio.toFixed(3) : 'n/a');
    document.body.appendChild(diag);
  } catch (err) {
    statusEl.textContent = 'Camera/mic access failed: ' + err.message;
  }
}
  
function playRingtone() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function ringOnce() {
    const now = audioCtx.currentTime;
    [440, 480].forEach((freq) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    });
  }
  ringOnce();
  ringInterval = setInterval(ringOnce, 1200);
}
function stopRingtone() {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
}

function getOutgoingStream(isAudioOnly) {
  if (!isAudioOnly) return fullStream;
  const audioOnly = new MediaStream();
  fullStream.getAudioTracks().forEach(t => audioOnly.addTrack(t));
  return audioOnly;
}

function startCall(isAudioOnly) {
  const remoteId = document.getElementById('remoteId').value.trim();
  if (!remoteId) return;
  if (!fullStream) { statusEl.textContent = 'Waiting for camera/mic access...'; return; }
  currentRemoteIdForSaving = remoteId;
  const outgoing = getOutgoingStream(isAudioOnly);
  playRingtone();
  const call = peer.call(remoteId, outgoing, { metadata: { audioOnly: isAudioOnly } });
  setupCall(call, isAudioOnly);
}
// Chooses between object-fit: cover and contain for #remoteVideo based
// on the actual delivered video shape vs. the box's real shape — not a
// fixed guess. If `cover` would need to crop away more than ~35% of the
// frame to fill the box, `contain` (showing the full frame, with bars)
// is used instead. Below that threshold, cover's minor crop is kept.
function updateRemoteVideoFit() {
  const vw = remoteVideo.videoWidth;
  const vh = remoteVideo.videoHeight;
  if (!vw || !vh) return; // no video track yet (e.g. audio-only call)

  const videoAspect = vw / vh;
  const boxAspect = remoteVideo.clientWidth / remoteVideo.clientHeight;
  if (!boxAspect) return;

  const cropFraction = videoAspect > boxAspect
    ? 1 - (boxAspect / videoAspect)
    : 1 - (videoAspect / boxAspect);

  remoteVideo.style.objectFit = cropFraction > 0.35 ? 'contain' : 'cover';
}

function setupCall(call, isAudioOnly) {
  currentCall = call;
  currentIsAudioOnly = isAudioOnly;
  callScreen.style.display = 'block';
  callInfo.textContent = 'Connecting...';

  if (isAudioOnly) {
    localVideo.style.display = 'none';
    remoteVideo.style.display = 'none';
    audioOnlyLabel.style.display = 'flex';
  } else {
    localVideo.style.display = 'block';
    remoteVideo.style.display = 'block';
    audioOnlyLabel.style.display = 'none';
    localVideo.srcObject = fullStream;
  }

  call.on('stream', (remoteStream) => {
    stopRingtone();
    remoteVideo.srcObject = remoteStream;
    callInfo.textContent = isAudioOnly ? 'Audio call connected' : 'Video call connected';

    // Cap outgoing video bitrate for more stable playback on the local
    // hotspot connection. Audio senders are left untouched, and browsers
    // without setParameters support are safely skipped.
    const pc = call.peerConnection;
    if (pc && typeof pc.getSenders === 'function') {
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'video' && typeof sender.setParameters === 'function') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = 700000; // ~700 kbps ceiling
          sender.setParameters(params).catch(() => {});
        }
      });
    }

    // Adapt remote video crop behavior to the actual delivered shape
    // (Commit 6). Re-registering guards against duplicate listeners
    // stacking up across multiple calls in one session.
    remoteVideo.removeEventListener('loadedmetadata', updateRemoteVideoFit);
    remoteVideo.removeEventListener('resize', updateRemoteVideoFit);
    remoteVideo.addEventListener('loadedmetadata', updateRemoteVideoFit);
    remoteVideo.addEventListener('resize', updateRemoteVideoFit);
  });

  call.on('close', endCall);
  call.on('error', (err) => {
    stopRingtone();
    callInfo.textContent = 'Call error: ' + err;
  });
}

function endCall() {
  if (isRecording) stopRecording();
  stopRingtone();
  if (currentCall) currentCall.close();
  currentCall = null;
  remoteVideo.srcObject = null;
  callScreen.style.display = 'none';
  statusEl.textContent = 'Call ended';
  if (currentRemoteIdForSaving && !getContacts()[currentRemoteIdForSaving]) {
    saveContactBar.style.display = 'flex';
    saveContactName.value = '';
  }
}
function startRecording() {
  if (!currentCall) return;
  recordedChunks = [];

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();

  if (fullStream && fullStream.getAudioTracks().length) {
    const localSrc = audioCtx.createMediaStreamSource(new MediaStream(fullStream.getAudioTracks()));
    localSrc.connect(dest);
  }
  const remoteStreamObj = remoteVideo.srcObject;
  if (remoteStreamObj && remoteStreamObj.getAudioTracks().length) {
    const remoteSrc = audioCtx.createMediaStreamSource(new MediaStream(remoteStreamObj.getAudioTracks()));
    remoteSrc.connect(dest);
  }

  let recordStream;
  if (currentIsAudioOnly) {
    recordStream = dest.stream;
  } else {
    recordCanvas.width = 640;
    recordCanvas.height = 360;
    recordCanvasCtx = recordCanvas.getContext('2d');
    const RECORD_FPS = 15;

    function drawFrame() {
      recordCanvasCtx.fillStyle = '#000';
      recordCanvasCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
      if (remoteVideo.readyState >= 2) {
        recordCanvasCtx.drawImage(remoteVideo, 0, 0, recordCanvas.width, recordCanvas.height);
      }
      if (localVideo.readyState >= 2) {
        const pw = 100, ph = 135, px = recordCanvas.width - pw - 12, py = recordCanvas.height - ph - 12;
        recordCanvasCtx.save();
        recordCanvasCtx.translate(px + pw, py);
        recordCanvasCtx.scale(-1, 1);
        recordCanvasCtx.drawImage(localVideo, 0, 0, pw, ph);
        recordCanvasCtx.restore();
      }
      recordDrawLoopId = setTimeout(drawFrame, 1000 / RECORD_FPS);
    }
    drawFrame();

    const canvasStream = recordCanvas.captureStream(RECORD_FPS);
    recordStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';

  mediaRecorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 800000 });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    if (recordDrawLoopId) clearTimeout(recordDrawLoopId);
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `oracle-beam-call-${stamp}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  mediaRecorder.start();
  isRecording = true;
  recordBtn.classList.add('active');
  recIndicator.style.display = 'flex';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove('active');
  recIndicator.style.display = 'none';
}

connectPeer();

changeIdBtn.addEventListener('click', () => {
  const wantsNumber = prompt('Enter a new 4-digit ID (leave blank for a random one):');
  let newId;
  if (wantsNumber === null) return;
  if (wantsNumber.trim() === '') {
    newId = generateFourDigitId();
  } else if (/^\d{4}$/.test(wantsNumber.trim())) {
    newId = wantsNumber.trim();
  } else {
    alert('Please enter exactly 4 digits, or leave it blank.');
    return;
  }
  if (peer) peer.destroy();
  myPermanentId = newId;
  localStorage.setItem('oracleBeamMyId', newId);
  myIdText.textContent = 'connecting...';
  connectPeer();
});


copyIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(myIdText.textContent).then(() => {
    copyIdBtn.textContent = 'Copied!';
    setTimeout(() => { copyIdBtn.textContent = 'Copy'; }, 1500);
  });
});

initMedia();
renderContacts();

acceptBtn.addEventListener('click', () => {
  if (!pendingIncomingCall) return;
  stopRingtone();
  incomingScreen.style.display = 'none';
  const { call, isAudioOnly } = pendingIncomingCall;
  const outgoing = getOutgoingStream(isAudioOnly);
  call.answer(outgoing);
  setupCall(call, isAudioOnly);
  pendingIncomingCall = null;
});

declineBtn.addEventListener('click', () => {
  if (!pendingIncomingCall) return;
  stopRingtone();
  incomingScreen.style.display = 'none';
  pendingIncomingCall.call.close();
  pendingIncomingCall = null;
});


videoCallBtn.addEventListener('click', () => startCall(false));
audioCallBtn.addEventListener('click', () => startCall(true));

callHangupBtn.addEventListener('click', endCall);

document.getElementById('confirmSaveContact').addEventListener('click', () => {
  const name = saveContactName.value.trim();
  if (name && currentRemoteIdForSaving) {
    saveContact(currentRemoteIdForSaving, name);
  }
  saveContactBar.style.display = 'none';
});
document.getElementById('dismissSaveContact').addEventListener('click', () => {
  saveContactBar.style.display = 'none';
});

recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js');
}
// --- v2 modular architecture: initialize feature modules ---
// These modules are currently empty placeholders (Sprint 3) and do not
// affect any existing behavior. See public/js/modules/ for details.
QualityMonitor.init();
CallHistory.init();
Reconnect.init();
Settings.init();
Notifications.init();