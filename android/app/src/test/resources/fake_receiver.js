// Test double for the Windows receiver: registers on the signaling server, answers offers and relays a candidate.
// Usage: node fake_receiver.js <serverUrl> <repoRoot>
const path = require('path');
const { io } = require(path.join(process.argv[3], 'node_modules', 'socket.io-client'));

const socket = io(process.argv[2], { transports: ['websocket'] });

socket.on('connect', () => {
  socket.emit('register-receiver', { deviceName: 'Fake Receiver' }, (res) => {
    console.log('PIN=' + res.pin);
  });
});

socket.on('sender-connected', ({ senderId, senderInfo }) => {
  console.log('SENDER=' + senderId + ' MODEL=' + senderInfo.model + ' OS=' + senderInfo.os);
});

socket.on('webrtc-offer', ({ sdp, senderId }) => {
  console.log('OFFER=' + sdp);
  socket.emit('webrtc-answer', { sdp: 'ANSWER-FROM-RECEIVER', senderId });
  socket.emit('webrtc-candidate', {
    candidate: { candidate: 'candidate:9 1 udp 1 10.0.0.9 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    senderId
  });
});

socket.on('webrtc-candidate', (data) => {
  console.log('CAND=' + data.candidate.candidate + ' MID=' + data.candidate.sdpMid);
});

socket.on('sender-disconnected', () => console.log('SENDER_GONE'));
socket.on('connect_error', (e) => console.log('ERROR=' + e.message));
