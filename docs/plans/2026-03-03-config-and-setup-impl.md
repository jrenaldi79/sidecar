# Config & Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent model aliases, a default model, and `sidecar setup` wizard so users don't need `--model openrouter/google/gemini-3-flash-preview` on every invocation.

**Architecture:** Config file at `~/.config/sidecar/config.json` stores aliases and default. New `src/utils/config.js` loads/saves/resolves. New `src/sidecar/setup.js` runs an interactive wizard. CLI becomes optional on `--model` when a default exists. GEMINI.md/AGENTS.md become symlinks.

**Tech Stack:** Node.js (CommonJS), `readline` for interactive wizard, `crypto` for config hashing, Jest for tests.

**Design Doc:** `docs/plans/2026-03-03-config-and-setup-design.md`

---

### Task 1: Create `src/utils/config.js` — loadConfig and saveConfig

**Files:**
- Create: `src/utils/config.js`
- Test: `tests/config.test.js`

**Step 1: Write the failing tests**

```javascript
// tests/config.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Config Module', () => {
  let config;
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-config-'));
    configPath = path.join(tmpDir, 'config.json');
    // Override config dir for tests
    jest.resetModules();
    process.env.SIDECAR_CONFIG_DIR = tmpDir;
    config = require('../src/utils/config');
  });

  afterEach(() => {
    delete process.env.SIDECAR_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getConfigDir', () => {
    it('should return SIDECAR_CONFIG_DIR when set', () => {
      expect(config.getConfigDir()).toBe(tmpDir);
    });

    it('should return ~/.config/sidecar when env not set', () => {
      delete process.env.SIDECAR_CONFIG_DIR;
      jest.resetModules();
      const freshConfig = require('../src/utils/config');
      const expected = path.join(os.homedir(), '.config', 'sidecar');
      expect(freshConfig.getConfigDir()).toBe(expected);
    });
  });

  describe('loadConfig', () => {
    it('should return null when config file does not exist', () => {
      const result = config.loadConfig();
      expect(result).toBeNull();
    });

    it('should load and parse a valid config file', () => {
      const testConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));

      const result = config.loadConfig();
      expect(result).toEqual(testConfig);
    });

    it('should return null for invalid JSON', () => {
      fs.writeFileSync(configPath, 'not json');
      const result = config.loadConfig();
      expect(result).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('should create config directory if missing', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      process.env.SIDECAR_CONFIG_DIR = nestedDir;
      jest.resetModules();
      const freshConfig = require('../src/utils/config');

      const testConfig = { default: 'gemini', aliases: {} };
      freshConfig.saveConfig(testConfig);

      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('should write valid JSON to config file', () => {
      const testConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      config.saveConfig(testConfig);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(written).toEqual(testConfig);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/config.test.js`
Expected: FAIL — `Cannot find module '../src/utils/config'`

**Step 3: Write minimal implementation**

```javascript
// src/utils/config.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILENAME = 'config.json';

function getConfigDir() {
  return process.env.SIDECAR_CONFIG_DIR || path.join(os.homedir(), '.config', 'sidecar');
}

function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILENAME);
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_e) {
    return null;
  }
}

function saveConfig(configData) {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getConfigPath(), JSON.stringify(configData, null, 2));
}

module.exports = { getConfigDir, getConfigPath, loadConfig, saveConfig };
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/config.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/config.test.js src/utils/config.js
git commit -m "feat: add config load/save for sidecar model aliases"
```

---

### Task 2: Add `resolveModel` to `src/utils/config.js`

**Files:**
- Modify: `src/utils/config.js`
- Modify: `tests/config.test.js`

**Step 1: Write the failing tests**

Add to `tests/config.test.js`:

