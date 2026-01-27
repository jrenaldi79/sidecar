# OpenCode Server API Documentation

> Source: https://opencode.ai/docs/server/
> Last updated: 2026-01-26

## Overview

OpenCode exposes an HTTP server that enables programmatic interaction with the codebase through REST APIs. This allows multiple clients (IDEs, plugins, scripts) to interact with OpenCode simultaneously.

## Starting the Server

```bash
opencode serve [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port <number>` | `4096` | Server port |
| `--hostname <string>` | `127.0.0.1` | Server hostname |
| `--cors <origin>` | - | CORS origin for browser clients |

### Example

```bash
# Start with defaults
opencode serve

# Custom port and CORS
opencode serve --port 8080 --cors "http://localhost:3000"
```

---

## Authentication

Enable HTTP basic authentication via environment variables:

```bash
# Required for auth
export OPENCODE_SERVER_PASSWORD="your-secure-password"

# Optional (defaults to "opencode")
export OPENCODE_SERVER_USERNAME="your-username"
```

When set, all API requests require:
```
Authorization: Basic base64(username:password)
```

---

## API Documentation

Interactive OpenAPI 3.1 specification available at:
```
GET /doc
```

Use this to explore schemas and generate client libraries.

---

## API Endpoints

### Global Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/global/health` | Server status and version |
| `GET` | `/global/event` | Server-sent events stream |

#### Health Check

```bash
curl http://localhost:4096/global/health
```

Response:
```json
{
  "version": "1.2.0",
  "status": "healthy"
}
```

#### Server-Sent Events

```bash
curl -N http://localhost:4096/global/event
```

Returns stream of events:
```
data: {"type":"session.message","sessionId":"abc","data":{...}}
data: {"type":"tool.complete","sessionId":"abc","data":{...}}
```

---

### Projects & Paths

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/project` | List all projects |
| `GET` | `/project/current` | Current active project |
| `GET` | `/path` | Current working path |
| `GET` | `/vcs` | Version control information |

#### List Projects

```bash
curl http://localhost:4096/project
```

Response:
```json
{
  "projects": [
    { "path": "/home/user/myapp", "name": "myapp" },
    { "path": "/home/user/other", "name": "other" }
  ]
}
```

#### Current Project

```bash
curl http://localhost:4096/project/current
```

Response:
```json
{
  "path": "/home/user/myapp",
  "name": "myapp",
  "git": { "branch": "main", "remote": "origin" }
}
```

---

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/config` | Retrieve full configuration |
| `PATCH` | `/config` | Modify configuration |
| `GET` | `/config/providers` | Available providers and defaults |

#### Get Configuration

```bash
curl http://localhost:4096/config
```

#### Update Configuration

```bash
curl -X PATCH http://localhost:4096/config \
  -H "Content-Type: application/json" \
  -d '{"theme": "dark"}'
```

#### List Providers

```bash
curl http://localhost:4096/config/providers
```

Response:
```json
{
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "models": ["google/gemini-2.5-flash", "openai/gpt-4o"],
      "default": "google/gemini-2.5-flash"
    }
  ]
}
```

---

### Sessions (Core Functionality)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/session` | List all sessions |
| `POST` | `/session` | Create new session |
| `GET` | `/session/:id` | Get session details |
| `DELETE` | `/session/:id` | Delete session |
| `PATCH` | `/session/:id` | Update session properties |
| `POST` | `/session/:id/message` | Send message (sync) |
| `POST` | `/session/:id/prompt_async` | Send message (async) |
| `POST` | `/session/:id/abort` | Stop active operation |
| `POST` | `/session/:id/fork` | Fork at specific message |
| `POST` | `/session/:id/share` | Enable sharing |
| `DELETE` | `/session/:id/share` | Disable sharing |
| `GET` | `/session/:id/diff` | Get file changes |

#### Create Session

```bash
curl -X POST http://localhost:4096/session \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Debug auth issue",
    "model": {
      "providerID": "openrouter",
      "modelID": "google/gemini-2.5-flash"
    }
  }'
```

Response:
```json
{
  "id": "session_abc123",
  "title": "Debug auth issue",
  "model": { "providerID": "openrouter", "modelID": "google/gemini-2.5-flash" },
  "createdAt": "2026-01-26T10:00:00Z",
  "status": "idle"
}
```

#### Send Message (Synchronous)

```bash
curl -X POST http://localhost:4096/session/session_abc123/message \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Explain the authentication flow in this codebase"
  }'
```

Response (waits for completion):
```json
{
  "id": "msg_xyz789",
  "role": "assistant",
  "content": "The authentication flow works as follows...",
  "toolCalls": [...],
  "createdAt": "2026-01-26T10:01:00Z"
}
```

#### Send Message (Asynchronous)

```bash
curl -X POST http://localhost:4096/session/session_abc123/prompt_async \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Refactor the user module"
  }'
```

Response (returns immediately):
```json
{
  "status": "accepted",
  "sessionId": "session_abc123"
}
```

Monitor progress via `/global/event` SSE stream.

#### Abort Session

```bash
curl -X POST http://localhost:4096/session/session_abc123/abort
```

#### Fork Session

```bash
curl -X POST http://localhost:4096/session/session_abc123/fork \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg_xyz789"
  }'
```

Response:
```json
{
  "id": "session_forked456",
  "forkedFrom": "session_abc123",
  "atMessage": "msg_xyz789"
}
```

