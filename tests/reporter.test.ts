import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../src/reporter.ts';
import type { RunResult } from '../src/run-schema.ts';

const makeRun = (overrides: Partial<RunResult> = {}): RunResult => ({
  id: 'test_runId1',
  flow: 'tab-navigation',
  device: 'Pixel_7a',
  startedAt: '2026-03-12T10:00:00Z',
  duration: 17600,
  result: 'pass',
  steps: [
    {
      index: 0,
      name: 'Verify home tab',
      action: 'assert',
      status: 'pass',
      timestamp: 1000,
      duration: 2300,
      elementCount: 24,
      screenshot: 'step-1-home.png',
      assertion: { interactive_count: { min: 20, actual: 24 } },
    },
    {
      index: 1,
      name: 'Press settings',
      action: 'press',
      status: 'pass',
      timestamp: 3300,
      duration: 1500,
      elementCount: 18,
    },
  ],
  ...overrides,
});

describe('buildHtml', () => {
  it('returns valid HTML document', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('includes flow name in title and header', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('<title>E2E Flow Viewer: tab-navigation</title>'));
    assert.ok(html.includes('tab-navigation'));
  });

  it('includes device name and duration in meta', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('Pixel_7a'));
    assert.ok(html.includes('17.6s'));
  });

  it('renders pass/fail counts in legend', () => {
    const run = makeRun({
      result: 'fail',
      steps: [
        { index: 0, name: 'S1', action: 'assert', status: 'pass', timestamp: 0, duration: 100, elementCount: 5 },
        { index: 1, name: 'S2', action: 'press', status: 'fail', timestamp: 100, duration: 200, elementCount: 3, error: 'not found' },
      ],
    });
    const html = buildHtml(run, '', new Map());
    assert.ok(html.includes('PASS (1)'));
    assert.ok(html.includes('FAIL (1)'));
    assert.ok(html.includes('1 FAIL'));
  });

  it('embeds video when base64 provided', () => {
    const videoB64 = 'AAAA'; // dummy base64
    const html = buildHtml(makeRun(), videoB64, new Map());
    assert.ok(html.includes('<video id="video"'));
    assert.ok(html.includes('data:video/mp4;base64,AAAA'));
    assert.ok(!html.includes('No video'));
  });

  it('shows no-video placeholder when no base64', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('No video'));
    assert.ok(!html.includes('data:video/mp4'));
  });

  it('renders step cards with data-time for seek', () => {
    const html = buildHtml(makeRun(), '', new Map());
    // Step 1 timestamp 1000ms → 1.0 sec
    assert.ok(html.includes('data-time="1.0"'));
    // Step 2 timestamp 3300ms → 3.3 sec
    assert.ok(html.includes('data-time="3.3"'));
  });

  it('renders step cards with jumpTo onclick', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('onclick="jumpTo('));
  });

  it('includes step names', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('Verify home tab'));
    assert.ok(html.includes('Press settings'));
  });

  it('renders pass/fail status classes on steps', () => {
    const run = makeRun({
      steps: [
        { index: 0, name: 'Good', action: 'assert', status: 'pass', timestamp: 0, duration: 100, elementCount: 5 },
        { index: 1, name: 'Bad', action: 'press', status: 'fail', timestamp: 100, duration: 200, elementCount: 0, error: 'fail' },
      ],
    });
    const html = buildHtml(run, '', new Map());
    assert.ok(html.includes('class="step pass"'));
    assert.ok(html.includes('class="step fail"'));
  });

  it('embeds screenshot thumbnails as base64 images', () => {
    const screenshots = new Map([['step-1-home.png', 'iVBOR']]);
    const html = buildHtml(makeRun(), '', screenshots);
    assert.ok(html.includes('data:image/png;base64,iVBOR'));
    assert.ok(html.includes('class="step-thumb"'));
  });

  it('renders assertion results in step detail', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('24 elements'));
  });

  it('renders error messages for failed steps', () => {
    const run = makeRun({
      steps: [
        { index: 0, name: 'Broken', action: 'press', status: 'fail', timestamp: 0, duration: 100, elementCount: 0, error: 'element not found' },
      ],
    });
    const html = buildHtml(run, '', new Map());
    assert.ok(html.includes('element not found'));
  });

  it('includes keyboard shortcut script', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes("document.addEventListener('keydown'"));
    assert.ok(html.includes('video.paused'));
  });

  it('includes timeupdate listener for auto-highlight', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes("video.addEventListener('timeupdate'"));
  });

  it('escapes HTML special characters in flow name', () => {
    const run = makeRun({ flow: '<script>alert("xss")</script>' });
    const html = buildHtml(run, '', new Map());
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('renders step numbers starting from 1', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('>1</div>'));
    assert.ok(html.includes('>2</div>'));
  });

  it('includes responsive CSS media query', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('@media (max-width: 768px)'));
  });

  it('renders all-pass summary when all steps pass', () => {
    const html = buildHtml(makeRun(), '', new Map());
    assert.ok(html.includes('All PASS'));
  });

  it('renders bottom_nav_tabs assertion result', () => {
    const run = makeRun({
      steps: [{
        index: 0,
        name: 'Check nav',
        action: 'assert',
        status: 'pass',
        timestamp: 0,
        duration: 100,
        elementCount: 20,
        assertion: { bottom_nav_tabs: { min: 4, actual: 5 } },
      }],
    });
    const html = buildHtml(run, '', new Map());
    assert.ok(html.includes('5 nav tabs'));
  });
});