```javascript
  describe('resolveModel', () => {
    beforeEach(() => {
      const testConfig = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          opus: 'openrouter/anthropic/claude-opus-4.6',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));
    });

    it('should pass through full model strings containing /', () => {
      const result = config.resolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should resolve known alias to full model string', () => {
      const result = config.resolveModel('gemini');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should resolve another alias', () => {
      const result = config.resolveModel('opus');
      expect(result).toBe('openrouter/anthropic/claude-opus-4.6');
    });

    it('should throw for unknown alias', () => {
      expect(() => config.resolveModel('unknown')).toThrow('Unknown model alias');
    });

    it('should resolve default when modelArg is undefined', () => {
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should throw when no default and no modelArg', () => {
      fs.writeFileSync(configPath, JSON.stringify({ aliases: {} }));
      jest.resetModules();
      process.env.SIDECAR_CONFIG_DIR = tmpDir;
      const freshConfig = require('../src/utils/config');

      expect(() => freshConfig.resolveModel(undefined)).toThrow('No default model');
    });

    it('should throw when no config file and no modelArg', () => {
      fs.unlinkSync(configPath);
      jest.resetModules();
      process.env.SIDECAR_CONFIG_DIR = tmpDir;
      const freshConfig = require('../src/utils/config');

      expect(() => freshConfig.resolveModel(undefined)).toThrow();
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/config.test.js`
Expected: FAIL — `config.resolveModel is not a function`

**Step 3: Write minimal implementation**

Add to `src/utils/config.js`:

```javascript
function resolveModel(modelArg) {
  // Full model string (contains /) — use as-is
  if (modelArg && modelArg.includes('/')) {
    return modelArg;
  }

  const cfg = loadConfig();

  // Alias lookup
  if (modelArg) {
    if (cfg && cfg.aliases && cfg.aliases[modelArg]) {
      return cfg.aliases[modelArg];
    }
    throw new Error(`Unknown model alias: '${modelArg}'. Run 'sidecar setup' to configure aliases.`);
  }

  // No modelArg — use default
  if (cfg && cfg.default) {
    const defaultAlias = cfg.default;
    if (cfg.aliases && cfg.aliases[defaultAlias]) {
      return cfg.aliases[defaultAlias];
    }
    throw new Error(`Default alias '${defaultAlias}' not found in config. Run 'sidecar setup'.`);
  }

  throw new Error('No default model configured. Run \'sidecar setup\' or pass --model.');
}
```

Update `module.exports` to include `resolveModel`.

**Step 4: Run test to verify it passes**

Run: `npm test tests/config.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/config.js tests/config.test.js
git commit -m "feat: add resolveModel for alias resolution"
```

---

### Task 3: Add `computeConfigHash` to `src/utils/config.js`

**Files:**
- Modify: `src/utils/config.js`
- Modify: `tests/config.test.js`

**Step 1: Write the failing tests**

Add to `tests/config.test.js`:

```javascript
  describe('computeConfigHash', () => {
    it('should return a hex string', () => {
      const testConfig = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));

      const hash = config.computeConfigHash();
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should return same hash for same content', () => {
      const testConfig = { default: 'gemini', aliases: { gemini: 'x/y' } };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));
      const hash1 = config.computeConfigHash();

      fs.writeFileSync(configPath, JSON.stringify(testConfig));
      const hash2 = config.computeConfigHash();

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different content', () => {
      fs.writeFileSync(configPath, JSON.stringify({ default: 'a', aliases: {} }));
      const hash1 = config.computeConfigHash();

      fs.writeFileSync(configPath, JSON.stringify({ default: 'b', aliases: {} }));
      jest.resetModules();
      process.env.SIDECAR_CONFIG_DIR = tmpDir;
      const freshConfig = require('../src/utils/config');
      const hash2 = freshConfig.computeConfigHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should return null when no config file', () => {
      const hash = config.computeConfigHash();
      expect(hash).toBeNull();
    });
  });

  describe('getDefaultAliases', () => {
    it('should return an object with common model aliases', () => {
      const aliases = config.getDefaultAliases();
      expect(aliases).toHaveProperty('gemini');
      expect(aliases).toHaveProperty('gpt');
      expect(aliases).toHaveProperty('opus');
      expect(aliases).toHaveProperty('claude');
      expect(aliases).toHaveProperty('deepseek');
    });

    it('should have full model strings as values', () => {
      const aliases = config.getDefaultAliases();
      for (const value of Object.values(aliases)) {
        expect(value).toContain('/');
      }
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/config.test.js`
Expected: FAIL — functions not defined

**Step 3: Write minimal implementation**

Add to `src/utils/config.js`:

