# OpenCode Integration Guide for Claude Sidecar

> This guide teaches AI agents how to integrate with OpenCode SDK and Server APIs
> Last updated: 2026-01-26

## Executive Summary

OpenCode provides two integration methods:
1. **SDK** (`@opencode-ai/sdk`) - Type-safe JavaScript client for Node.js
2. **HTTP API** - REST endpoints for any language/environment

Both provide identical functionality. Use SDK for Node.js projects (cleaner), HTTP API for other languages or direct curl access.

---

## Key Concepts

### 1. Sessions Are Conversations

A **session** is a conversation with an AI model. Everything happens within sessions:
- Messages are sent to sessions
- Tool executions happen in sessions
- Results are captured in sessions

```javascript
// Create session → Send message → Get response → Delete session
const session = await client.session.create({ title: "Task" })
const response = await client.session.prompt(session.id, { content: "..." })
await client.session.delete(session.id)
```

### 2. Sync vs Async Operations

| Mode | Endpoint | Behavior | Use When |
|------|----------|----------|----------|
| **Sync** | `POST /session/:id/message` | Blocks until complete | Quick queries, need immediate result |
| **Async** | `POST /session/:id/prompt_async` | Returns immediately | Long tasks, background processing |

For async operations, monitor progress via SSE events.

### 3. Model Format (Critical!)

Models MUST be objects, not strings:

```javascript
// ❌ WRONG - causes 400 Bad Request
{ model: "google/gemini-2.5-flash" }

// ✅ CORRECT
{ model: { providerID: "openrouter", modelID: "google/gemini-2.5-flash" } }
```

### 4. Native Agents

OpenCode provides built-in agents with different capabilities:

| Agent | Tool Access | Use Case |
|-------|-------------|----------|
| `Build` | Full (read, write, bash, task) | Primary work agent |
| `Plan` | Read-only | Analysis, planning |
| `Explore` | Read-only | Codebase exploration |
| `General` | Full | Subagent tasks |

Pass agent via session options or message parameters.

---

## Integration Patterns

### Pattern 1: Simple Query (Sync)

For quick questions that don't require complex processing:

```javascript
// SDK
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
const session = await client.session.create({ title: "Quick query" })
const response = await client.session.prompt(session.id, {
  content: "What files handle authentication?"
})
console.log(response.content)
await client.session.delete(session.id)

// HTTP
curl -X POST http://localhost:4096/session -d '{"title":"Quick query"}'
# Returns: {"id":"session_abc"}
curl -X POST http://localhost:4096/session/session_abc/message \
  -d '{"content":"What files handle authentication?"}'
# Blocks until response
```

### Pattern 2: Background Task (Async + Events)

For long-running tasks that shouldn't block:

```javascript
// SDK
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
const session = await client.session.create({ title: "Refactor task" })

// Subscribe to events FIRST
client.event.subscribe((event) => {
  if (event.sessionId === session.id) {
    if (event.type === "session.complete") {
      console.log("Task finished!")
      // Capture result here
    }
  }
})

// Send async (returns immediately)
await client.session.promptAsync(session.id, {
  content: "Refactor the authentication module"
})

// Continue other work while task runs...
```

### Pattern 3: Context Injection (noReply)

Inject context without triggering a response:

```javascript
// Inject context
await client.session.prompt(session.id, {
  content: `Context from parent session:
  - User is debugging auth issues
  - Focus on JWT validation
  - Files already examined: auth.js, middleware.js`,
  noReply: true  // Critical: no AI response
})

// Now send actual task
await client.session.prompt(session.id, {
  content: "Given the context above, propose a fix"
})
```

### Pattern 4: Session Fork (Branch Conversation)

Fork a session to explore alternative approaches:

```javascript
// Get current session state
const session = await client.session.get(sessionId)
const messages = await client.session.messages(sessionId)

// Fork at specific message
const forked = await client.session.fork(sessionId, {
  messageId: messages[5].id  // Fork from message 5
})

// Forked session has all history up to message 5
await client.session.prompt(forked.id, {
  content: "Try a different approach..."
})
```

### Pattern 5: File Operations

Search and read files programmatically:

```javascript
// Search file contents
const results = await client.find.text({
  pattern: "authenticate",
  type: "js"  // Only JS files
})

// Find files by name
const files = await client.find.files({
  query: "auth",
  limit: 5
})

// Read specific file
const content = await client.file.read({
  path: results[0].file
})
```

### Pattern 6: Health Check Before Operations

Always verify server is healthy:

```javascript
async function ensureHealthy(client) {
  try {
    const health = await client.global.health()
    if (health.status !== "healthy") {
      throw new Error(`Server unhealthy: ${health.status}`)
    }
    return true
  } catch (e) {
    throw new Error(`Cannot reach OpenCode server: ${e.message}`)
  }
}

// Usage
await ensureHealthy(client)
// Now safe to proceed
```

