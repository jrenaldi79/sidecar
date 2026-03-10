/**
 * CLI Command Handlers
 *
 * Extracted from bin/sidecar.js to keep the CLI entry point
 * under the 300-line limit.
 */

const fs = require('fs');
const path = require('path');
const { validateTaskId, safeSessionDir } = require('./utils/validators');

/**
 * Handle 'sidecar setup' command
 * Runs interactive setup wizard or adds an alias via --add-alias
 */
async function handleSetup(args) {
  const { addAlias, runInteractiveSetup, runApiKeySetup } = require('./sidecar/setup');

  // Standalone API key window
  if (args['api-keys']) {
    const success = await runApiKeySetup();
    if (success) {
      console.log('API keys configured successfully.');
    } else {
      console.log('API key setup was not completed.');
      process.exit(1);
    }
    return;
  }

  if (args['add-alias']) {
    const spec = args['add-alias'];
    const eqIndex = spec.indexOf('=');
    if (eqIndex === -1) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    const name = spec.slice(0, eqIndex);
    const model = spec.slice(eqIndex + 1);
    if (!name || !model) {
      console.error('Error: --add-alias must be in format name=model');
      process.exit(1);
    }
    addAlias(name, model);
    console.log(`Alias '${name}' added: ${model}`);
    return;
  }

  await runInteractiveSetup();
}

/**
 * Handle 'sidecar abort' command
 * Marks a running session as aborted
 */
async function handleAbort(args) {
  const taskId = args._[1];

  if (!taskId) {
    console.error('Error: task_id is required for abort');
    console.error('Usage: sidecar abort <task_id>');
    process.exit(1);
  }

  const taskIdCheck = validateTaskId(taskId);
  if (!taskIdCheck.valid) {
    console.error(taskIdCheck.error);
    process.exit(1);
  }

  const project = args.cwd || process.cwd();
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    console.error(`Session ${taskId} not found`);
    process.exit(1);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (_err) {
    console.error(`Session ${taskId} has malformed metadata`);
    process.exit(1);
  }
  meta.status = 'aborted';
  meta.abortedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  console.log(`Session ${taskId} marked as aborted.`);
}

/**
 * Handle 'sidecar update' command
 * Updates claude-sidecar to the latest version
 */
async function handleUpdate() {
  const { performUpdate, getUpdateInfo, initUpdateCheck } = require('./utils/updater');
  initUpdateCheck();
  const info = getUpdateInfo();
  if (info) {
    console.log(`Updating claude-sidecar ${info.current} → ${info.latest}...`);
  } else {
    console.log('Updating claude-sidecar to latest...');
  }
  const result = await performUpdate();
  if (result.success) {
    console.log(`Updated successfully! Run 'sidecar --version' to verify.`);
  } else {
    console.error(`Update failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Handle 'sidecar mcp' command
 * Starts the MCP server on stdio transport
 */
async function handleMcp() {
  const { startMcpServer } = require('./mcp-server');
  await startMcpServer();
}

module.exports = {
  handleSetup,
  handleAbort,
  handleUpdate,
  handleMcp,
};
