// public/js/modules/qualityMonitor.js
//
// Responsible for (future work — not implemented yet):
// - Reading WebRTC statistics (RTCPeerConnection.getStats())
// - Tracking bitrate, FPS, resolution
// - Detecting packet loss and latency
// - Surfacing an overall "connection quality" indicator
//
// This file currently only sets up the module's structure and an
// init() entry point. No monitoring logic exists yet.

const QualityMonitor = {
  init() {
    console.log('Quality Monitor initialized');
  }
};

window.QualityMonitor = QualityMonitor;