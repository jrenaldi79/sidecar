#!/bin/bash
# Lightweight daemon that runs inside the VM.
# Starts OpenCode and bridges its HTTP API over VSOCK.

set -euo pipefail

OPENCODE_PORT=${OPENCODE_PORT:-8080}
WORKSPACE="/workspace"
VSOCK_PORT=${VSOCK_PORT:-8080}

log() { echo "[guest-agent] $(date -Iseconds) $*" >&2; }

# Mount workspace VirtioFS share if not already mounted
if ! mountpoint -q "$WORKSPACE" 2>/dev/null; then
    mkdir -p "$WORKSPACE"
    mount -t virtiofs workspace "$WORKSPACE" 2>/dev/null || log "VirtioFS mount skipped (may already be mounted by fstab)"
fi

# Start OpenCode server
log "Starting OpenCode on port $OPENCODE_PORT..."
opencode server --port "$OPENCODE_PORT" &
OPENCODE_PID=$!

# Wait for OpenCode to be ready
for i in $(seq 1 30); do
    if curl -s "http://127.0.0.1:$OPENCODE_PORT/health" >/dev/null 2>&1; then
        log "OpenCode ready on port $OPENCODE_PORT"
        break
    fi
    if [ "$i" -eq 30 ]; then
        log "ERROR: OpenCode failed to start after 15 seconds"
        kill "$OPENCODE_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 0.5
done

# Bridge VSOCK to OpenCode HTTP via socat
log "Bridging VSOCK port $VSOCK_PORT to OpenCode HTTP..."
socat VSOCK-LISTEN:"$VSOCK_PORT",fork TCP:127.0.0.1:"$OPENCODE_PORT" &
SOCAT_PID=$!

log "Guest agent ready. OpenCode PID=$OPENCODE_PID, socat PID=$SOCAT_PID"

# Clean shutdown on SIGTERM
cleanup() {
    log "Shutting down..."
    kill "$OPENCODE_PID" "$SOCAT_PID" 2>/dev/null || true
    wait "$OPENCODE_PID" "$SOCAT_PID" 2>/dev/null || true
    log "Shutdown complete."
}
trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait -n "$OPENCODE_PID" "$SOCAT_PID" 2>/dev/null || true
log "Process exited, cleaning up..."
cleanup
