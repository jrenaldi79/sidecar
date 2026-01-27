# OpenCode SDK Documentation

> Source: https://opencode.ai/docs/sdk/
> Last updated: 2026-01-26

## Overview

The OpenCode SDK provides a type-safe JavaScript/TypeScript client for programmatic interaction with the OpenCode server. It enables building integrations, plugins, and automated workflows.

## Installation

```bash
npm install @opencode-ai/sdk
```

## Client Creation

### Standard Initialization (Spawns Server)

```javascript
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode()
```

This creates a client AND spawns the OpenCode server if not already running.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hostname` | string | `127.0.0.1` | Server address |
| `port` | number | `4096` | Server port |
| `signal` | AbortSignal | - | Cancellation signal |
| `timeout` | number | `5000` | Startup timeout in ms |
| `config` | object | - | Configuration override |

### Client-Only Connection (Existing Server)

```javascript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
})
```

Use this when connecting to an already-running server instance.

---

## Core APIs

### Global Operations

```javascript
// Health check - returns server version and status
const health = await client.global.health()
// Returns: { version: string, status: string }
```

### Application Management

```javascript
// Write log entry
await client.app.log({
  service: "my-plugin",
  level: "info",
  message: "Operation completed"
})

// List available agents
const agents = await client.app.agents()
// Returns: Agent[] with name, description, capabilities
```

### Project Management

```javascript
// List all projects
const projects = await client.project.list()

// Get current active project
const current = await client.project.current()
// Returns: { path: string, name: string, ... }
```

---

## Session Management

Sessions are the core abstraction for conversations with AI models.

### Session Lifecycle

```javascript
// Create new session
const session = await client.session.create({
  title: "Debug authentication issue",
  model: { providerID: "openrouter", modelID: "google/gemini-2.5-flash" }
})

// List all sessions
const sessions = await client.session.list()

// Get specific session
const session = await client.session.get(sessionId)

// Delete session
await client.session.delete(sessionId)
```

### Sending Messages

```javascript
// Send message and await response (synchronous)
const response = await client.session.prompt(sessionId, {
  content: "Explain the authentication flow"
})

// Send message asynchronously (returns immediately)
await client.session.promptAsync(sessionId, {
  content: "Refactor this module"
})
// Use events to monitor progress
```

### Context Injection (No Reply)

For plugins that need to inject context without triggering a response:

```javascript
await client.session.prompt(sessionId, {
  content: "Context: User is working on auth module",
  noReply: true  // Injects context without AI response
})
```

### Session Control

```javascript
// Abort running operation
await client.session.abort(sessionId)

// Fork session at specific message
const forked = await client.session.fork(sessionId, messageId)

// Share session (get shareable link)
const shareInfo = await client.session.share(sessionId)

// Unshare session
await client.session.unshare(sessionId)
```

### Shell/Command Execution

```javascript
// Execute shell command in session context
await client.session.shell(sessionId, {
  command: "npm test"
})

// Execute slash command
await client.session.command(sessionId, {
  command: "/clear"
})
```

---

## File Operations

### Search File Contents

```javascript
// Search for text pattern in files
const results = await client.find.text({
  pattern: "TODO",
  path: "./src",
  type: "js"  // Optional: file type filter
})
```

### Find Files by Name

```javascript
// Locate files matching query
const files = await client.find.files({
  query: "auth",
  limit: 10
})
```

### Symbol Search

```javascript
// Find symbols in workspace
const symbols = await client.find.symbol({
  query: "authenticate"
})
```

### Read File Contents

```javascript
// Get file content
const content = await client.file.read({
  path: "./src/auth.js",
  format: "raw"  // or "patch" for diff format
})

// Check file status (tracked changes)
const status = await client.file.status()
```

---

## TUI (Terminal UI) Control

Programmatically control the terminal interface:

```javascript
// Add text to prompt input
await client.tui.appendPrompt({ text: "Review this code" })

// Submit the current prompt
await client.tui.submitPrompt()

// Clear prompt input
await client.tui.clearPrompt()

// Show toast notification
await client.tui.showToast({
  message: "Operation completed",
  type: "success"  // "success" | "error" | "info"
})

// Open dialogs
await client.tui.openSessions()
await client.tui.openModels()
await client.tui.openHelp()
```

---

## Real-Time Events (SSE)

Subscribe to server-sent events for real-time updates:

```javascript
// Subscribe to events
const unsubscribe = client.event.subscribe((event) => {
  switch (event.type) {
    case "session.message":
      console.log("New message:", event.data)
      break
    case "session.complete":
      console.log("Session completed")
      break
    case "tool.start":
      console.log("Tool execution started:", event.data.tool)
      break
    case "tool.complete":
      console.log("Tool finished:", event.data.result)
      break
  }
})

// Later: unsubscribe
unsubscribe()
```

---

## TypeScript Support

Types are derived from OpenAPI specifications:

```typescript
import type { Session, Message, Agent } from "@opencode-ai/sdk"

// Full type safety for all API operations
const session: Session = await client.session.get(id)
const messages: Message[] = await client.session.messages(id)
```

---

## Error Handling

```javascript
try {
  const response = await client.session.prompt(sessionId, { content: "..." })
} catch (error) {
  if (error.status === 400) {
    console.error("Bad request:", error.message)
  } else if (error.status === 404) {
    console.error("Session not found")
  } else if (error.status === 500) {
    console.error("Server error:", error.message)
  }
}
```

---

## Best Practices

1. **Use client-only mode** when connecting to existing servers
2. **Handle AbortSignal** for long-running operations
3. **Subscribe to events** for async operations instead of polling
4. **Use `noReply: true`** for context injection without responses
5. **Check health** before critical operations
6. **Handle errors** with proper status code checks

---

## Integration Patterns

### Plugin Development

```javascript
// Inject context without response
await client.session.prompt(sessionId, {
  content: `Plugin context: ${JSON.stringify(pluginData)}`,
  noReply: true
})

// Then trigger actual work
await client.session.prompt(sessionId, {
  content: "Use the plugin context above to..."
})
```

### Automated Workflows

```javascript
// Create session, execute task, capture result
const session = await client.session.create({ title: "Auto task" })
const response = await client.session.prompt(session.id, {
  content: "Analyze codebase and report issues"
})
await client.session.delete(session.id)
```

### Monitoring & Observability

```javascript
// Subscribe to all events for logging
client.event.subscribe((event) => {
  logger.info("OpenCode event", {
    type: event.type,
    sessionId: event.sessionId,
    timestamp: new Date()
  })
})
```
