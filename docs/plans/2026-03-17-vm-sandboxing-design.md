# VM-Sandboxed OpenCode Execution: Design Document

**Date:** 2026-03-17
**Status:** Approved
**Authors:** John Renaldi, Claude

## Problem

Sidecar currently runs OpenCode (and all its tool execution: bash, file read/write, etc.) directly on the host machine with no sandboxing. This is dangerous for any client where the user hasn't explicitly opted into local code execution.

### Sandbox-by-Default Policy

VM sandboxing is enabled for all clients **except** a known-safe allowlist:

| Client | Sandboxed? | Rationale |
|--------|-----------|-----------|
| `code-local` | No | User is already running code locally in Claude Code |
| `code-web` | No | User is already running code locally in Claude Code |
| `mcp-app` | Yes | Agent runs in Claude Desktop, no user approval for tool calls |
| `cowork` | Yes | Agent runs in Cowork, no user approval for tool calls |
| Unknown / undefined | Yes | Fail-safe: unknown clients are sandboxed by default |

This inverted guard (denylist of unsandboxed clients rather than allowlist of sandboxed clients) ensures that new or unrecognized clients default to the safer sandboxed path.

## Goals

1. Isolate OpenCode tool execution inside a lightweight macOS VM
2. Reuse the existing Cowork VM image (Ubuntu 22.04 ARM64) from Claude Desktop to avoid additional downloads
3. Mount project directories into the VM via VirtioFS so the agent can read/write project files
4. Keep sidecar orchestration on the host (session management, heartbeat, MCP server, UI coordination)
5. Design a clean platform abstraction for future Windows (WSL2) and Linux support
6. Provide a fallback to unsandboxed execution when the VM is unavailable

## Non-Goals

- Full security hardening against determined adversarial code (this is process/runtime isolation, not a hardened sandbox)
- Windows or Linux VM support in phase 1
- Moving sidecar orchestration into the VM
- Restricting outbound network access from the VM (may be added later)

## Architecture

### Boundary: OpenCode-Only in VM

Only OpenCode (the Go binary that runs agent tools) runs inside the VM. Sidecar's Node.js orchestration stays on the host. This minimizes architectural churn and fits existing code paths.

```
HOST (macOS)
+------------------------------------------------------+
|  Claude Desktop / Claude Code                        |
|       |                                              |
|  MCP Server (stdio)                                  |
|       |                                              |
|  Sidecar Node.js                                     |
|  +-- session-utils.js (metadata, heartbeat)          |
|  +-- mcp-app-server.js (UI coordination)             |
|  +-- crash-handler.js (cleanup + VM shutdown)        |
|  +-- src/vm/macos-vz.js (VM lifecycle)               |
|       |                                              |
|  sidecar-vm (Swift CLI)                              |
|       |                                              |
|  Virtualization.framework                            |
|       +- VSOCK (host <-> guest communication)        |
|       +- VirtioFS -- ~/project                       |
|                                                      |
+------------------------------------------------------+

VM (ARM64 Ubuntu 22.04, CoW overlay on Cowork image)
+------------------------------------------------------+
|  /workspace (VirtioFS mount)                         |
|                                                      |
|  opencode-ai (Go binary)                             |
|  +-- HTTP API on VSOCK port                          |
|  +-- bash tool execution                             |
|  +-- file read/write (scoped to VM + /workspace)     |
|  +-- all other agent tools                           |
|                                                      |
|  sidecar-guest-agent (lightweight daemon)            |
|  +-- health check endpoint                           |
|  +-- bootstraps opencode on VSOCK                    |
+------------------------------------------------------+
```

### Why OpenCode-Only (Not Everything)

GPT's review recommended against moving the full sidecar worker into the guest for phase 1. Reasons:

- Host-side orchestration, metadata, heartbeat, crash handling, and MCP coordination barely change
- Only the dangerous bits (bash, file writes, tool execution) are sandboxed
- Less provisioning needed (no Node.js/sidecar in VM, just OpenCode Go binary + guest agent)
- Communication is simpler: host just hits OpenCode's HTTP API over VSOCK

