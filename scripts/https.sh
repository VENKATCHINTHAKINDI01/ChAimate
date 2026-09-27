#!/usr/bin/env bash
# Serve the café app over HTTPS on your Wi-Fi so phones allow the microphone.
# Browsers only give the mic to secure pages: http://192.168.x.x never works on a phone, https:// does.
# The certificate is self-signed and local to this machine; nothing is exposed to the internet.
# On the phone, open the printed link once and tap "Advanced → Proceed" (Android) or "Show details → visit" (iPhone).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8443}"
IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
mkdir -p certs
if [ ! -f certs/cafe.pem ] || ! openssl x509 -in certs/cafe.pem -noout -text | grep -q "IP Address:$IP"; then
  echo "Creating a local certificate for $IP …"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout certs/cafe-key.pem -out certs/cafe.pem \
    -subj "/CN=Cafe Companion (local)" \
    -addext "subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost" >/dev/null 2>&1
fi
echo
echo "  Café app on your Wi-Fi:  https://$IP:$PORT/table?t=1"
echo "  Staff screen:            https://$IP:$PORT/staff"
echo "  (set PUBLIC_BASE_URL=https://$IP:$PORT in .env so the table QR codes point here)"
echo
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" \
  --ssl-keyfile certs/cafe-key.pem --ssl-certfile certs/cafe.pem
