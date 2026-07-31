// public/js/modules/qualityMonitor.js
//
// Live Call Quality Monitor (Phase 1)
//
// This module is entirely self-contained and read-only:
// - It never modifies the RTCPeerConnection, PeerJS call object, or any
//   call/recording behavior.
// - It only reads the existing global `currentCall` variable (declared
//   in main.js) to find the active call's underlying RTCPeerConnection,
//   via PeerJS's `call.peerConnection` reference.
// - It polls stats at most once per second, and does nothing at all
//   (no fetching, no rendering) whenever no call is active.

const QualityMonitor = {
  _panel: null,
  _contentEl: null,
  _pollTimer: null,
  _visible: false,
  _prevSample: null, // { timestamp, videoBytesSent, videoBytesReceived }

  init() {
    console.log('Quality Monitor initialized');
    this._createPanel();
    this._pollTimer = setInterval(() => this._tick(), 1000);
  },

  // --- Panel creation (pure UI, does not touch any existing elements) ---
  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'qualityMonitorPanel';
    panel.style.cssText = [
      'position:fixed',
      'top:64px',
      'left:12px',
      'z-index:25',
      'background:rgba(0,0,0,0.68)',
      'color:#fff',
      'font-size:0.72em',
      'font-family:-apple-system, Arial, sans-serif',
      'padding:8px 10px',
      'border-radius:10px',
      'line-height:1.5',
      'min-width:150px',
      'max-width:190px',
      'display:none',
      'user-select:none',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)'
    ].join(';');

    const content = document.createElement('div');
    content.id = 'qualityMonitorContent';
    content.textContent = 'Waiting for statistics...';
    panel.appendChild(content);

    document.body.appendChild(panel);
    this._panel = panel;
    this._contentEl = content;
    this._makeDraggable(panel);
  },

  // --- Simple touch-drag support (optional per spec, kept minimal) ---
  _makeDraggable(panel) {
    let dragging = false;
    let startX = 0, startY = 0, startTop = 0, startLeft = 0;

    panel.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      dragging = true;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const rect = panel.getBoundingClientRect();
      startTop = rect.top;
      startLeft = rect.left;
    }, { passive: true });

    panel.addEventListener('touchmove', (e) => {
      if (!dragging || !e.touches || !e.touches.length) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      panel.style.left = Math.max(0, startLeft + dx) + 'px';
      panel.style.top = Math.max(0, startTop + dy) + 'px';
    }, { passive: true });

    panel.addEventListener('touchend', () => { dragging = false; });
  },

  _show() {
    if (!this._visible && this._panel) {
      this._panel.style.display = 'block';
      this._visible = true;
    }
  },

  _hide() {
    if (this._visible && this._panel) {
      this._panel.style.display = 'none';
      this._visible = false;
    }
    this._prevSample = null;
  },

  _setContent(html) {
    if (this._contentEl) this._contentEl.innerHTML = html;
  },

  // --- Main polling tick — runs at most once per second ---
  async _tick() {
    try {
      // `currentCall` is a global declared with `let` in main.js.
      // This module only ever reads it — never assigns to it.
      const call = (typeof currentCall !== 'undefined') ? currentCall : null;
      const pc = (call && call.peerConnection) ? call.peerConnection : null;

      if (!pc) {
        this._hide();
        return;
      }

      this._show();

      const statsReport = await pc.getStats();
      this._render(statsReport, pc);
    } catch (err) {
      // Never let a stats-reading failure surface as an error — this
      // module must stay silent and passive no matter what.
      this._setContent('Waiting for statistics...');
    }
  },

  // --- Parse the RTCStatsReport and update the panel ---
  _render(statsReport, pc) {
    let outboundVideo = null;
    let inboundVideo = null;
    let selectedPair = null;

    statsReport.forEach((report) => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') outboundVideo = report;
      if (report.type === 'inbound-rtp' && report.kind === 'video') inboundVideo = report;
      if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') selectedPair = report;
    });

    const now = Date.now();
    const prev = this._prevSample;

    const outgoingBitrateKbps = this._computeBitrateKbps(
      prev, now, prev && prev.videoBytesSent, outboundVideo && outboundVideo.bytesSent
    );
    const incomingBitrateKbps = this._computeBitrateKbps(
      prev, now, prev && prev.videoBytesReceived, inboundVideo && inboundVideo.bytesReceived
    );

    let packetLossPercent = null;
    if (inboundVideo && inboundVideo.packetsLost != null && inboundVideo.packetsReceived != null) {
      const total = inboundVideo.packetsLost + inboundVideo.packetsReceived;
      packetLossPercent = total > 0 ? Math.round((inboundVideo.packetsLost / total) * 100) : 0;
    }

    const resolution = outboundVideo && outboundVideo.frameWidth
      ? `${outboundVideo.frameWidth} × ${outboundVideo.frameHeight}`
      : (inboundVideo && inboundVideo.frameWidth ? `${inboundVideo.frameWidth} × ${inboundVideo.frameHeight}` : null);

    const fps = outboundVideo && outboundVideo.framesPerSecond != null
      ? Math.round(outboundVideo.framesPerSecond)
      : (inboundVideo && inboundVideo.framesPerSecond != null ? Math.round(inboundVideo.framesPerSecond) : null);

    const rttMs = selectedPair && selectedPair.currentRoundTripTime != null
      ? Math.round(selectedPair.currentRoundTripTime * 1000)
      : null;

    const packetsLostTotal = inboundVideo && inboundVideo.packetsLost != null ? inboundVideo.packetsLost : null;
    const connectionState = pc.connectionState || 'unknown';
    const iceState = pc.iceConnectionState || 'unknown';

    const rating = this._rate({ outgoingBitrateKbps, packetLossPercent, rttMs, fps });

    this._setContent(`
      <div><strong>Connection Quality</strong></div>
      <div>Status: ${rating.emoji} ${rating.label}</div>
      <div>Resolution: ${resolution || '—'}</div>
      <div>FPS: ${fps != null ? fps : '—'}</div>
      <div>Bitrate: ${outgoingBitrateKbps != null ? outgoingBitrateKbps + ' kbps' : '—'}</div>
      <div>Incoming: ${incomingBitrateKbps != null ? incomingBitrateKbps + ' kbps' : '—'}</div>
      <div>Latency: ${rttMs != null ? rttMs + ' ms' : '—'}</div>
      <div>Packet Loss: ${packetLossPercent != null ? packetLossPercent + '%' : '—'}</div>
      <div style="opacity:0.65;font-size:0.9em;">${connectionState} / ${iceState}</div>
    `);

    this._prevSample = {
      timestamp: now,
      videoBytesSent: outboundVideo ? outboundVideo.bytesSent : null,
      videoBytesReceived: inboundVideo ? inboundVideo.bytesReceived : null,
    };
  },

  // Bitrate is derived from the change in cumulative bytes between two
  // polls, divided by the time elapsed — RTCStats only exposes running
  // totals, not an instantaneous rate.
  _computeBitrateKbps(prev, now, prevBytes, currentBytes) {
    if (!prev || prevBytes == null || currentBytes == null) return null;
    const bytesDelta = currentBytes - prevBytes;
    const secondsDelta = (now - prev.timestamp) / 1000;
    if (secondsDelta <= 0 || bytesDelta < 0) return null;
    return Math.round((bytesDelta * 8) / secondsDelta / 1000);
  },

  // Simple, intentionally adjustable rating: start at "Excellent" and
  // downgrade based on the worst signal seen. Thresholds are easy to
  // retune later without touching the rest of the module.
  _rate({ outgoingBitrateKbps, packetLossPercent, rttMs, fps }) {
    let score = 3; // 3=Excellent, 2=Good, 1=Fair, 0=Poor

    if (packetLossPercent != null) {
      if (packetLossPercent > 10) score = Math.min(score, 0);
      else if (packetLossPercent > 5) score = Math.min(score, 1);
      else if (packetLossPercent > 1) score = Math.min(score, 2);
    }
    if (rttMs != null) {
      if (rttMs > 400) score = Math.min(score, 0);
      else if (rttMs > 200) score = Math.min(score, 1);
      else if (rttMs > 100) score = Math.min(score, 2);
    }
    if (outgoingBitrateKbps != null) {
      if (outgoingBitrateKbps < 100) score = Math.min(score, 0);
      else if (outgoingBitrateKbps < 250) score = Math.min(score, 1);
      else if (outgoingBitrateKbps < 450) score = Math.min(score, 2);
    }
    if (fps != null) {
      if (fps < 8) score = Math.min(score, 0);
      else if (fps < 14) score = Math.min(score, 1);
      else if (fps < 18) score = Math.min(score, 2);
    }

    const levels = [
      { emoji: '🔴', label: 'Poor' },
      { emoji: '🟠', label: 'Fair' },
      { emoji: '🟡', label: 'Good' },
      { emoji: '🟢', label: 'Excellent' },
    ];
    return levels[score];
  }
};

window.QualityMonitor = QualityMonitor;
