import { PeerServer } from "peer";

const signalingPort = Number(process.env.PLAYWRIGHT_SIGNALING_PORT ?? 4176);

// Match PeerJS Cloud's /peerjs WebSocket path without changing production options.
PeerServer({ host: "127.0.0.1", port: signalingPort, path: "/" }, () => {
  console.log(`Test PeerServer listening on http://127.0.0.1:${signalingPort}`);
});