## Communication: VSOCK

Both Gemini and GPT flagged SSH-over-NAT as fragile. VSOCK is the recommended alternative.

```
Host                              VM
+-----------+     VSOCK port 8080 +---------------+
| Node.js   |<==================>| guest-agent   |
| (client)  |                    | -> opencode   |
+-----------+                    +---------------+
```

- Swift CLI configures VZVirtioSocketDeviceConfiguration
- Guest agent listens on VSOCK port 8080
- Host connects via VSOCK file descriptor (no network stack needed)
- OpenCode HTTP API proxied through guest agent on the same VSOCK port
- opencode-api.js gets a new transport: VSOCK alongside existing HTTP
- No SSH, no NAT, no IP discovery, no key management

## Image Strategy: CoW Overlay

Both models recommended against cloning the full 10GB image. A CoW (Copy-on-Write) overlay approach:

### Storage Layout

```
~/.config/sidecar/vm/
+-- base/
|   +-- rootfs.img -> symlink to Cowork image (read-only)
+-- derived/
|   +-- sidecar-provision.img   # One-time: opencode + guest-agent installed
+-- overlay/
|   +-- <task-id>.img           # Thin writable layer per session
+-- .origin-hash                # Cowork image version
+-- .provision-version          # Sidecar provisioning schema version
```

### How It Works