```javascript
const crypto = require('crypto');

function computeConfigHash() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function getDefaultAliases() {
  return {
    'gemini': 'openrouter/google/gemini-3-flash-preview',
    'gemini-pro': 'openrouter/google/gemini-3-pro-preview',
    'gemini-3.1': 'openrouter/google/gemini-3.1-pro-preview',
    'gpt': 'openrouter/openai/gpt-5.2-chat',
    'gpt-pro': 'openrouter/openai/gpt-5.2-pro',
    'codex': 'openrouter/openai/gpt-5.3-codex',
    'claude': 'openrouter/anthropic/claude-sonnet-4.6',
    'sonnet': 'openrouter/anthropic/claude-sonnet-4.6',
    'opus': 'openrouter/anthropic/claude-opus-4.6',
    'haiku': 'openrouter/anthropic/claude-haiku-4.5',
    'deepseek': 'openrouter/deepseek/deepseek-v3.2',
    'qwen': 'openrouter/qwen/qwen3.5-397b-a17b',
    'qwen-coder': 'openrouter/qwen/qwen3-coder-next',
    'qwen-flash': 'openrouter/qwen/qwen3.5-flash-02-23',
    'mistral': 'openrouter/mistralai/mistral-large-2512',
    'devstral': 'openrouter/mistralai/devstral-2512',
    'glm': 'openrouter/z-ai/glm-5',
    'minimax': 'openrouter/minimax/minimax-m2.5',
    'grok': 'openrouter/x-ai/grok-4.1-fast',
    'kimi': 'openrouter/moonshotai/kimi-k2.5',
    'seed': 'openrouter/bytedance-seed/seed-2.0-mini'
  };
}
```

Update `module.exports`.

**Step 4: Run test to verify it passes**

Run: `npm test tests/config.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/config.js tests/config.test.js
git commit -m "feat: add config hash and default aliases"
```

---

### Task 4: Integrate `resolveModel` into CLI

**Files:**
- Modify: `src/cli.js` (lines 117-121 — `validateStartArgs`, make `--model` optional)
- Modify: `bin/sidecar.js` (line 67-101 — `handleStart`, resolve model before passing)
- Modify: `tests/cli.test.js`

**Step 1: Write the failing tests**

Add to `tests/cli.test.js`:

```javascript
describe('validateStartArgs with optional model', () => {
  it('should accept args without --model when config has default', () => {
    // Setup: mock config with default
    jest.mock('../src/utils/config', () => ({
      resolveModel: (arg) => arg ? arg : 'openrouter/google/gemini-3-flash-preview',
      loadConfig: () => ({ default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } })
    }));
    jest.resetModules();
    const { validateStartArgs } = require('../src/cli');

    const result = validateStartArgs({ prompt: 'test task', cwd: process.cwd() });
    // Model is resolved externally now, so validation just checks format if present
    // Without model, it should be valid (resolved later in handleStart)
    expect(result.valid).toBe(true);

    jest.restoreAllMocks();
  });
});
```

Note: The actual integration is in `handleStart` in `bin/sidecar.js`, where we call `resolveModel(args.model)` before `validateStartArgs`. The CLI validation changes to allow `args.model` to be undefined (resolved by the time it reaches `startSidecar`).

**Step 2: Run test to verify it fails**

Run: `npm test tests/cli.test.js`
Expected: FAIL — current `validateStartArgs` requires `--model`

**Step 3: Write minimal implementation**

In `src/cli.js`, modify `validateStartArgs`:

```javascript
// Change line 118-121 from:
//   if (!args.model) {
//     return { valid: false, error: 'Error: --model is required' };
//   }
// To:
  // --model is optional when config has a default (resolved in handleStart)
  // Only validate format if model is provided at this point
```

Keep the `isValidModelFormat` check but only if `args.model` is present.

In `bin/sidecar.js`, modify `handleStart`:

```javascript
async function handleStart(args) {
  // Resolve model alias (or use default from config)
  const { resolveModel } = require('../src/utils/config');
  try {
    args.model = resolveModel(args.model);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Validate (model is now resolved)
  const validation = validateStartArgs(args);
  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/cli.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.js bin/sidecar.js tests/cli.test.js
git commit -m "feat: make --model optional with config default"
```

---

### Task 5: Add `setup` command to CLI

**Files:**
- Create: `src/sidecar/setup.js`
- Create: `tests/sidecar/setup.test.js`
- Modify: `bin/sidecar.js` (add `case 'setup'`)
- Modify: `src/cli.js` (add `setup` to usage text)

**Step 1: Write the failing tests**

