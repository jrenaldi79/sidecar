# Temporary Note: Use A Local Sidecar Checkout Machine-Wide

This is a personal setup note for running Sidecar from a local checkout instead of `claude-sidecar@latest`.

Use this when setting up another Mac so Claude Code, Claude Desktop/Cowork, and shell commands all use the same local Sidecar repo.

## Goal

Make all of these resolve to a local checkout:

- `sidecar` in normal terminal shells
- Claude Code MCP registration
- Claude Desktop / Cowork MCP registration
- Claude skill lookup
- Repo-local `.claude/skills/sidecar` symlinks in projects that keep their own skill trees

## Assumptions

- macOS
- Homebrew Node installed at `/opt/homebrew/bin/node`
- local Sidecar repo cloned somewhere on disk
- Claude Code uses `~/.claude.json`
- Claude Desktop uses `~/Library/Application Support/Claude/claude_desktop_config.json`

## 1. Choose your local Sidecar checkout

Example:

```bash
export SIDECAR_REPO="$HOME/Documents/GitHub/sidecar"
```

Confirm the CLI entrypoint exists:

```bash
test -f "$SIDECAR_REPO/bin/sidecar.js"
```

## 2. Create a stable launcher

Create a user-level launcher so every integration points to one stable path:

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/sidecar" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec /opt/homebrew/bin/node "$HOME/Documents/GitHub/sidecar/bin/sidecar.js" "$@"
EOF
chmod 755 "$HOME/.local/bin/sidecar"
```

If your checkout is not at `$HOME/Documents/GitHub/sidecar`, edit the path in the script.

## 3. Put `~/.local/bin` last in `.zshrc`

Add this near the end of `~/.zshrc` so it wins over an older Homebrew or npm-installed `sidecar`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Open a new shell, then verify:

```bash
zsh -ic 'command -v sidecar'
zsh -ic 'sidecar --version'
```

Expected:

- `command -v sidecar` returns `~/.local/bin/sidecar`
- `sidecar --version` returns the local checkout's version

## 4. Point Claude Code MCP at the launcher

Update `~/.claude.json` so Sidecar uses the launcher instead of `npx ...@latest`.

Desired entry:

```json
{
  "mcpServers": {
    "sidecar": {
      "command": "/Users/<you>/.local/bin/sidecar",
      "args": ["mcp"]
    }
  }
}
```

If a `sidecar` entry already exists, replace it.

## 5. Point Claude Desktop / Cowork MCP at the launcher

Update:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Desired entry:

```json
{
  "mcpServers": {
    "sidecar": {
      "command": "/Users/<you>/.local/bin/sidecar",
      "args": ["mcp"]
    }
  }
}
```

## 6. Point the global Claude skill at the local repo

Replace the global skill copy with a symlink:

```bash
mkdir -p "$HOME/.claude/skills"
rm -rf "$HOME/.claude/skills/sidecar"
ln -s "$SIDECAR_REPO/skill" "$HOME/.claude/skills/sidecar"
```

This keeps the skill in sync with the checked-out branch automatically.

## 7. For repos with local `.claude/skills`, add a local symlink too

Some repos keep project-local Claude skills. In those repos, global skills may not be enough.

Example:

```bash
ln -s "$SIDECAR_REPO/skill" "/path/to/project/.claude/skills/sidecar"
```

If that repo uses git worktrees and each worktree has its own `.claude/skills`, add the same symlink there too.

## 8. Optional: make repo wrappers prefer the local checkout explicitly

If a project has a helper script that runs `sidecar`, prefer:

```bash
/opt/homebrew/bin/node "$SIDECAR_REPO/bin/sidecar.js"
```

instead of relying only on `sidecar` being on `PATH`.

This avoids shell-path ambiguity in non-interactive environments.

## 9. Restart Claude

Fully restart:

- Claude Code
- Claude Desktop / Cowork

They need a restart to pick up the updated MCP config and skill symlinks.

## 10. Verification checklist

Run these:

```bash
zsh -ic 'command -v sidecar'
zsh -ic 'sidecar --version'
cat "$HOME/.claude.json"
cat "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
ls -la "$HOME/.claude/skills/sidecar"
```

Confirm:

- `sidecar` resolves to `~/.local/bin/sidecar`
- both Claude config files point at `~/.local/bin/sidecar`
- `~/.claude/skills/sidecar` is a symlink to `<local-sidecar-repo>/skill`
- any repo-local `.claude/skills/sidecar` entries also point to the same local repo

## Current machine reference

On Will's current machine, the source of truth is:

```text
/Users/willblanchard/Documents/GitHub/sidecar
```

The launcher path is:

```text
/Users/willblanchard/.local/bin/sidecar
```

The MCP command in both Claude configs is:

```json
{
  "command": "/Users/willblanchard/.local/bin/sidecar",
  "args": ["mcp"]
}
```