---

## Sidecar-Specific Integration

### How Sidecar Uses OpenCode

1. **Context Extraction**: Read Claude Code session files, extract relevant turns
2. **Session Creation**: Create OpenCode session with model + agent
3. **Context Injection**: Send context with `noReply: true`
4. **Task Execution**: Send briefing, monitor for completion
5. **Summary Capture**: Extract final summary from session
6. **Cleanup**: Delete session or preserve for `resume`

### Key Integration Points

```javascript
// src/opencode-client.js
import { createOpencodeClient } from "@opencode-ai/sdk"

export async function createSession(options) {
  const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

  await ensureHealthy(client)

  return client.session.create({
    title: options.briefing,
    model: {
      providerID: options.provider || "openrouter",
      modelID: options.model
    },
    agent: options.agent  // "Build", "Plan", etc.
  })
}

export async function sendPrompt(sessionId, content, options = {}) {
  const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

  if (options.noReply) {
    // Context injection
    return client.session.prompt(sessionId, { content, noReply: true })
  }

  if (options.async) {
    // Background task
    return client.session.promptAsync(sessionId, { content })
  }

  // Synchronous (default)
  return client.session.prompt(sessionId, { content })
}
```

### Headless Mode Flow

```
┌────────────────────────────────────────────────────────────┐
│ Headless Mode (src/headless.js)                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 1. Create Session                                          │
│    POST /session                                           │
│    { title, model: { providerID, modelID }, agent }        │
│                                                            │
│ 2. Inject Context (if provided)                            │
│    POST /session/:id/message                               │
│    { content: contextData, noReply: true }                 │
│                                                            │
│ 3. Send Briefing (async)                                   │
│    POST /session/:id/prompt_async                          │
│    { content: briefing }                                   │
│                                                            │
│ 4. Poll for Completion                                     │
│    GET /session/:id → check status                         │
│    GET /session/:id/message → check for [SIDECAR_COMPLETE] │
│                                                            │
│ 5. Capture Summary                                         │
│    Extract text after [SIDECAR_COMPLETE] marker            │
│    Save to session-manager                                 │
│                                                            │
│ 6. Return to Claude Code                                   │
│    Output summary to stdout                                │
└────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `400 Bad Request` | Invalid model format | Use `{ providerID, modelID }` object |
| `404 Not Found` | Invalid session ID | Create new session or check ID |
| `409 Conflict` | Session is busy | Wait and retry, or abort first |
| `500 Server Error` | Server issue | Check logs, restart server |
| `ECONNREFUSED` | Server not running | Start with `opencode serve` |

### Retry Logic

```javascript
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (e.status === 409 && i < maxRetries - 1) {
        // Session busy, wait and retry
        await new Promise(r => setTimeout(r, delay * (i + 1)))
        continue
      }
      throw e
    }
  }
}

// Usage
await withRetry(() => client.session.prompt(id, { content: "..." }))
```

---

## Event Types Reference

When subscribing to SSE events:

| Event Type | Data | When Fired |
|------------|------|------------|
| `session.created` | Session object | New session created |
| `session.message` | Message object | New message added |
| `session.complete` | Final state | Session finished |
| `session.error` | Error details | Session failed |
| `tool.start` | Tool name, input | Tool execution started |
| `tool.complete` | Tool name, output | Tool execution finished |
| `tool.error` | Tool name, error | Tool execution failed |

---

## API Quick Reference

### Session Lifecycle

```
POST   /session                    → Create
GET    /session/:id                → Get details
GET    /session/:id/message        → Get messages
POST   /session/:id/message        → Send (sync)
POST   /session/:id/prompt_async   → Send (async)
POST   /session/:id/abort          → Stop
POST   /session/:id/fork           → Branch
DELETE /session/:id                → Delete
```

### File Operations

```
GET /find?pattern=X              → Search contents
GET /find/file?query=X           → Find by name
GET /find/symbol?query=X         → Find symbols
GET /file/content?path=X         → Read file
GET /file/status                 → Track status
```

### Monitoring

```
GET /global/health               → Server status
GET /global/event                → SSE stream
GET /agent                       → List agents
GET /mcp                         → MCP status
```

---

## Checklist: Integrating with OpenCode

- [ ] Use SDK for Node.js, HTTP for other languages
- [ ] Format models as `{ providerID, modelID }` objects
- [ ] Check health before critical operations
- [ ] Use `noReply: true` for context injection
- [ ] Use async endpoints + events for long tasks
- [ ] Handle 409 conflicts with retry logic
- [ ] Map agents correctly (`Build`, `Plan`, `Explore`, `General`)
- [ ] Poll session status for completion detection
- [ ] Clean up sessions when done
