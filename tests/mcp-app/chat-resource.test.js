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

  test('contains messages container', () => {
    expect(html).toContain('messages-container');
  });

  test('contains toolbar with fold button', () => {
    expect(html).toContain('sidecar-toolbar');
    expect(html).toContain('Fold');
  });

  test('contains chat input and send button', () => {
    expect(html).toContain('chat-input');
    expect(html).toContain('send-btn');
  });

  test('contains fold button with orange styling', () => {
    expect(html.toLowerCase()).toContain('#d97757');
    expect(html).toContain('fold-btn');
  });

  test('contains sidecar branding', () => {
    expect(html).toContain('Sidecar');
  });

  test('contains sidecar_app_fold tool reference', () => {
    expect(html).toContain('sidecar_app_fold');
  });

  test('contains sidecar_app_send tool reference', () => {
    expect(html).toContain('sidecar_app_send');
  });

  test('contains updateModelContext for fold summary', () => {
    expect(html).toContain('updateModelContext');
  });

  test('contains timer element', () => {
    expect(html).toContain('timer');
  });

  test('contains model badge element', () => {
    expect(html).toContain('model-badge');
  });

  test('contains fold overlay', () => {
    expect(html).toContain('fold-overlay');
    expect(html).toContain('Generating summary');
  });
});
