import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { RunResult, StepResult } from './run-schema.ts';

export interface ReportOptions { noVideo?: boolean; output?: string; }

export function generateReport(runResult: RunResult, runDir: string, options: ReportOptions = {}): string {
  const outputPath = options.output ?? join(runDir, 'report.html');
  let videoBase64 = '';
  if (!options.noVideo && runResult.video) {
    try { const videoPath = join(runDir, runResult.video); const videoData = readFileSync(videoPath); videoBase64 = videoData.toString('base64'); } catch { /* not available */ }
  }
  const screenshotData: Map<string, string> = new Map();
  for (const step of runResult.steps) {
    if (step.screenshot) { try { const imgPath = join(runDir, step.screenshot); const imgData = readFileSync(imgPath); screenshotData.set(step.screenshot, imgData.toString('base64')); } catch { /* not available */ } }
  }
  const html = buildHtml(runResult, videoBase64, screenshotData);
  writeFileSync(outputPath, html);
  return outputPath;
}

export function buildHtml(run: RunResult, videoBase64: string, screenshots: Map<string, string>): string {
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
  if (step.assertion?.interactive_count) detail = `assert: interactive_count ≥ ${step.assertion.interactive_count.min}`;
  if (step.assertion?.bottom_nav_tabs) detail += (detail ? ', ' : 'assert: ') + `bottom_nav_tabs ≥ ${step.assertion.bottom_nav_tabs.min}`;

  let resultText = '';
  if (step.assertion?.interactive_count) resultText = `${statusIcon} ${step.assertion.interactive_count.actual} elements`;
  if (step.assertion?.bottom_nav_tabs) resultText += (resultText ? ', ' : `${statusIcon} `) + `${step.assertion.bottom_nav_tabs.actual} nav tabs`;
  if (step.error) resultText = `${statusIcon} ${step.error}`;
  if (!resultText && step.status === 'pass') resultText = `${statusIcon} ${step.elementCount} elements`;

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

function escHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── v2 report generator (VerifyResult → HTML) ──
import type { VerifyResult, VerifyStepResult } from './verify.ts';

export function generateReportV2(runResult: VerifyResult, runDir: string, options: ReportOptions = {}): string {
  const outputPath = options.output ?? join(runDir, 'report.html');
  const screenshotData: Map<string, string> = new Map();
  // 1. Collect screenshots from artifact events
  for (const step of runResult.steps) {
    for (const ev of step.events as Array<Record<string, unknown>>) {
      if (ev.type === 'artifact' && ev.path) {
        try { const imgPath = join(runDir, ev.path as string); const imgData = readFileSync(imgPath); screenshotData.set(ev.path as string, imgData.toString('base64')); } catch { /* not available */ }
      }
    }
  }
  // 2. Auto-detect screenshots by step ID pattern (step-S1.png, step-S2.png, etc.)
  for (const step of runResult.steps) {
    if (screenshotData.has(`step-${step.id}.png`)) continue;
    const patterns = [`step-${step.id}.png`, `step-${step.id}.jpg`, `${step.id}.png`, `${step.id}.jpg`];
    for (const p of patterns) {
      const candidate = join(runDir, p);
      if (existsSync(candidate)) {
        try { screenshotData.set(`step-${step.id}.png`, readFileSync(candidate).toString('base64')); } catch { /* skip */ }
        break;
      }
    }
  }
  // 3. Detect video
  let videoBase64 = '';
  const videoPath = join(runDir, 'recording.mp4');
  if (existsSync(videoPath)) {
    try { videoBase64 = readFileSync(videoPath).toString('base64'); } catch { /* not available */ }
  }
  // 4. Compute duration from event timestamps
  let durationMs = 0;
  const allEvents = runResult.steps.flatMap(s => s.events as Array<Record<string, unknown>>);
  const timestamps = allEvents.map(e => e.ts as string).filter(Boolean).map(t => new Date(t).getTime()).filter(t => !isNaN(t));
  if (timestamps.length >= 2) {
    durationMs = Math.max(...timestamps) - Math.min(...timestamps);
  }
  const html = buildHtmlV2(runResult, screenshotData, videoBase64, durationMs);
  writeFileSync(outputPath, html);
  return outputPath;
}

export function buildHtmlV2(run: VerifyResult, screenshots: Map<string, string> = new Map(), videoBase64: string = '', durationMs: number = 0): string {
  const passCount = run.steps.filter(s => s.outcome === 'pass').length;
  const failCount = run.steps.filter(s => s.outcome === 'fail').length;
  const skipCount = run.steps.filter(s => s.outcome === 'skipped').length;
  const resultClass = run.result === 'pass' ? 'pass' : 'fail';
  const durationStr = durationMs > 0 ? formatDuration(durationMs) : '';

  const renderStep = (s: VerifyResult['steps'][0], i: number): string => {
    const icon = s.outcome === 'pass' ? '&#10003;' : s.outcome === 'fail' ? '&#10007;' : '&#9675;';
    const cls = s.outcome === 'pass' ? 'pass' : s.outcome === 'fail' ? 'fail' : 'skip';
    const artifact = (s.events as Array<Record<string, unknown>>).find(e => e.type === 'artifact' && e.path);
    const imgB64 = artifact?.path ? screenshots.get(artifact.path as string) : screenshots.get(`step-${s.id}.png`);
    const expects = ((s.expectations || []) as Array<Record<string, unknown>>).map(e => {
      const met = e.met ? '&#10003;' : '&#10007;';
      return `<span class="expect ${e.met ? 'met' : 'unmet'}">${met} ${escHtml(e.milestone as string)}</span>`;
    }).join(' ');

    return `<div class="step ${cls}">
      <div class="step-header">
        <span class="step-num">${i + 1}</span>
        <span class="step-id">${escHtml(s.id)}</span>
        <span class="step-icon ${cls}">${icon}</span>
        <span class="step-outcome ${cls}">${s.outcome}</span>
      </div>
      <div class="step-do">${escHtml(s.do)}</div>
      ${expects ? `<div class="step-expects">${expects}</div>` : ''}
      ${imgB64 ? `<img class="step-screenshot" src="data:image/png;base64,${imgB64}" alt="${escHtml(s.id)} screenshot" />` : ''}
    </div>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flow Verify: ${escHtml(run.flow)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; min-height: 100vh; }
  .header { text-align: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #333; }
  .header h1 { font-size: 1.6em; margin-bottom: 8px; }
  .meta { font-size: 0.9em; color: #aaa; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.pass { background: #00d26a22; color: #00d26a; border: 1px solid #00d26a44; }
  .badge.fail { background: #e9456022; color: #e94560; border: 1px solid #e9456044; }
  .stats { display: flex; gap: 16px; justify-content: center; margin-top: 12px; font-size: 0.85em; }
  .stat { display: flex; align-items: center; gap: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot.pass { background: #00d26a; }
  .dot.fail { background: #e94560; }
  .dot.skip { background: #888; }
  .container { display: flex; gap: 20px; max-width: 1200px; margin: 0 auto; }
  .video-panel { flex: 0 0 360px; position: sticky; top: 20px; align-self: flex-start; }
  .video-panel video { width: 100%; border-radius: 12px; border: 2px solid #333; }
  .no-video { display: none; }
  .steps { flex: 1; max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .step { background: #16213e; border-radius: 10px; padding: 16px; border: 2px solid transparent; transition: border-color 0.2s; }
  .step:hover { border-color: #444; }
  .step.pass { border-left: 4px solid #00d26a; }
  .step.fail { border-left: 4px solid #e94560; }
  .step.skip { border-left: 4px solid #888; }
  .step-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .step-num { font-weight: bold; font-size: 0.85em; color: #888; min-width: 20px; }
  .step-id { font-weight: 700; font-size: 1em; }
  .step-icon { font-size: 1.1em; }
  .step-icon.pass { color: #00d26a; }
  .step-icon.fail { color: #e94560; }
  .step-icon.skip { color: #888; }
  .step-outcome { font-size: 0.8em; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
  .step-outcome.pass { color: #00d26a; }
  .step-outcome.fail { color: #e94560; }
  .step-outcome.skip { color: #888; }
  .step-do { font-size: 0.95em; color: #ccc; line-height: 1.4; margin-bottom: 6px; }
  .step-expects { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
  .expect { font-size: 0.8em; padding: 2px 8px; border-radius: 4px; }
  .expect.met { background: #00d26a22; color: #00d26a; }
  .expect.unmet { background: #e9456022; color: #e94560; }
  .step-screenshot { max-width: 280px; border-radius: 8px; margin-top: 10px; border: 1px solid #333; cursor: pointer; transition: max-width 0.3s; }
  .step-screenshot:hover { max-width: 500px; }
  .footer { text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #333; font-size: 0.75em; color: #666; }
  @media (max-width: 768px) { .container { flex-direction: column; } .video-panel { flex: none; position: static; } .video-panel video { max-width: 100%; } body { padding: 12px; } .step-screenshot { max-width: 100%; } }
</style>
</head>
<body>
<div class="header">
  <h1>${escHtml(run.flow)}</h1>
  <div class="meta">mode: ${escHtml(run.mode)} &middot; ${run.steps.length} steps${durationStr ? ` &middot; ${durationStr}` : ''}</div>
  <span class="badge ${resultClass}">${run.result}</span>
  <div class="stats">
    <span class="stat"><span class="dot pass"></span> ${passCount} pass</span>
    ${failCount > 0 ? `<span class="stat"><span class="dot fail"></span> ${failCount} fail</span>` : ''}
    ${skipCount > 0 ? `<span class="stat"><span class="dot skip"></span> ${skipCount} skip</span>` : ''}
  </div>
</div>
<div class="container">
  ${videoBase64 ? `<div class="video-panel"><video controls><source src="data:video/mp4;base64,${videoBase64}" type="video/mp4"></video></div>` : ''}
  <div class="steps">
${run.steps.map((s, i) => renderStep(s, i)).join('\n')}
  </div>
</div>
<div class="footer">Generated by flow-walker v2 &middot; <a href="https://github.com/beastoin/flow-walker" style="color:#666">github.com/beastoin/flow-walker</a></div>
</body>
</html>`;
}
