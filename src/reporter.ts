import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VerifyResult, VerifyStepResult } from './verify.ts';

export interface ReportOptions { noVideo?: boolean; output?: string; }

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
  // 2. Auto-detect screenshots by step ID pattern (step-S1.webp, step-S1.png, step-S1.jpg, etc.)
  for (const step of runResult.steps) {
    const key = `step-${step.id}`;
    if (screenshotData.has(`${key}.webp`) || screenshotData.has(`${key}.png`)) continue;
    const patterns = [`${key}.webp`, `${key}.png`, `${key}.jpg`, `${step.id}.webp`, `${step.id}.png`, `${step.id}.jpg`];
    for (const p of patterns) {
      const candidate = join(runDir, p);
      if (existsSync(candidate)) {
        try { screenshotData.set(p, readFileSync(candidate).toString('base64')); } catch { /* skip */ }
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
    const imgKey = artifact?.path as string || [`step-${s.id}.webp`, `step-${s.id}.png`, `step-${s.id}.jpg`].find(k => screenshots.has(k)) || `step-${s.id}.png`;
    const imgB64 = screenshots.get(imgKey);
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
      ${imgB64 ? `<img class="step-screenshot" src="data:${imgMime(imgKey)};base64,${imgB64}" alt="${escHtml(s.id)} screenshot" />` : ''}
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

function escHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgMime(filename: string): string {
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
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
