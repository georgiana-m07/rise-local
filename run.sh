#!/bin/bash
cd "$(dirname "$0")"
PORT=8713
(sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server "$PORT"
