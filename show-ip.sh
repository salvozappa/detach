#!/bin/bash

echo "======================================"
echo "  Detach.it - Access Information"
echo "======================================"
echo ""

# Get LAN IP address (works on macOS and Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
else
    # Linux
    LAN_IP=$(hostname -I | awk '{print $1}')
fi

if [ -z "$LAN_IP" ]; then
    echo "⚠️  Could not detect LAN IP address"
    echo ""
else
    echo "📱 Access from your phone:"
    echo "   http://${LAN_IP}:8080"
    echo ""
fi

echo "💻 Local access:"
echo "   http://localhost:8080"
echo ""
echo "🔧 Bridge WebSocket:"
echo "   ws://localhost:8081"
echo ""
echo "🐚 SSH to sandbox (debugging):"
echo "   ssh -i keys/dev -p 2222 detach-dev@localhost"
echo ""
echo "======================================"