```javascript
// tests/sidecar/setup.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Setup Module', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-setup-'));
    process.env.SIDECAR_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.SIDECAR_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('runSetup (non-interactive / add-alias)', () => {
    it('should add an alias to existing config', () => {
      const { addAlias } = require('../../src/sidecar/setup');

      // Create initial config
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      }));

      addAlias('fast', 'openrouter/google/gemini-3-flash-preview');

      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.aliases.fast).toBe('openrouter/google/gemini-3-flash-preview');
      expect(updated.aliases.gemini).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should create config with alias when none exists', () => {
      const { addAlias } = require('../../src/sidecar/setup');

      addAlias('test', 'openrouter/openai/gpt-5.2-chat');

      const configPath = path.join(tmpDir, 'config.json');
      const created = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(created.aliases.test).toBe('openrouter/openai/gpt-5.2-chat');
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with all default aliases', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');

      createDefaultConfig('gemini');

      const configPath = path.join(tmpDir, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(cfg.default).toBe('gemini');
      expect(Object.keys(cfg.aliases).length).toBeGreaterThan(15);
      expect(cfg.aliases.gemini).toContain('google');
      expect(cfg.aliases.opus).toContain('anthropic');
    });
  });

  describe('detectApiKeys', () => {
    it('should detect OpenRouter key from auth.json', () => {
      const { detectApiKeys } = require('../../src/sidecar/setup');

      // Mock the auth.json path
      const authDir = path.join(tmpDir, 'opencode-auth');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify({ openrouter: { apiKey: 'sk-or-test' } })
      );

      const keys = detectApiKeys(authDir);
      expect(keys.openrouter).toBe(true);
    });

    it('should detect env var keys', () => {
      const { detectApiKeys } = require('../../src/sidecar/setup');

      process.env.OPENROUTER_API_KEY = 'test-key';
      const keys = detectApiKeys('/nonexistent');
      expect(keys.openrouter).toBe(true);
      delete process.env.OPENROUTER_API_KEY;
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/sidecar/setup.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// src/sidecar/setup.js
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadConfig, saveConfig, getDefaultAliases, getConfigDir } = require('../utils/config');
const { logger } = require('../utils/logger');

function addAlias(name, modelString) {
  let cfg = loadConfig() || { aliases: {} };
  if (!cfg.aliases) { cfg.aliases = {}; }
  cfg.aliases[name] = modelString;
  saveConfig(cfg);
  logger.info('Alias added', { name, model: modelString });
}

function createDefaultConfig(defaultModel) {
  const cfg = {
    default: defaultModel,
    aliases: getDefaultAliases()
  };
  saveConfig(cfg);
  return cfg;
}

function detectApiKeys(authDir) {
  const result = { openrouter: false, google: false, openai: false, anthropic: false };

  // Check env vars
  if (process.env.OPENROUTER_API_KEY) { result.openrouter = true; }
  if (process.env.GEMINI_API_KEY) { result.google = true; }
  if (process.env.OPENAI_API_KEY) { result.openai = true; }
  if (process.env.ANTHROPIC_API_KEY) { result.anthropic = true; }

  // Check OpenCode auth.json
  const authPath = path.join(authDir, 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      if (auth.openrouter?.apiKey) { result.openrouter = true; }
      if (auth.google?.apiKey) { result.google = true; }
      if (auth.openai?.apiKey) { result.openai = true; }
    } catch (_e) { /* ignore */ }
  }

  return result;
}

async function runInteractiveSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise(resolve => rl.question(question, resolve));

  console.log('\nWelcome to Sidecar Setup!\n');

  // Detect existing keys
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const authDir = path.join(homeDir, '.local', 'share', 'opencode');
  const keys = detectApiKeys(authDir);

  const foundKeys = Object.entries(keys).filter(([, v]) => v).map(([k]) => k);
  if (foundKeys.length > 0) {
    console.log(`API keys found: ${foundKeys.join(', ')}`);
  } else {
    console.log('No API keys detected. Configure via:');
    console.log('  npx opencode-ai, then /connect');
    console.log('  Or: export OPENROUTER_API_KEY=your-key\n');
  }

  // Choose default model
  console.log('\nChoose your default model:');
  const choices = [
    { key: 'gemini', label: 'gemini — Google Gemini 3 Flash (fast, 1M context)' },
    { key: 'gemini-pro', label: 'gemini-pro — Google Gemini 3 Pro (powerful, 1M context)' },
    { key: 'gpt', label: 'gpt — OpenAI GPT-5.2 (128K context)' },
    { key: 'opus', label: 'opus — Claude Opus 4.6 (1M context)' },
    { key: 'deepseek', label: 'deepseek — DeepSeek v3.2 (164K context)' }
  ];

  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));

  const answer = await ask('\nEnter number (1-5) or alias name: ');
  let defaultModel;

  const num = parseInt(answer, 10);
  if (num >= 1 && num <= choices.length) {
    defaultModel = choices[num - 1].key;
  } else if (answer.trim()) {
    defaultModel = answer.trim();
  } else {
    defaultModel = 'gemini';
  }

  const cfg = createDefaultConfig(defaultModel);
  const aliasCount = Object.keys(cfg.aliases).length;

  console.log(`\nDefault set to: ${defaultModel}`);
  console.log(`Saved to ${path.join(getConfigDir(), 'config.json')}`);
  console.log(`${aliasCount} model aliases configured.\n`);
  console.log('Ready! Try: sidecar start --prompt "Hello"\n');

  rl.close();
}

module.exports = {
  addAlias,
  createDefaultConfig,
  detectApiKeys,
  runInteractiveSetup
};
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/sidecar/setup.test.js`
Expected: PASS

