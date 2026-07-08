// server.js
// Serves the web page AND runs the PeerJS signaling server, both over HTTPS.
// HTTPS is required because phone browsers refuse camera/mic access
// (getUserMedia) on any origin that isn't "localhost" or secure (https).

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
};

const server = https.createServer(options, app);

// Signaling server lives at /peerjs — this is what PeerJS uses to exchange
// connection info between the two phones before the direct video stream starts.
const peerServer = ExpressPeerServer(server, {
  path: '/peerjs',
});
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
  console.log('Peer connected:', client.getId());
});
peerServer.on('disconnect', (client) => {
  console.log('Peer disconnected:', client.getId());
});

const PORT = 9000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nServer is running.`);
  console.log(`On your phones, open:  https://<YOUR-HOST-PHONE-IP>:${PORT}`);
});
