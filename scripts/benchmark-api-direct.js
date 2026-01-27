#!/usr/bin/env node
/**
 * Direct OpenRouter API Benchmark for Thinking Levels
 *
 * Tests the reasoning.effort parameter directly against OpenRouter API
 * to validate that different thinking levels affect response behavior.
 */

require('dotenv').config();

const https = require('https');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Models to benchmark
const MODELS = [
  'google/gemini-3-flash-preview',
  'google/gemini-3-pro-preview',
  'openai/gpt-5.2'
];

// Thinking levels to test
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];

// Model-specific thinking level support (GPT-5.x doesn't support 'minimal')
const MODEL_THINKING_SUPPORT = {
  'gpt-5': ['low', 'medium', 'high', 'xhigh'],  // No 'minimal' support
  'default': ['minimal', 'low', 'medium', 'high', 'xhigh']
};

function getSupportedLevels(model) {
  const modelLower = model.toLowerCase();
  for (const [pattern, levels] of Object.entries(MODEL_THINKING_SUPPORT)) {
    if (pattern !== 'default' && modelLower.includes(pattern)) {
      return levels;
    }
  }
  return MODEL_THINKING_SUPPORT.default;
}

// Complex multi-step task requiring tool usage and reasoning
const PROMPT = `You are debugging a production issue. Here's the situation:

Our e-commerce API is returning 500 errors intermittently. The error logs show:
- "Connection timeout to database" occurring every 30-60 seconds
- Memory usage spikes correlating with the errors
- The issue started after yesterday's deployment (commit abc123)

I need you to:
1. Search for common causes of intermittent database connection timeouts
2. Look up best practices for connection pooling in Node.js with PostgreSQL
3. Calculate: if we have 50 concurrent users, 3 second average query time, and a pool size of 10, what's the theoretical max throughput?

Based on your research, provide a diagnosis and recommended fix.

Think through this step by step, using the available tools as needed.`;

// Tools available to the model
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information on any topic',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch and read the contents of a specific URL',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate'
          }
        },
        required: ['expression']
      }
    }
  }
];

