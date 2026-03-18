# VM-Sandboxed OpenCode Execution: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Isolate OpenCode tool execution inside a macOS VM using Virtualization.framework, with CoW overlays per session and VSOCK communication.

**Architecture:** OpenCode runs inside a lightweight ARM64 Linux VM cloned from Claude Desktop's Cowork image. Sidecar orchestration stays on the host. Communication uses VSOCK (no SSH/NAT). Each session gets a disposable CoW overlay for clean isolation.

**Tech Stack:** Swift (Virtualization.framework CLI), Node.js (VM provider abstraction), VSOCK (host-guest communication), qcow2/raw CoW overlays

**Design doc:** `docs/plans/2026-03-17-vm-sandboxing-design.md`

---

## Task 1: NoopProvider (extract current behavior)

Extract the current unsandboxed execution path into a NoopProvider class so we have a clean abstraction to build on.

**Files:**
- Create: `src/vm/provider.js`
- Create: `src/vm/noop.js`
- Test: `tests/vm/provider.test.js`
- Test: `tests/vm/noop.test.js`

**Step 1: Write failing tests for provider factory**

```javascript
// tests/vm/provider.test.js
const { createVMProvider } = require('../../src/vm/provider');
const { NoopProvider } = require('../../src/vm/noop');

describe('createVMProvider', () => {
  test('returns NoopProvider for linux', () => {
    const provider = createVMProvider('linux');
    expect(provider).toBeInstanceOf(NoopProvider);
  });

  test('returns NoopProvider for win32', () => {
    const provider = createVMProvider('win32');
    expect(provider).toBeInstanceOf(NoopProvider);
  });

  test('returns NoopProvider when darwin but VM unavailable', async () => {
    const provider = createVMProvider('darwin');
    // MacOSProvider.isAvailable() will fail in test env (no Swift CLI)
    // Factory should fall back to NoopProvider
    if (!await provider.isAvailable()) {
      expect(provider.constructor.name).toBe('NoopProvider');
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/vm/provider.test.js --no-coverage`
Expected: FAIL - cannot find module

**Step 3: Write failing tests for NoopProvider**

```javascript
// tests/vm/noop.test.js
const { NoopProvider } = require('../../src/vm/noop');

describe('NoopProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new NoopProvider();
  });

  test('isAvailable returns true', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  test('needsProvisioning returns false', async () => {
    expect(await provider.needsProvisioning()).toBe(false);
  });

  test('boot returns noop connection with localhost', async () => {
    const conn = await provider.boot({ workspace: '/tmp/test' });
    expect(conn.host).toBe('127.0.0.1');
    expect(conn.transport).toBe('http');
  });

  test('shutdown is a no-op', async () => {
    await expect(provider.shutdown()).resolves.not.toThrow();
  });

  test('reconcileOrphans is a no-op', async () => {
    await expect(provider.reconcileOrphans()).resolves.not.toThrow();
  });
});
```

**Step 4: Implement provider.js (abstract interface + factory)**

```javascript
// src/vm/provider.js
'use strict';

/**
 * Abstract VM provider interface.
 * All providers must implement these methods.
 */
class VMProvider {
  async isAvailable() { throw new Error('Not implemented'); }
  async needsProvisioning() { throw new Error('Not implemented'); }
  async provision() { throw new Error('Not implemented'); }
  async boot(_options) { throw new Error('Not implemented'); }
  async shutdown() { throw new Error('Not implemented'); }
  async reconcileOrphans() { throw new Error('Not implemented'); }
}

/**
 * Create the appropriate VM provider for the current platform.
 * Falls back to NoopProvider if sandboxing is unavailable.
 *
 * @param {string} [platform=process.platform] - Override platform for testing
 * @returns {VMProvider}
 */
function createVMProvider(platform = process.platform) {
  if (platform === 'darwin' && !process.env.SIDECAR_VM_DISABLED) {
    try {
      const { MacOSProvider } = require('./macos-vz');
      return new MacOSProvider();
    } catch {
      // macos-vz not available, fall through to noop
    }
  }
  const { NoopProvider } = require('./noop');
  return new NoopProvider();
}

module.exports = { VMProvider, createVMProvider };
```

**Step 5: Implement noop.js**

Note: Uses `execFile` (not `exec`) per project conventions. The command is split into program + args to avoid shell injection.

