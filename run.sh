#!/bin/bash
cd "$(dirname "$0")"
PORT=8713
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "On this Mac:      http://localhost:$PORT"
[ -n "$IP" ] && echo "On your iPhone:   http://$IP:$PORT  (same Wi-Fi)"
(sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server "$PORT"
