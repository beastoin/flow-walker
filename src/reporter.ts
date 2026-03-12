// HTML report generator: run.json → self-contained HTML viewer

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { RunResult, StepResult } from './run-schema.ts';

export interface ReportOptions {
  noVideo?: boolean;
  output?: string;
}

/** Generate a self-contained HTML report from a RunResult */
export function generateReport(runResult: RunResult, runDir: string, options: ReportOptions = {}): string {
  const outputPath = options.output ?? join(runDir, 'report.html');

  // Embed video as base64 if available
  let videoBase64 = '';
  if (!options.noVideo && runResult.video) {
    try {
      const videoPath = join(runDir, runResult.video);
      const videoData = readFileSync(videoPath);
      videoBase64 = videoData.toString('base64');
    } catch { /* video not available */ }
  }

  // Embed screenshots as base64
  const screenshotData: Map<string, string> = new Map();
  for (const step of runResult.steps) {
    if (step.screenshot) {
      try {
        const imgPath = join(runDir, step.screenshot);
        const imgData = readFileSync(imgPath);
        screenshotData.set(step.screenshot, imgData.toString('base64'));
      } catch { /* screenshot not available */ }
    }
  }

  const html = buildHtml(runResult, videoBase64, screenshotData);
  writeFileSync(outputPath, html);
  return outputPath;
}