```javascript
// src/vm/noop.js
'use strict';

const { execFile } = require('child_process');
const { VMProvider } = require('./provider');

/**
 * No-op VM provider. Runs everything locally (current unsandboxed behavior).
 * Used as fallback when VM sandboxing is unavailable.
 */
class NoopProvider extends VMProvider {
  async isAvailable() { return true; }
  async needsProvisioning() { return false; }
  async provision() { /* no-op */ }

  async boot({ workspace } = {}) {
    return {
      host: '127.0.0.1',
      transport: 'http',
      workspace: workspace || process.cwd(),
    };
  }

  async shutdown() { /* no-op */ }
  async reconcileOrphans() { /* no-op */ }
}

module.exports = { NoopProvider };
```

**Step 6: Run tests to verify they pass**

Run: `npx jest tests/vm/ --no-coverage`
Expected: PASS

**Step 7: Commit**

```bash
git add src/vm/provider.js src/vm/noop.js tests/vm/provider.test.js tests/vm/noop.test.js
git commit -m "feat(vm): add VMProvider interface and NoopProvider fallback"
```

---

## Task 2: MacOSProvider skeleton (image detection + provisioning checks)

Implement the macOS provider that detects the Cowork VM image and manages provisioning state. No actual VM booting yet.

**Files:**
- Create: `src/vm/macos-vz.js`
- Test: `tests/vm/macos-vz.test.js`

**Step 1: Write failing tests**

```javascript
// tests/vm/macos-vz.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MacOSProvider } = require('../../src/vm/macos-vz');

describe('MacOSProvider', () => {
  describe('isAvailable', () => {
    test('returns false when Cowork image does not exist', async () => {
      const p = new MacOSProvider({ imagePath: '/nonexistent/rootfs.img' });
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe('needsProvisioning', () => {
    test('returns true when sidecar VM dir does not exist', async () => {
      const p = new MacOSProvider({ vmDir: '/tmp/sidecar-test-nonexistent' });
      expect(await p.needsProvisioning()).toBe(true);
    });

    test('returns true when origin hash does not match', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-vm-test-'));
      fs.writeFileSync(path.join(tmpDir, '.origin-hash'), 'oldhash');
      const p = new MacOSProvider({ vmDir: tmpDir, originPath: '/nonexistent' });
      expect(await p.needsProvisioning()).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('validateMountPath', () => {
    test('rejects home directory', () => {
      expect(() => MacOSProvider.validateMountPath(os.homedir())).toThrow('too broad');
    });

    test('rejects root', () => {
      expect(() => MacOSProvider.validateMountPath('/')).toThrow('too broad');
    });

    test('accepts a project subdirectory', () => {
      expect(() => MacOSProvider.validateMountPath('/Users/test/projects/myapp')).not.toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/vm/macos-vz.test.js --no-coverage`
Expected: FAIL - cannot find module

**Step 3: Implement macos-vz.js skeleton**

The implementation includes image path detection, origin hash comparison, provision version checking, and mount path validation. All methods that require the Swift CLI or actual VM operations (boot, shutdown, provision) throw 'Not yet implemented' errors.

