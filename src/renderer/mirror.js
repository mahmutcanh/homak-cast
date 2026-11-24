(() => {
  // Mirror window: shows the same video as the main receiver window on another monitor.
  // The main window relays each sender's video here over a loopback WebRTC connection.
  const grid = document.getElementById('grid');
  const peers = new Map(); // senderId -> { pc, tile, chain }

  function updateLayout() {
    const count = Math.min(4, Math.max(1, peers.size));
    grid.className = `video-grid grid-${count}`;
  }

  function removePeer(senderId) {
    const peer = peers.get(senderId);
    if (!peer) return;
    peers.delete(senderId);
    peer.pc.close();
    if (peer.tile.parentNode) peer.tile.parentNode.removeChild(peer.tile);
    updateLayout();
  }

  function createPeer(senderId) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const tile = document.createElement('div');
    tile.className = 'video-tile';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // audio plays from the main receiver only
    tile.appendChild(video);
    grid.appendChild(tile);

    pc.ontrack = (event) => {
      video.srcObject = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      video.play().catch(() => {});
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) window.mirrorAPI.send({ type: 'candidate', senderId, candidate: event.candidate.toJSON() });
    };

    const peer = { pc, tile, chain: Promise.resolve() };
    peers.set(senderId, peer);
    updateLayout();
    return peer;
  }

  async function handle(msg) {
    const senderId = String(msg.senderId || '');
    if (!senderId) return;

    if (msg.type === 'remove') {
      removePeer(senderId);
      return;
    }
    if (msg.type === 'offer' && typeof msg.sdp === 'string') {
      removePeer(senderId); // a new offer replaces the previous relay for this sender
      const peer = createPeer(senderId);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      window.mirrorAPI.send({ type: 'answer', senderId, sdp: peer.pc.localDescription.sdp });
      return;
    }
    if (msg.type === 'candidate' && msg.candidate) {
      const peer = peers.get(senderId);
      if (peer) await peer.pc.addIceCandidate(msg.candidate);
    }
  }

  // Messages for one sender are handled strictly in order (a candidate must wait for its offer).
  const queues = new Map();
  window.mirrorAPI.onSignal((msg) => {
    const key = String((msg && msg.senderId) || '');
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.then(() => handle(msg)).catch((err) => console.warn('[Mirror] signal error:', err));
    queues.set(key, next);
  });

  window.mirrorAPI.ready();
})();