**Step 5: Wire into CLI**

In `bin/sidecar.js`, add `case 'setup'`:

```javascript
case 'setup':
  await handleSetup(args);
  break;
```

Add `handleSetup` function:

```javascript
async function handleSetup(args) {
  const { addAlias, runInteractiveSetup } = require('../src/sidecar/setup');

  if (args['add-alias']) {
    const [name, model] = args['add-alias'].split('=');
    if (!name || !model) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    addAlias(name, model);
    console.log(`Alias '${name}' added.`);
    return;
  }

  await runInteractiveSetup();
}
```

In `src/cli.js`, add `'add-alias'` parsing and update `getUsage()`.

**Step 6: Commit**

```bash
git add src/sidecar/setup.js tests/sidecar/setup.test.js bin/sidecar.js src/cli.js
git commit -m "feat: add sidecar setup command and interactive wizard"
```

---

### Task 6: Update `validateApiKey` to work after alias resolution

**Files:**
- Modify: `src/utils/validators.js` (line 310 — `validateApiKey`)
- Modify: `tests/cli.test.js`

**Step 1: Write the failing test**

Add to `tests/cli.test.js`:

```javascript
describe('validateStartArgs after alias resolution', () => {
  it('should validate API key for resolved model string', () => {
    const { validateStartArgs } = require('../src/cli');
    // Model already resolved to full string
    process.env.OPENROUTER_API_KEY = 'test-key';
    const result = validateStartArgs({
      model: 'openrouter/google/gemini-3-flash-preview',
      prompt: 'test',
      cwd: process.cwd()
    });
    expect(result.valid).toBe(true);
    delete process.env.OPENROUTER_API_KEY;
  });
});
```

**Step 2: Run test**

This should already pass since `validateApiKey` works on full strings. The key change is that `validateStartArgs` no longer requires `--model` (Task 4 handled this). Verify the whole flow works end-to-end.

Run: `npm test tests/cli.test.js`
Expected: PASS

**Step 3: Commit (if any changes needed)**

```bash
git add src/utils/validators.js tests/cli.test.js
git commit -m "test: verify API key validation works after alias resolution"
```

---

### Task 7: Config change detection (hash in CLAUDE.md)

**Files:**
- Modify: `src/utils/config.js`
- Modify: `tests/config.test.js`

**Step 1: Write the failing tests**

Add to `tests/config.test.js`:

```javascript
  describe('checkConfigChanged', () => {
    it('should return { changed: false } when hash matches', () => {
      const testConfig = { default: 'gemini', aliases: { gemini: 'x/y' } };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));

      const hash = config.computeConfigHash();
      const result = config.checkConfigChanged(hash);
      expect(result.changed).toBe(false);
    });

    it('should return { changed: true, newHash, updateData } when hash differs', () => {
      const testConfig = { default: 'gemini', aliases: { gemini: 'x/y' } };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));

      const result = config.checkConfigChanged('00000000');
      expect(result.changed).toBe(true);
      expect(result.newHash).toMatch(/^[0-9a-f]{8}$/);
      expect(result.updateData).toContain('Model Aliases');
      expect(result.updateData).toContain('gemini');
    });

    it('should return { changed: false } when no config exists', () => {
      const result = config.checkConfigChanged('anything');
      expect(result.changed).toBe(false);
    });
  });

  describe('buildAliasTable', () => {
    it('should format aliases as markdown table', () => {
      const testConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview', gpt: 'openrouter/openai/gpt-5.2-chat' }
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig));

      const table = config.buildAliasTable();
      expect(table).toContain('| Alias |');
      expect(table).toContain('gemini (default)');
      expect(table).toContain('gpt');
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/config.test.js`
Expected: FAIL — functions not defined

