#!/bin/bash
# Run inside the VM during provisioning to install dependencies.
# Called once when creating the derived (provisioned) image.

set -euo pipefail

log() { echo "[provision] $*"; }

log "Installing guest agent dependencies..."

# Install socat for VSOCK-to-HTTP bridging
apt-get update -qq && apt-get install -y -qq socat

# Install opencode
log "Installing opencode-ai..."
npm install -g opencode-ai

# Install guest agent script
cp /tmp/sidecar-guest-agent.sh /usr/local/bin/sidecar-guest-agent
chmod +x /usr/local/bin/sidecar-guest-agent

# Create systemd service for auto-start on boot
cat > /etc/systemd/system/sidecar-guest-agent.service << 'UNIT'
[Unit]
Description=Sidecar Guest Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sidecar-guest-agent
Restart=on-failure
RestartSec=3
Environment=OPENCODE_PORT=8080
Environment=VSOCK_PORT=8080

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sidecar-guest-agent

log "Guest agent installed and enabled."