async function testThinkingLevel(model, level) {
  const start = Date.now();

  const body = {
    model: model,
    messages: [{ role: 'user', content: PROMPT }],
    tools: TOOLS,
    max_tokens: 1500
  };

  // Add reasoning parameter if not medium (default)
  if (level !== 'medium') {
    body.reasoning = { effort: level };
  }

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/sidecar',
        'X-Title': 'Sidecar Benchmark'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - start;
        try {
          const json = JSON.parse(data);
          if (json.error) {
            // Capture full error details for debugging
            const errorDetail = json.error.message || JSON.stringify(json.error);
            const errorCode = json.error.code || 'unknown';
            const errorType = json.error.type || 'unknown';
            resolve({
              level,
              elapsed,
              error: errorDetail,
              errorCode,
              errorType,
              httpStatus: res.statusCode,
              rawError: json.error
            });
          } else {
            const message = json.choices?.[0]?.message || {};
            const content = message.content || '';
            const toolCalls = message.tool_calls || [];
            const usage = json.usage || {};
            resolve({
              level,
              elapsed,
              content: content.slice(0, 80),
              toolCalls: toolCalls.length,
              toolNames: toolCalls.map(t => t.function?.name).filter(Boolean),
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
              finishReason: json.choices?.[0]?.finish_reason
            });
          }
        } catch (e) {
          resolve({ level, elapsed, error: e.message });
        }
      });
    });

    req.on('error', (e) => resolve({ level, elapsed: Date.now() - start, error: e.message }));
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function benchmarkModel(model) {
  console.log('\n' + '='.repeat(70));
  console.log('MODEL: ' + model);
  console.log('='.repeat(70));

  // Get model-specific supported levels
  const supportedLevels = getSupportedLevels(model);
  const levels = THINKING_LEVELS.filter(l => supportedLevels.includes(l));

  if (levels.length < THINKING_LEVELS.length) {
    const skipped = THINKING_LEVELS.filter(l => !supportedLevels.includes(l));
    console.log('  (Skipping unsupported levels: ' + skipped.join(', ') + ')');
  }

  const results = [];

  for (const level of levels) {
    process.stdout.write('  ' + level.padEnd(8) + '... ');
    const result = await testThinkingLevel(model, level);
    results.push(result);
    if (result.error) {
      console.log('ERROR: ' + result.error.slice(0, 50) + ' (HTTP ' + (result.httpStatus || '?') + ', code: ' + (result.errorCode || '?') + ')');
    } else {
      console.log(result.elapsed + 'ms | ' + result.totalTokens + ' tokens | ' + result.toolCalls + ' tools');
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('');
  console.log('Results:');
  console.log('-'.repeat(85));
  console.log('Level    | Time (ms) | Tokens | Tools | Finish     | Preview');
  console.log('-'.repeat(85));

  for (const r of results) {
    const levelCol = r.level.padEnd(8);
    const timeCol = String(r.elapsed).padStart(9);
    if (r.error) {
      console.log(levelCol + ' | ' + timeCol + ' | ERROR  |       |            | ' + r.error.slice(0, 25));
      if (r.rawError) {
        console.log('           Full error: ' + JSON.stringify(r.rawError));
      }
    } else {
      const tokenCol = String(r.totalTokens).padStart(6);
      const toolCol = String(r.toolCalls).padStart(5);
      const finishCol = (r.finishReason || 'unknown').padEnd(10);
      const preview = r.content ? r.content.slice(0, 20) + '...' : '[tool calls]';
      console.log(levelCol + ' | ' + timeCol + ' | ' + tokenCol + ' | ' + toolCol + ' | ' + finishCol + ' | ' + preview);
      if (r.toolNames && r.toolNames.length > 0) {
        console.log('           Tools called: ' + r.toolNames.join(', '));
      }
    }
  }
  console.log('-'.repeat(85));

  // Summary
  const successful = results.filter(r => !r.error);
  if (successful.length > 1) {
    const times = successful.map(r => ({ level: r.level, elapsed: r.elapsed, tools: r.toolCalls }));
    times.sort((a, b) => a.elapsed - b.elapsed);
    console.log('');
    console.log('Speed ranking:');
    times.forEach((t, i) => {
      console.log('  ' + (i + 1) + '. ' + t.level + ' (' + t.elapsed + 'ms, ' + t.tools + ' tools)');
    });
  }

  return { model, results };
}

async function main() {
  if (!OPENROUTER_API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║' + '  THINKING LEVEL BENCHMARK - Multi-Model Comparison  '.padStart(55).padEnd(68) + '║');
  console.log('╚' + '═'.repeat(68) + '╝');
  console.log('');
  console.log('Models: ' + MODELS.join(', '));
  console.log('Thinking levels: minimal, low, medium, high');
  console.log('Task: Complex debugging scenario with tool usage');

  // Run all models in parallel for faster benchmarking
  console.log('\nLaunching ' + MODELS.length + ' model benchmarks in parallel...\n');

  const allResults = await Promise.all(
    MODELS.map(model => benchmarkModel(model))
  );

  // Final comparison
  console.log('\n' + '═'.repeat(70));
  console.log('CROSS-MODEL COMPARISON');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Tool usage by thinking level:');
  console.log('-'.repeat(50));

  for (const { model, results } of allResults) {
    const shortModel = model.split('/').pop();
    const toolsByLevel = results
      .filter(r => !r.error)
      .map(r => r.level + ':' + r.toolCalls)
      .join(', ');
    console.log('  ' + shortModel.padEnd(25) + ' | ' + toolsByLevel);
  }

  console.log('');
  console.log('Avg response time by model:');
  console.log('-'.repeat(50));

  for (const { model, results } of allResults) {
    const shortModel = model.split('/').pop();
    const successful = results.filter(r => !r.error);
    if (successful.length > 0) {
      const avgTime = Math.round(successful.reduce((a, r) => a + r.elapsed, 0) / successful.length);
      console.log('  ' + shortModel.padEnd(25) + ' | ' + avgTime + 'ms avg');
    } else {
      console.log('  ' + shortModel.padEnd(25) + ' | ERROR');
    }
  }

  console.log('');
}

main().catch(console.error);