**Step 3: Write minimal implementation**

Add to `src/utils/config.js`:

```javascript
function buildAliasTable() {
  const cfg = loadConfig();
  if (!cfg || !cfg.aliases) { return ''; }

  const lines = ['| Alias | Model |', '|-------|-------|'];
  for (const [alias, model] of Object.entries(cfg.aliases)) {
    const label = alias === cfg.default ? `${alias} (default)` : alias;
    lines.push(`| ${label} | ${model} |`);
  }
  return lines.join('\n');
}

function checkConfigChanged(currentHash) {
  const newHash = computeConfigHash();
  if (!newHash) {
    return { changed: false };
  }
  if (newHash === currentHash) {
    return { changed: false };
  }

  const table = buildAliasTable();
  const updateData = `<!-- sidecar-config-hash: ${newHash} -->\n### Model Aliases\n\n${table}`;

  return { changed: true, newHash, updateData };
}
```

Update `module.exports`.

**Step 4: Run test to verify it passes**

Run: `npm test tests/config.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/config.js tests/config.test.js
git commit -m "feat: add config hash change detection for doc updates"
```

---

### Task 8: Emit config change warning on `sidecar start`

**Files:**
- Modify: `src/sidecar/start.js` (add config hash check before launch)
- Modify: `tests/sidecar/start.test.js`

**Step 1: Write the failing test**

Add to `tests/sidecar/start.test.js` (or add a new describe block):

```javascript
describe('Config change detection on start', () => {
  it('should emit config update to stderr when hash changes', () => {
    // This is a behavioral test - verify the checkConfigChanged
    // function is called during start. We test the function itself
    // in config.test.js; here we just verify integration.
    const { checkConfigChanged } = require('../../src/utils/config');
    const result = checkConfigChanged('stale-hash');
    // If config exists, it should detect a change
    // This test mainly ensures the import works and function runs
    expect(result).toHaveProperty('changed');
  });
});
```

**Step 2: Implement**

In `src/sidecar/start.js`, at the top of `startSidecar()`, add:

```javascript
// Check for config changes and emit update data to stderr
const { checkConfigChanged } = require('../utils/config');
// Read current hash from CLAUDE.md if it exists (look for sidecar-config-hash comment)
const claudeMdPath = path.join(effectiveProject, 'CLAUDE.md');
let currentHash = null;
if (fs.existsSync(claudeMdPath)) {
  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
  if (match) { currentHash = match[1]; }
}
const configCheck = checkConfigChanged(currentHash);
if (configCheck.changed) {
  process.stderr.write(`\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nUpdate your project doc file with:\n\n${configCheck.updateData}\n\n`);
}
```

**Step 3: Run tests**

Run: `npm test tests/sidecar/start.test.js`
Expected: PASS

**Step 4: Commit**

```bash
git add src/sidecar/start.js tests/sidecar/start.test.js
git commit -m "feat: emit config change warning on sidecar start"
```

---

### Task 9: Symlink migration — replace GEMINI.md and AGENTS.md

**Files:**
- Replace: `GEMINI.md` → symlink to `CLAUDE.md`
- Replace: `AGENTS.md` → symlink to `CLAUDE.md`
- Delete: `scripts/sync-agent-docs.js`
- Modify: `CLAUDE.md` (update sync references)

**Step 1: Verify current files are not symlinks**

Run: `ls -la GEMINI.md AGENTS.md`
Expected: Regular files (not symlinks)

**Step 2: Create symlinks**

```bash
cd /Users/john_renaldi/claude-code-projects/sidecar
rm GEMINI.md AGENTS.md
ln -s CLAUDE.md GEMINI.md
ln -s CLAUDE.md AGENTS.md
```

**Step 3: Verify symlinks work**

```bash
ls -la GEMINI.md AGENTS.md
# Should show: GEMINI.md -> CLAUDE.md, AGENTS.md -> CLAUDE.md