---

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/session/:id/message` | All messages in session |
| `GET` | `/session/:id/message/:msgId` | Specific message |
| `POST` | `/session/:id/command` | Execute slash command |
| `POST` | `/session/:id/shell` | Run shell command |

#### Get Messages

```bash
curl http://localhost:4096/session/session_abc123/message
```

Response:
```json
{
  "messages": [
    { "id": "msg_1", "role": "user", "content": "..." },
    { "id": "msg_2", "role": "assistant", "content": "...", "toolCalls": [...] }
  ]
}
```

#### Execute Slash Command

```bash
curl -X POST http://localhost:4096/session/session_abc123/command \
  -H "Content-Type: application/json" \
  -d '{ "command": "/clear" }'
```

#### Run Shell Command

```bash
curl -X POST http://localhost:4096/session/session_abc123/shell \
  -H "Content-Type: application/json" \
  -d '{ "command": "npm test" }'
```

---

### Files & Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/find?pattern=<pat>` | Search file contents |
| `GET` | `/find/file?query=<q>` | Find files by name |
| `GET` | `/find/symbol?query=<q>` | Workspace symbol search |
| `GET` | `/file?path=<path>` | List directory contents |
| `GET` | `/file/content?path=<p>` | Read file contents |
| `GET` | `/file/status` | Tracked file status |

#### Search File Contents

```bash
curl "http://localhost:4096/find?pattern=TODO&type=js"
```

Response:
```json
{
  "results": [
    { "file": "src/auth.js", "line": 42, "content": "// TODO: implement refresh" },
    { "file": "src/api.js", "line": 15, "content": "// TODO: add rate limiting" }
  ]
}
```

#### Find Files

```bash
curl "http://localhost:4096/find/file?query=auth&limit=10"
```

Response:
```json
{
  "files": [
    { "path": "src/auth.js", "name": "auth.js" },
    { "path": "src/middleware/auth.js", "name": "auth.js" }
  ]
}
```

#### Read File

```bash
curl "http://localhost:4096/file/content?path=src/auth.js"
```

Response:
```json
{
  "path": "src/auth.js",
  "content": "import jwt from 'jsonwebtoken';\n..."
}
```

---

### Agents & Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agent` | List available agents |
| `GET` | `/experimental/tool/ids` | Tool identifiers |
| `GET` | `/experimental/tool?provider=<p>&model=<m>` | Tools with schemas |

#### List Agents

```bash
curl http://localhost:4096/agent
```

Response:
```json
{
  "agents": [
    { "id": "Build", "description": "Primary agent with full tool access" },
    { "id": "Plan", "description": "Read-only analysis agent" },
    { "id": "Explore", "description": "Read-only subagent for exploration" },
    { "id": "General", "description": "Full-access subagent" }
  ]
}
```

#### Get Tools for Model

```bash
curl "http://localhost:4096/experimental/tool?provider=openrouter&model=google/gemini-2.5-flash"
```

Response:
```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read file contents",
      "schema": { "type": "object", "properties": {...} }
    }
  ]
}
```

---

### Infrastructure

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/lsp` | LSP server status |
| `GET` | `/formatter` | Formatter status |
| `GET` | `/mcp` | MCP server status |
| `POST` | `/mcp` | Register MCP server dynamically |

#### MCP Server Status

```bash
curl http://localhost:4096/mcp
```

Response:
```json
{
  "servers": [
    { "name": "filesystem", "status": "running", "tools": [...] },
    { "name": "github", "status": "running", "tools": [...] }
  ]
}
```

#### Register MCP Server

```bash
curl -X POST http://localhost:4096/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "name": "custom-server",
    "command": "npx",
    "args": ["@modelcontextprotocol/server-custom"]
  }'
```

---

### TUI Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/tui/append-prompt` | Add text to prompt |
| `POST` | `/tui/submit-prompt` | Execute current prompt |
| `POST` | `/tui/clear-prompt` | Clear prompt input |
| `POST` | `/tui/execute-command` | Run command via TUI |
| `POST` | `/tui/show-toast` | Display notification |
| `POST` | `/tui/open-sessions` | Open sessions dialog |
| `POST` | `/tui/open-models` | Open model picker |
| `POST` | `/tui/open-help` | Open help dialog |

#### Show Toast

```bash
curl -X POST http://localhost:4096/tui/show-toast \
  -H "Content-Type: application/json" \
  -d '{ "message": "Task completed!", "type": "success" }'
```

---

### OAuth Authentication (Providers)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/provider/:id/oauth/authorize` | Start OAuth flow |
| `GET` | `/provider/:id/oauth/callback` | OAuth callback |

#### Initiate OAuth

```bash
curl "http://localhost:4096/provider/github/oauth/authorize"
```

Returns redirect URL for user authorization.

---

## Response Formats

### Success Response

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-26T10:00:00Z"
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Session not found",
    "details": { "sessionId": "invalid_id" }
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-26T10:00:00Z"
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (auth required) |
| `404` | Not found |
| `409` | Conflict (e.g., session busy) |
| `500` | Internal server error |

---

## Best Practices

1. **Use async endpoints** for long-running operations
2. **Subscribe to SSE** for real-time progress updates
3. **Handle 409 conflicts** when session is busy
4. **Enable auth** in production environments
5. **Use `/doc`** to explore full API schema
6. **Check health** before critical operations

---

## Multiple Client Architecture

The server supports multiple simultaneous clients:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   VS Code   │     │   Sidecar   │     │   Script    │
│   Plugin    │     │    CLI      │     │   Runner    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  OpenCode   │
                    │   Server    │
                    │  :4096      │
                    └─────────────┘
```

Each client can:
- Create independent sessions
- Share sessions between clients
- Monitor events from all sessions
- Execute commands in any session
