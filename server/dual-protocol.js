'use strict';

const net = require('net');

const TLS_HANDSHAKE_BYTE = 0x16;
const FIRST_BYTE_TIMEOUT_MS = 10 * 1000;

/**
 * Creates a TCP listener that serves both plain HTTP and TLS on the same port.
 * The first byte of every connection tells them apart: a TLS ClientHello starts
 * with 0x16, anything else is treated as plain HTTP. The sockets are handed to
 * the given (non-listening) http/https servers, so Express and Socket.IO behave
 * exactly as if each server had accepted the connection itself.
 *
 * @param {import('http').Server} httpServer
 * @param {import('https').Server | null} httpsServer
 * @returns {import('net').Server}
 */
function createDualListener(httpServer, httpsServer) {
  return net.createServer((socket) => {
    socket.on('error', () => {});
    socket.setTimeout(FIRST_BYTE_TIMEOUT_MS, () => socket.destroy());

    socket.once('data', (chunk) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(chunk);
      const target = httpsServer && chunk[0] === TLS_HANDSHAKE_BYTE ? httpsServer : httpServer;
      target.emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
}

module.exports = { createDualListener, TLS_HANDSHAKE_BYTE };
