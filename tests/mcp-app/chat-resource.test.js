const { buildChatResource } = require('../../src/mcp-app/chat-resource');

describe('buildChatResource', () => {
  let html;

  beforeAll(() => {
    html = buildChatResource();
  });

  test('returns valid HTML string', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  test('contains opencode iframe placeholder', () => {
    expect(html).toContain('id="opencode-frame"');
  });

  test('contains toolbar with fold button', () => {
    expect(html).toContain('id="sidecar-toolbar"');
    expect(html).toContain('Fold');
  });

  test('contains chat input and send button', () => {
    expect(html).toContain('id="chat-input"');
    expect(html).toContain('id="send-btn"');
  });

  test('contains fold button with orange styling', () => {
    expect(html).toContain('#D97757');
    expect(html).toContain('id="fold-btn"');
  });

  test('contains sidecar branding', () => {
    expect(html).toContain('Sidecar');
  });

  test('contains App.callTool usage for fold', () => {
    expect(html).toContain('sidecar_app_fold');
  });

  test('contains App.callTool usage for send', () => {
    expect(html).toContain('sidecar_app_send');
  });

  test('contains App.updateContext for fold summary', () => {
    expect(html).toContain('updateContext');
  });

  test('contains timer element', () => {
    expect(html).toContain('id="timer"');
  });

  test('contains model badge element', () => {
    expect(html).toContain('id="model-badge"');
  });

  test('contains CSS injection for OpenCode header hiding', () => {
    expect(html).toContain('header');
    expect(html).toContain('display: none');
  });

  test('contains fold overlay', () => {
    expect(html).toContain('id="fold-overlay"');
    expect(html).toContain('Generating summary');
  });
});
