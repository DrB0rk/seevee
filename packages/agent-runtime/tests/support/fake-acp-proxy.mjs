/**
 * Transparent byte proxy between the adapter's spawned process and the fake
 * ACP peer.
 *
 * The adapter owns its provider process, so a test cannot inject requests into
 * it directly. This shim is what the adapter actually spawns: it pipes its
 * stdin/stdout to a Unix socket served by the peer, letting the test both drive
 * the peer and push server requests into the adapter.
 *
 * Launched as: node fake-acp-proxy.mjs   (SEEVEE_ACP_SOCKET must be set)
 */
import net from 'node:net';

const socketPath = process.env['SEEVEE_ACP_SOCKET'];
if (socketPath === undefined) {
  process.stderr.write('SEEVEE_ACP_SOCKET is required\n');
  process.exit(1);
}

const socket = net.connect(socketPath);
socket.on('connect', () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on('error', () => process.exit(0));
process.stdin.on('end', () => socket.end());
process.stdin.on('error', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));