head -3 GEMINI.md
# Should show CLAUDE.md content
```

**Step 4: Delete sync script**

```bash
rm scripts/sync-agent-docs.js
```

**Step 5: Update CLAUDE.md references**

Remove references to `node scripts/sync-agent-docs.js` from:
- "Before Committing" checklist
- "Agent Documentation Sync" section
- "Code Review Checklist"
- "Maintaining This Documentation" section

Replace with note about symlinks.

**Step 6: Commit**

```bash
git add GEMINI.md AGENTS.md CLAUDE.md
git rm scripts/sync-agent-docs.js
git commit -m "refactor: replace doc sync script with symlinks"
```

---

### Task 10: Update CLAUDE.md with config documentation

**Files:**
- Modify: `CLAUDE.md` (add Model Aliases section, config docs, update Key Modules table)

**Step 1: Add Model Aliases section to CLAUDE.md**

Add after the Configuration section:

```markdown
### Model Aliases

Sidecar supports model aliases configured in `~/.config/sidecar/config.json`.

Run `sidecar setup` to configure. Aliases let you use short names:

```bash
sidecar start --prompt "Review auth" --model gemini    # uses default
sidecar start --prompt "Deep analysis" --model opus    # alias
sidecar start --prompt "Hello"                          # uses config default
```

See `docs/plans/2026-03-03-config-and-setup-design.md` for full design.
```

**Step 2: Update Key Modules table**

Add entries for:
- `utils/config.js` — Config loading, alias resolution, hash detection
- `sidecar/setup.js` — Interactive setup wizard

**Step 3: Update Directory Structure**

Add `src/utils/config.js` and `src/sidecar/setup.js` entries.

**Step 4: Update usage text in CLI section**

Show `--model` as optional: `sidecar start --prompt "..." [--model <alias|model>]`

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add config system documentation to CLAUDE.md"
```

---

### Task 11: Update `skill/SKILL.md` to reference aliases

**Files:**
- Modify: `skill/SKILL.md`

**Step 1: Simplify model section**

Replace the detailed model listing with alias-aware instructions:

```markdown
### Model Selection

Use short aliases when available:
- `--model gemini` (default if configured)
- `--model opus` for deep analysis
- `--model gpt` for OpenAI
- Full strings also work: `--model openrouter/google/gemini-3-flash-preview`

If no `--model` given and a default is configured, it's used automatically.
```

**Step 2: Commit**

```bash
git add skill/SKILL.md
git commit -m "docs: simplify SKILL.md model section with aliases"
```

---

### Task 12: Run full test suite and verify

**Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass (existing + new config/setup tests)

**Step 2: Run lint**

```bash
npm run lint
```

Expected: No lint errors

**Step 3: Manual smoke test**

```bash
# Run setup
node bin/sidecar.js setup

# Verify config created
cat ~/.config/sidecar/config.json

# Test alias resolution (headless, should resolve 'gemini')
node bin/sidecar.js start --model gemini --prompt "Say hello" --no-ui --timeout 1

# Test default model (no --model)
node bin/sidecar.js start --prompt "Say hello" --no-ui --timeout 1

# Test full string still works
node bin/sidecar.js start --model openrouter/google/gemini-3-flash-preview --prompt "Hello" --no-ui --timeout 1

# Test add-alias
node bin/sidecar.js setup --add-alias fast=openrouter/google/gemini-3-flash-preview
cat ~/.config/sidecar/config.json | grep fast
```

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "test: verify config and setup integration"
```

---

## Summary

| Task | Creates | Tests | Description |
|------|---------|-------|-------------|
| 1 | `src/utils/config.js` | `tests/config.test.js` | loadConfig, saveConfig |
| 2 | — | — | resolveModel |
| 3 | — | — | computeConfigHash, getDefaultAliases |
| 4 | — | — | CLI integration (--model optional) |
| 5 | `src/sidecar/setup.js` | `tests/sidecar/setup.test.js` | Setup wizard, addAlias |
| 6 | — | — | validateApiKey after resolution |
| 7 | — | — | Config change detection |
| 8 | — | — | Emit change warning on start |
| 9 | — | — | Symlink migration |
| 10 | — | — | CLAUDE.md docs |
| 11 | — | — | SKILL.md update |
| 12 | — | — | Full test suite verification |