/** Build the HTML string */
export function buildHtml(
  run: RunResult,
  videoBase64: string,
  screenshots: Map<string, string>,
): string {
  const passCount = run.steps.filter(s => s.status === 'pass').length;
  const failCount = run.steps.filter(s => s.status === 'fail').length;
  const durationSec = (run.duration / 1000).toFixed(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>E2E Flow Viewer: ${escHtml(run.flow)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
  .header { text-align: center; margin-bottom: 20px; }
  .header h1 { font-size: 1.5em; margin-bottom: 8px; }
  .header .meta { font-size: 0.9em; color: #aaa; }
  .legend { display: flex; gap: 16px; justify-content: center; margin: 12px 0; font-size: 0.85em; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
  .dot.pass { background: #00d26a; }
  .dot.fail { background: #e94560; }
  .dot.active { background: #ffa500; }
  .container { display: flex; gap: 20px; max-width: 1200px; margin: 0 auto; }
  .video-panel { flex: 1; position: sticky; top: 20px; align-self: flex-start; }
  .video-panel video { width: 100%; max-width: 360px; border-radius: 12px; border: 2px solid #333; }
  .steps-panel { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .step { background: #16213e; border-radius: 10px; padding: 14px; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s; }
  .step:hover { border-color: #555; }
  .step.active { border-color: #ffa500; }
  .step.pass { border-left: 4px solid #00d26a; }
  .step.fail { border-left: 4px solid #e94560; }
  .step-header { display: flex; align-items: center; gap: 10px; }
  .step-num { font-weight: bold; font-size: 1.1em; min-width: 24px; }
  .step-name { font-weight: 600; }
  .step-detail { font-size: 0.85em; color: #aaa; margin-top: 4px; }
  .step-time { font-size: 0.8em; color: #e94560; font-family: monospace; margin-top: 2px; }
  .step-result { font-size: 0.85em; margin-top: 4px; }
  .step-result.pass { color: #00d26a; }
  .step-result.fail { color: #e94560; }
  .step-thumb { max-width: 120px; border-radius: 6px; margin-top: 8px; display: none; }
  .step.active .step-thumb { display: block; }
  .no-video { display: flex; align-items: center; justify-content: center; width: 360px; height: 640px; background: #16213e; border-radius: 12px; border: 2px solid #333; color: #666; }
  @media (max-width: 768px) {
    .container { flex-direction: column; }
    .video-panel { position: static; }
    .video-panel video, .no-video { max-width: 100%; width: 100%; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>${escHtml(run.flow)}</h1>
  <div class="meta">${escHtml(run.device)} &middot; ${durationSec}s &middot; ${run.steps.length} steps</div>
  <div class="legend">
    <span><span class="dot pass"></span> PASS (${passCount})</span>
    <span><span class="dot fail"></span> FAIL (${failCount})</span>
    <span><span class="dot active"></span> Active step</span>
    <span>Duration: ${durationSec}s | ${run.steps.length} steps | ${run.result === 'pass' ? 'All PASS' : failCount + ' FAIL'}</span>
  </div>
</div>
<div class="container">
  <div class="video-panel">
    ${videoBase64
      ? `<video id="video" controls><source src="data:video/mp4;base64,${videoBase64}" type="video/mp4"></video>`
      : '<div class="no-video">No video</div>'}
  </div>
  <div class="steps-panel">
${run.steps.map((s, i) => renderStep(s, i, screenshots)).join('\n')}
  </div>
</div>
<script>
const video = document.getElementById('video');
const steps = document.querySelectorAll('.step');

function jumpTo(time, el) {
  if (video) { video.currentTime = time; video.play(); }
  steps.forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
}

// Keyboard shortcuts: 1-9 jump to step, Space play/pause
document.addEventListener('keydown', (e) => {
  const num = parseInt(e.key);
  if (num >= 1 && num <= steps.length) {
    const step = steps[num - 1];
    const time = parseFloat(step.getAttribute('data-time') || '0');
    jumpTo(time, step);
  }
  if (e.key === ' ' && video) {
    e.preventDefault();
    video.paused ? video.play() : video.pause();
  }
});

// Auto-highlight step based on video time
if (video) {
  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    let active = steps[0];
    for (const step of steps) {
      if (parseFloat(step.getAttribute('data-time') || '0') <= t) active = step;
    }
    steps.forEach(s => s.classList.remove('active'));
    if (active) active.classList.add('active');
  });
}
</script>
</body>
</html>`;
}

function renderStep(step: StepResult, index: number, screenshots: Map<string, string>): string {
  const timeSec = (step.timestamp / 1000).toFixed(1);
  const statusClass = step.status === 'pass' ? 'pass' : step.status === 'fail' ? 'fail' : '';
  const statusIcon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '○';

  let detail = step.action;
  if (step.assertion?.interactive_count) {
    detail = `assert: interactive_count ≥ ${step.assertion.interactive_count.min}`;
  }
  if (step.assertion?.bottom_nav_tabs) {
    detail += (detail ? ', ' : 'assert: ') + `bottom_nav_tabs ≥ ${step.assertion.bottom_nav_tabs.min}`;
  }

  let resultText = '';
  if (step.assertion?.interactive_count) {
    resultText = `${statusIcon} ${step.assertion.interactive_count.actual} elements`;
  }
  if (step.assertion?.bottom_nav_tabs) {
    resultText += (resultText ? ', ' : `${statusIcon} `) + `${step.assertion.bottom_nav_tabs.actual} nav tabs`;
  }
  if (step.error) {
    resultText = `${statusIcon} ${step.error}`;
  }
  if (!resultText && step.status === 'pass') {
    resultText = `${statusIcon} ${step.elementCount} elements`;
  }

  let thumbHtml = '';
  if (step.screenshot && screenshots.has(step.screenshot)) {
    thumbHtml = `<img class="step-thumb" src="data:image/png;base64,${screenshots.get(step.screenshot)}" alt="Step ${index + 1}">`;
  }

  return `    <div class="step ${statusClass}" data-time="${timeSec}" onclick="jumpTo(${timeSec}, this)">
      <div class="step-header">
        <div class="step-num">${index + 1}</div>
        <div>
          <div class="step-name">${escHtml(step.name)}</div>
          <div class="step-detail">${escHtml(detail)}</div>
          <div class="step-time">⏱ 0:${timeSec.padStart(4, '0')}</div>
          <div class="step-result ${statusClass}">${escHtml(resultText)}</div>
        </div>
      </div>
      ${thumbHtml}
    </div>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
