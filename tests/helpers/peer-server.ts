import { PeerServer } from "peer";

// Match PeerJS Cloud's /peerjs WebSocket path without changing production options.
PeerServer({ host: "127.0.0.1", port: 4176, path: "/" }, () => {
  console.log("Test PeerServer listening on http://127.0.0.1:4176");
});