1. **First run:** Create sidecar-provision.img as a CoW snapshot of Cowork's rootfs.img. Boot it, install opencode-ai + sidecar-guest-agent, shut down. This is the derived base.
2. **Each session:** Create task-id.img as a CoW snapshot of sidecar-provision.img. Near-instant. Session writes go here.
3. **Session ends:** Delete task-id.img. Clean slate. No state leaks between sessions.
4. **Cowork updates:** Detect .origin-hash mismatch (compare to Cowork's .rootfs.img.origin). Re-derive sidecar-provision.img from new base.
5. **Sidecar updates:** Detect .provision-version mismatch. Re-provision even if base image hasn't changed.

**Disk cost:** ~50-200MB per session overlay instead of 10GB clone.

### Fallback Workspace

When no project directory is specified, a temporary workspace is created:

```
~/.config/sidecar/sessions/<task-id>/workspace/
```

Mounted into the VM at /workspace the same way a real project folder would be.

## VM Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| CPU | 2 cores | Configurable via SIDECAR_VM_CPUS |
| RAM | 2 GB | Configurable via SIDECAR_VM_RAM |
| Boot | VZEFIBootLoader | Uses efivars.fd from Cowork bundle |
| Disk | CoW overlay image | Per-session writable layer |
| Network | VZNATNetworkDeviceAttachment | For outbound internet access |
| Shared dir | VZVirtioFileSystemDeviceConfiguration | Project dir at /workspace |
| Socket | VZVirtioSocketDeviceConfiguration | VSOCK for host-guest API |

The VM boots at session start and shuts down at session end. No persistent background VM.

## Swift CLI: sidecar-vm

Minimal Swift binary (~200 lines) wrapping Virtualization.framework.

### Commands

```bash
sidecar-vm boot --workspace /path --ram 2 --cpus 2    # Boot VM, output VSOCK fd
sidecar-vm shutdown                                     # Graceful shutdown
sidecar-vm status                                       # Running/stopped
sidecar-vm list                                         # List all running sidecar VMs
```

### Code Signing and Distribution

Virtualization.framework requires the com.apple.security.virtualization entitlement. The Swift binary must be signed and notarized.

**Phase 1 approach: Homebrew tap.**

- `brew install sidecar/tap/sidecar-vm` for the native binary
- `npm install claude-sidecar` for the Node.js package
- postinstall.js checks for both and warns if sidecar-vm is missing

This cleanly separates native binary distribution (Homebrew handles signing) from the Node.js package.

### Entitlements Required

```xml
<key>com.apple.security.virtualization</key>
<true/>
```

## Platform Abstraction

```
src/vm/
+-- provider.js          # Abstract interface + factory
+-- macos-vz.js          # macOS: Swift CLI + VSOCK wrapper
+-- windows-wsl.js       # Future: WSL2 stub
+-- noop.js              # Fallback: runs directly (current behavior)
```

### Interface

```javascript
// Factory: returns the right provider for this platform
function createVMProvider(platform = process.platform) {
  if (platform === 'darwin' && !process.env.SIDECAR_VM_DISABLED) {
    return new MacOSProvider();
  }
  // if (platform === 'win32') { return new WSLProvider(); }  // future
  return new NoopProvider();  // unsandboxed fallback
}

// Caller (start.js): sandbox by default, only skip for known-safe clients
const UNSANDBOXED_CLIENTS = new Set(['code-local', 'code-web']);
if (!UNSANDBOXED_CLIENTS.has(client)) {
  vmProvider = createVMProvider();
  // ... boot VM, fall back to unsandboxed on failure
}

// Every provider implements:
// async isAvailable()                    - Can this provider run?
// async needsProvisioning()              - First run or image out of sync?
// async provision()                      - Create derived image, install opencode
// async boot({ workspace, ram, cpus })   - Start VM, return VSOCK connection
// async exec(command, opts)              - Run command inside VM
// async shutdown()                       - Stop VM, release resources
// async reconcileOrphans()               - Find and kill leaked VMs
```

### NoopProvider

Pass-through. exec() runs commands locally. This is the current unsandboxed behavior, used when:
- Client is `code-local` or `code-web` (known-safe, user already running code locally)
- Platform is not macOS
- Claude Desktop / Cowork VM image is not installed
- sidecar-vm binary is not installed
- User explicitly disables sandboxing (SIDECAR_VM_DISABLED=true)
- VM boot or provisioning fails (graceful fallback)

## Safety Features

### Capability Probe on Boot

Before relying on the VM, verify the guest has expected binaries:

```javascript
async boot(options) {
  // Boot VM with overlay, connect via VSOCK
  const probe = await this.exec(
    'command -v opencode && command -v sidecar-guest-agent'
  );
  if (!probe.ok) {
    logger.warn('VM capability probe failed, falling back to unsandboxed');
    return new NoopProvider();
  }
}
```

### Mount Scope Guardrails

Prevent mounting overly broad directories:

```javascript
function validateMountPath(hostPath) {
  const resolved = path.resolve(hostPath);
  const dangerous = [os.homedir(), '/', '/Users', '/var', '/etc', '/tmp'];
  if (dangerous.includes(resolved)) {
    throw new Error(
      `Refusing to mount ${resolved}. Mount a specific project directory.`
    );
  }
}
```

### Orphaned VM Cleanup

On sidecar startup, before booting a new VM:

```javascript
async reconcileOrphanedVMs() {
  const running = await this.listRunningVMs();  // sidecar-vm list
  for (const vm of running) {
    const session = await findSessionByVMId(vm.id);
    if (!session || session.status !== 'running') {
      await this.shutdown(vm.id);
      logger.warn({ vmId: vm.id }, 'Cleaned up orphaned VM');
    }
  }
}
```

### Image Sync

Two-layer version tracking:

| Check | Source | Triggers |
|-------|--------|----------|
| .origin-hash | Cowork's .rootfs.img.origin | Re-derive from new base |
| .provision-version | Sidecar's package version | Re-provision with updated tooling |

## Session Lifecycle

### Normal Session

```
1. sidecar_start called
2. reconcileOrphanedVMs()
3. validateMountPath(workspace)
4. Create CoW overlay from derived base
5. Boot VM with VirtioFS mount + VSOCK
6. Capability probe via VSOCK
7. Start OpenCode inside VM via guest agent
8. Host-side sidecar manages session (heartbeat, metadata, polling)
9. Host hits OpenCode HTTP API over VSOCK
10. Session ends -> shutdown VM -> delete overlay
```

### First-Ever Run

```
1. postinstall.js warns if Claude Desktop or sidecar-vm not found
2. sidecar_start called
3. needsProvisioning() -> true
4. Create sidecar-provision.img as CoW of Cowork base (~instant)
5. Boot provision image, install opencode + guest-agent
6. Shut down, mark .provision-version
7. Store .origin-hash
8. Continue with normal session flow (steps 2-10 above)
```

### Crash/Abort

```
1. crash-handler or SIGTERM
2. vm.shutdown() in finally block
3. Delete session overlay
4. Next startup: reconcileOrphanedVMs() catches any leaked VMs
```

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| src/vm/provider.js | Abstract VM interface + factory |
| src/vm/macos-vz.js | macOS Swift CLI wrapper + VSOCK client |
| src/vm/noop.js | Pass-through fallback (current behavior) |
| swift/sidecar-vm/ | Swift CLI binary source |
| swift/sidecar-vm/guest-agent/ | Lightweight guest daemon source |

### Modified Files

| File | Change |
|------|--------|
| src/utils/opencode-api.js | Add VSOCK transport alongside HTTP |
| src/sidecar/start.js | Boot VM before OpenCode, shutdown after |
| src/headless.js | Accept VM provider, route through VM |
| src/sidecar/crash-handler.js | Add vm.shutdown() to cleanup |
| scripts/postinstall.js | Check for Claude Desktop + sidecar-vm |
| package.json | Add sidecar-vm as optional peer dependency |

### Unchanged

- All session management code (session-utils.js, session-manager.js)
- MCP server (mcp-server.js, mcp-tools.js)
- MCP app UI (src/mcp-app/*)
- CLI parsing (cli.js, cli-handlers.js)
- Context building (context.js, context-compression.js)
- Heartbeat and crash handler logic (adds vm.shutdown() only)

## Install-Time Requirements

| Dependency | Required? | Check |
|------------|-----------|-------|
| Claude Desktop | Yes (for VM image) | /Applications/Claude.app |
| Cowork VM image | Yes | ~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/rootfs.img |
| sidecar-vm | Yes (for sandboxing) | brew install sidecar/tap/sidecar-vm |
| Apple Silicon Mac | Yes | process.arch === 'arm64' |

If any are missing, sidecar falls back to NoopProvider (unsandboxed, current behavior) with a warning.

## Configuration

```bash
SIDECAR_VM_RAM=2              # GB, default 2
SIDECAR_VM_CPUS=2             # cores, default 2
SIDECAR_VM_DISABLED=true      # Force unsandboxed mode
```

## Known Limitations

- **Apple Silicon only.** Intel Macs cannot run the ARM64 Cowork image. Falls back to unsandboxed.
- **Depends on Claude Desktop.** The Cowork VM image must be present. If Claude Desktop is uninstalled, falls back to unsandboxed.
- **~10-30s boot time.** Adds latency to session start. Acceptable for agent sessions that run minutes.
- **Partial sandbox.** The agent has read-write access to the mounted workspace and outbound network access. This is process/runtime isolation, not full containment.
- **Case sensitivity.** macOS (case-insensitive) mounted into Linux (case-sensitive) via VirtioFS may cause edge cases. Document and test.

## Future Work

- Windows support via WSL2
- Network policy (restrict outbound access from VM)
- Warm VM pool (pre-boot VM for faster session start)
- Move more into VM if needed (sidecar worker, full Node.js)
- Concurrent session support (multiple VMs with independent VSOCK ports)

## Review Sources

This design incorporates feedback from Gemini and GPT reviews:

- **VSOCK over SSH:** Both models recommended VSOCK as more robust than SSH/NAT
- **CoW overlays:** Both recommended against full image cloning
- **OpenCode-only in VM:** GPT recommended against moving everything into VM for phase 1
- **Code signing:** Gemini flagged entitlement requirements as potential showstopper
- **Capability probe:** GPT recommended fail-closed verification on boot
- **Orphan cleanup:** GPT recommended startup-time reconciliation
- **Mount guardrails:** Gemini flagged broad mount scope as security risk
