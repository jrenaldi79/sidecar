#!/usr/bin/env node

/**
 * Sidecar Agentic Eval Runner
 *
 * Spawns real Claude Code with sidecar MCP server, runs tasks in sandboxed
 * fixture projects, grades with programmatic checks + LLM-as-judge.
 */

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./transcript_parser');
const { runProgrammaticChecks, buildJudgePrompt, parseJudgeResponse } = require('./evaluator');
const { buildMcpConfig, createSandbox, runClaude } = require('./claude_runner');
const { writeResults, printSummary } = require('./result_writer');

const EVALS_DIR = __dirname;
const TASKS_FILE = path.join(EVALS_DIR, 'eval_tasks.json');
const WORKSPACE_DIR = path.join(EVALS_DIR, 'workspace');

/** Load eval tasks */
function loadTasks() {
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
}

/** Run LLM-as-judge via Claude CLI (cheap model) */
async function runJudge(rubric, transcript, passThreshold) {
  const prompt = buildJudgePrompt(rubric, transcript);
  try {
    const { lines } = await runClaude({
      prompt,
      model: 'haiku',
      maxBudget: 0.05,
      mcpConfigPath: null,
      sandboxDir: process.cwd(),
    }, 60000);

    // Extract text content from stream-json
    let responseText = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') { responseText += block.text; }
          }
        }
        if (event.type === 'result' && event.result) {
          responseText += typeof event.result === 'string' ? event.result : '';
        }
      } catch { /* skip */ }
    }

    return parseJudgeResponse(responseText, rubric, passThreshold);
  } catch (err) {
    console.error(`  Judge failed: ${err.message}`);
    return {
      scores: rubric.map(r => ({ rubric: r, score: 0 })),
      average: 0, pass_threshold: passThreshold, passed: false,
    };
  }
}

/** Run a single eval task */
async function runEval(task, opts = {}) {
  const timestamp = Date.now();
  const workDir = path.join(WORKSPACE_DIR, `eval-${task.id}-${timestamp}`);

  console.log(`\nRunning Eval ${task.id}: ${task.name}`);
  console.log(`  Fixture: ${task.fixture}`);
  console.log(`  Model: ${opts.model || task.model}`);

  // 1. Create sandbox
  const sandboxDir = createSandbox(task.fixture);
  console.log(`  Sandbox: ${sandboxDir}`);

  // 2. Write MCP config
  const mcpConfig = buildMcpConfig();
  const mcpConfigPath = path.join(sandboxDir, '.mcp-config.json');
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));

  // 3. Dry run?
  if (opts.dryRun) {
    const { buildClaudeCommand } = require('./claude_runner');
    const cmd = buildClaudeCommand({
      prompt: task.prompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    });
    console.log(`  DRY RUN: ${cmd.command} ${cmd.args.join(' ')}`);
    fs.rmSync(sandboxDir, { recursive: true });
    return null;
  }

  // 4. Run Claude
  console.log('  Running Claude Code...');
  let runResult;
  try {
    runResult = await runClaude({
      prompt: task.prompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    });
  } catch (err) {
    console.error(`  Claude failed: ${err.message}`);
    const failResult = {
      eval_id: task.id, eval_name: task.name, status: 'ERROR',
      score: 0, duration_seconds: 0,
      token_usage: { claude: { input_tokens: 0, output_tokens: 0 } },
      programmatic_results: [], judge_results: null, sidecar_calls: [],
      error: err.message,
    };
    writeResults(workDir, failResult, []);
    fs.rmSync(sandboxDir, { recursive: true });
    return failResult;
  }

  const durationSec = Math.round(runResult.duration / 1000);
  console.log(`  Completed in ${durationSec}s (exit code: ${runResult.exitCode})`);

  // 5. Parse transcript
  const transcript = parseTranscript(runResult.lines);
  console.log(`  Tool calls: ${transcript.toolCalls.length}, Errors: ${transcript.errors.length}`);
  console.log(`  Tokens: ${transcript.inputTokens} in, ${transcript.outputTokens} out`);

  // 6. Extract sidecar calls
  const sidecarCalls = transcript.toolCalls
    .filter(tc => tc.tool.startsWith('sidecar_'))
    .map(tc => ({ tool: tc.tool, params: tc.params }));

  // 7. Programmatic checks
  const progResults = runProgrammaticChecks(
    task.success_criteria.programmatic, transcript, sandboxDir
  );
  const progPassed = progResults.every(r => r.passed);
  console.log(`  Programmatic: ${progResults.filter(r => r.passed).length}/${progResults.length} passed`);
  for (const r of progResults) {
    console.log(`    ${r.passed ? 'PASS' : 'FAIL'} ${r.type}: ${r.detail}`);
  }

  // 8. LLM-as-judge (only if programmatic passed)
  let judgeResults = null;
  if (progPassed && task.success_criteria.llm_judge) {
    console.log('  Running LLM-as-judge...');
    judgeResults = await runJudge(
      task.success_criteria.llm_judge.rubric,
      transcript,
      task.success_criteria.llm_judge.pass_threshold
    );
    console.log(`  Judge avg: ${judgeResults.average.toFixed(1)} (threshold: ${judgeResults.pass_threshold})`);
  }

  // 9. Build result
  const allPassed = progPassed && (!judgeResults || judgeResults.passed);
  const score = progPassed
    ? (judgeResults ? judgeResults.average / 5 : 1.0)
    : progResults.filter(r => r.passed).length / progResults.length;

  const result = {
    eval_id: task.id,
    eval_name: task.name,
    status: allPassed ? 'PASS' : 'FAIL',
    score,
    duration_seconds: durationSec,
    token_usage: {
      claude: { input_tokens: transcript.inputTokens, output_tokens: transcript.outputTokens },
    },
    programmatic_results: progResults,
    judge_results: judgeResults,
    sidecar_calls: sidecarCalls,
  };

  // 10. Write results
  writeResults(workDir, result, runResult.lines);
  console.log(`  Result: ${result.status} (score: ${result.score.toFixed(2)})`);
  console.log(`  Output: ${workDir}`);

  // 11. Cleanup sandbox
  fs.rmSync(sandboxDir, { recursive: true });

  return result;
}

/** Main CLI */
async function main() {
  const args = process.argv.slice(2);
  const evalId = args.includes('--eval-id') ? parseInt(args[args.indexOf('--eval-id') + 1]) : null;
  const runAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const modelOverride = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;

  if (!evalId && !runAll) {
    console.log('Usage:');
    console.log('  node evals/run_eval.js --eval-id <id>');
    console.log('  node evals/run_eval.js --all');
    console.log('  node evals/run_eval.js --all --dry-run');
    console.log('  node evals/run_eval.js --eval-id 1 --model opus');
    process.exit(1);
  }

  const tasks = loadTasks();
  const toRun = runAll ? tasks : tasks.filter(t => t.id === evalId);

  if (toRun.length === 0) {
    console.error(`No eval found with id ${evalId}`);
    process.exit(1);
  }

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const results = [];
  for (const task of toRun) {
    const result = await runEval(task, { dryRun, model: modelOverride });
    if (result) { results.push(result); }
  }

  if (results.length > 0) {
    printSummary(results);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
