const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeResults, formatSummaryLine } = require('../result_writer');

describe('formatSummaryLine', () => {
  test('formats passing eval', () => {
    const line = formatSummaryLine({
      eval_id: 1, eval_name: 'Debug Auth Bug', status: 'PASS', score: 0.85,
      duration_seconds: 92,
      token_usage: { claude: { input_tokens: 12500, output_tokens: 3200 } },
      sidecar_calls: [{ tool: 'sidecar_start', params: { model: 'gemini', agent: 'Build' } }],
    });
    expect(line).toContain('PASS');
    expect(line).toContain('Debug Auth Bug');
    expect(line).toContain('92s');
    expect(line).toContain('15.7k tok');
    expect(line).toContain('gemini');
    expect(line).toContain('Build');
  });

  test('formats failing eval', () => {
    const line = formatSummaryLine({
      eval_id: 3, eval_name: 'Research', status: 'FAIL', score: 0.6,
      duration_seconds: 78,
      token_usage: { claude: { input_tokens: 8000, output_tokens: 3300 } },
      sidecar_calls: [],
    });
    expect(line).toContain('FAIL');
  });
});

describe('writeResults', () => {
  test('writes result.json and transcript files to workspace dir', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-write-'));
    const result = {
      eval_id: 1, eval_name: 'Test', status: 'PASS', score: 1.0,
      duration_seconds: 10,
      token_usage: { claude: { input_tokens: 100, output_tokens: 50 } },
      programmatic_results: [], judge_results: null, sidecar_calls: [],
    };
    const rawLines = ['{"type":"usage","usage":{"input_tokens":100,"output_tokens":50}}'];

    writeResults(workDir, result, rawLines);

    expect(fs.existsSync(path.join(workDir, 'result.json'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'transcript.jsonl'))).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(workDir, 'result.json'), 'utf-8'));
    expect(written.eval_id).toBe(1);
    expect(written.status).toBe('PASS');

    fs.rmSync(workDir, { recursive: true });
  });
});