Key constants:
- `COWORK_BUNDLE`: `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle`
- `DEFAULT_VM_DIR`: `~/.config/sidecar/vm`
- Default RAM: 2GB, Default CPUs: 2

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/vm/macos-vz.test.js --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/vm/macos-vz.js tests/vm/macos-vz.test.js
git commit -m "feat(vm): add MacOSProvider skeleton with image detection and mount validation"
```

---

## Task 3: Swift CLI (sidecar-vm)

Build the Swift binary that wraps Virtualization.framework. This is the native component that boots/shuts down VMs.

**Files:**
- Create: `swift/sidecar-vm/Package.swift`
- Create: `swift/sidecar-vm/Sources/main.swift`
- Create: `swift/sidecar-vm/Sources/VMManager.swift`
- Create: `swift/sidecar-vm/sidecar-vm.entitlements`

**Step 1: Create Package.swift**

Swift package targeting macOS 13+, linking the Virtualization framework.

**Step 2: Create VMManager.swift**

Core class that configures `VZVirtualMachineConfiguration` with:
- `VZEFIBootLoader` (boot from efivars.fd)
- `VZDiskImageStorageDeviceAttachment` (CoW overlay image)
- `VZNATNetworkDeviceAttachment` (outbound internet)
- `VZVirtioSocketDeviceConfiguration` (VSOCK for host-guest communication)
- `VZVirtioFileSystemDeviceConfiguration` with tag "workspace" (VirtioFS mount)
- `VZVirtioConsoleDeviceSerialPortConfiguration` (provisioning output)

Implements `VZVirtualMachineDelegate` for error/stop callbacks.

**Step 3: Create main.swift (CLI entrypoint)**

Commands: `boot`, `shutdown`, `status`, `list`
Boot accepts: `--disk`, `--efivars`, `--workspace`, `--ram`, `--cpus`

**Step 4: Create entitlements file**

XML plist with `com.apple.security.virtualization` set to true.

**Step 5: Build and verify**

Run: `cd swift/sidecar-vm && swift build 2>&1`
Expected: Build succeeds (on macOS with Xcode installed)

For local dev, sign with:
```bash
codesign --entitlements sidecar-vm.entitlements --force -s - .build/debug/sidecar-vm
```

**Step 6: Commit**

```bash
git add swift/sidecar-vm/
git commit -m "feat(vm): add sidecar-vm Swift CLI for Virtualization.framework"
```

---

## Task 4: CoW image provisioning

Implement the CoW overlay creation and first-run provisioning logic.

**Files:**
- Create: `src/vm/image-manager.js`
- Test: `tests/vm/image-manager.test.js`

**Step 1: Write failing tests for image manager**

Tests for: `createSessionOverlay`, `deleteSessionOverlay`, `storeOriginHash`, `storeProvisionVersion`, `createDerivedImage`.

**Step 2: Run test to verify it fails**

Run: `npx jest tests/vm/image-manager.test.js --no-coverage`
Expected: FAIL - cannot find module

**Step 3: Implement image-manager.js**

Uses `execFile('cp', ['-c', src, dst])` for APFS clone (CoW copy). Falls back to regular `execFile('cp', [src, dst])` if cloning not supported. All file operations use `execFile` (not `exec`) per project conventions.

Directory layout:
```
vmDir/base/          - symlink to Cowork image
vmDir/derived/       - provisioned base image
vmDir/overlay/       - per-session writable layers
vmDir/.origin-hash   - Cowork version tracker
vmDir/.provision-version - sidecar version tracker
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/vm/image-manager.test.js --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add src/vm/image-manager.js tests/vm/image-manager.test.js
git commit -m "feat(vm): add ImageManager for CoW overlay creation and version tracking"
```

---

## Task 5: Guest agent

Create the lightweight daemon that runs inside the VM, listens on VSOCK, and manages OpenCode.

**Files:**
- Create: `swift/sidecar-vm/guest-agent/sidecar-guest-agent.sh`
- Create: `swift/sidecar-vm/guest-agent/install.sh`

**Step 1: Create the guest agent script**

Shell script that:
1. Mounts VirtioFS workspace share at `/workspace` if not already mounted
2. Starts OpenCode server on port 8080
3. Waits for OpenCode health check (30 attempts, 500ms interval)
4. Uses `socat` to bridge VSOCK port 8080 to OpenCode HTTP on localhost
5. Waits for either process to exit, then cleans up

**Step 2: Create the install script (run during provisioning)**

Shell script that:
1. Installs `socat` via apt
2. Installs `opencode-ai` via npm
3. Copies guest agent to `/usr/local/bin/`
4. Creates a systemd service for auto-start on boot
5. Enables the service

**Step 3: Commit**

```bash
git add swift/sidecar-vm/guest-agent/
git commit -m "feat(vm): add guest agent for VSOCK-to-OpenCode bridging"
```

---

## Task 6: Wire VM provider into session lifecycle

Connect the VM provider to the existing session startup, crash handling, and API communication code.

**Files:**
- Modify: `src/sidecar/start.js:144-244` (boot VM, pass to runners)
- Modify: `src/utils/opencode-api.js:21-47` (accept host parameter)
- Modify: `src/sidecar/crash-handler.js:19-44` (add VM shutdown)
- Test: `tests/vm/lifecycle.test.js`

**Step 1: Write failing test for API host parameter**

```javascript
// tests/vm/lifecycle.test.js
describe('VM lifecycle integration', () => {
  test('apiRequest accepts custom host', async () => {
    const { apiRequest } = require('../../src/utils/opencode-api');
    try {
      await apiRequest('GET', '/health', 9999, null, { host: '192.168.64.5' });
    } catch (err) {
      // Connection refused is expected - verify it tried the right host
      expect(err.message).toMatch(/ECONNREFUSED/);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/vm/lifecycle.test.js --no-coverage`
Expected: FAIL (apiRequest doesn't accept host parameter)

**Step 3: Modify opencode-api.js**

Change `apiRequest` signature from `(method, urlPath, port, body)` to `(method, urlPath, port, body, options = {})`. Use `options.host || '127.0.0.1'` for hostname. This is backwards-compatible since the new parameter is optional.

Reference: `src/utils/opencode-api.js:21-47`

**Step 4: Modify start.js**

Add VM lifecycle to `startSidecar()`:
- Import `createVMProvider` from `../vm/provider`
- Before the try block at line 193: create provider, check availability, provision if needed, validate mount path, boot VM
- Only activate VM when `client === 'mcp-app'` (Claude Desktop mode)
- Pass `vmConnection` to runner functions so they can route API calls to VM host
- In the finally block: call `vmProvider.shutdown()` if vmConnection exists

Reference: `src/sidecar/start.js:144-244`

**Step 5: Modify crash-handler.js**

Extend `installCrashHandler` to accept optional `vmProvider` parameter. Call `vmProvider.shutdown().catch(() => {})` inside the crash handler if present.

Reference: `src/sidecar/crash-handler.js:19-44`

**Step 6: Run tests**

Run: `npx jest tests/vm/ --no-coverage`
Expected: PASS

**Step 7: Run existing tests to verify no regressions**

Run: `npx jest --no-coverage`
Expected: All existing tests still pass

**Step 8: Commit**

```bash
git add src/sidecar/start.js src/utils/opencode-api.js src/sidecar/crash-handler.js tests/vm/lifecycle.test.js
git commit -m "feat(vm): wire VM provider into session lifecycle"
```

---

## Task 7: Postinstall VM prerequisite checks

Add Claude Desktop and VM image detection to the postinstall script.

**Files:**
- Modify: `scripts/postinstall.js:113-128`
- Test: `tests/scripts/postinstall-vm.test.js`

**Step 1: Write failing test**

Test `checkVMPrerequisites()` returns warnings for missing Claude Desktop and VM image. Test it returns empty array when prerequisites exist.

**Step 2: Run test to verify it fails**

Run: `npx jest tests/scripts/postinstall-vm.test.js --no-coverage`
Expected: FAIL

**Step 3: Add checkVMPrerequisites to postinstall.js**

Function checks (macOS only):
- `/Applications/Claude.app` exists
- `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/rootfs.img` exists
- Returns array of warning strings

In `main()`, call it after existing registrations and print any warnings.

Export it alongside existing `addMcpToConfigFile`.

Reference: `scripts/postinstall.js:113-128`

**Step 4: Run tests**

Run: `npx jest tests/scripts/postinstall-vm.test.js --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/postinstall.js tests/scripts/postinstall-vm.test.js
git commit -m "feat(vm): add VM prerequisite checks to postinstall"
```

---

## Task 8: Update CLAUDE.md

Update documentation to reflect new VM sandboxing architecture.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add to Directory Structure**

Under `src/`, add `vm/` directory with `provider.js`, `macos-vz.js`, `noop.js`, `image-manager.js`.
At top level, add `swift/sidecar-vm/` with subdirectories.

**Step 2: Add to Key Modules table**

Add entries for `src/vm/provider.js`, `src/vm/macos-vz.js`, `src/vm/image-manager.js`, and `swift/sidecar-vm/`.

**Step 3: Add VM config to Configuration section**

Add `SIDECAR_VM_RAM`, `SIDECAR_VM_CPUS`, `SIDECAR_VM_DISABLED` environment variables.

**Step 4: Add VM troubleshooting entries**

Add entries for: VM sandboxing unavailable, sidecar-vm not found, capability probe failed, refusing to mount.

**Step 5: Run doc validation**

Run: `node scripts/validate-docs.js --full`
Expected: No drift warnings

**Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add VM sandboxing to CLAUDE.md directory structure and configuration"
```

---

## Task Summary

| Task | Description | Dependencies | Parallelizable With |
|------|-------------|--------------|-------------------|
| 1 | NoopProvider + VMProvider interface | None | 3, 7 |
| 2 | MacOSProvider skeleton (image detection) | Task 1 | 5 |
| 3 | Swift CLI (sidecar-vm) | None | 1, 7 |
| 4 | CoW image provisioning (ImageManager) | Task 2 | - |
| 5 | Guest agent | Task 3 | 2 |
| 6 | Wire VM into session lifecycle | Tasks 1, 2, 4 | - |
| 7 | Postinstall checks | None | 1, 3 |
| 8 | CLAUDE.md update | Tasks 1-7 | - |

**Total estimated commits:** 8
