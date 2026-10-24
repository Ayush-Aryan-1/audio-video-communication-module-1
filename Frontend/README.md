# Frontend deployment

The app uses WebRTC for media and Socket.IO for signaling. STUN alone cannot
establish media paths through every NAT or firewall, so production deployments
should configure a TURN service as a relay fallback.

Set these variables in the frontend build environment:

```env
VITE_SERVER_URL=https://your-signaling-server.example
VITE_TURN_URLS=turn:your-turn-server.example:3478,turns:your-turn-server.example:5349
VITE_TURN_USERNAME=temporary-username
VITE_TURN_CREDENTIAL=temporary-credential
```

`VITE_TURN_URLS` accepts a comma-separated list. TURN usernames and credentials
are included in the browser bundle, so use short-lived credentials generated
for clients rather than a permanent TURN-server secret. Without TURN settings,
the app falls back to STUN only and some networks will connect signaling but
fail to pass video.

Serve the frontend over HTTPS in production; browsers require a secure context
for camera and microphone access. To diagnose a failed media path, inspect the
browser console for the peer's ICE connection state.
