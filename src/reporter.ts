import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { VerifyResult, VerifyStepResult, AutomatedCheck, AgentPrompt } from './verify.ts';

export interface ReportOptions { noVideo?: boolean; output?: string; }

export function generateReportV2(runResult: VerifyResult, runDir: string, options: ReportOptions = {}): string {
  const outputPath = options.output ?? join(runDir, 'report.html');
  const screenshotData: Map<string, string> = new Map();
  // 1. Collect screenshots from artifact events
  for (const step of runResult.steps) {
    for (const ev of step.events as Array<Record<string, unknown>>) {
      if (ev.type === 'artifact' && ev.path) {
        const evPath = ev.path as string;
        const candidates = [join(runDir, evPath), join(runDir, basename(evPath))];
        for (const imgPath of candidates) {
          try { const imgData = readFileSync(imgPath); screenshotData.set(evPath, imgData.toString('base64')); screenshotData.set(basename(evPath), imgData.toString('base64')); break; } catch { /* try next */ }
        }
      }
    }
  }
  // 2. Auto-detect screenshots by step ID pattern
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

  // Tier summaries
  const autoPassCount = run.steps.filter(s => s.automated?.result === 'pass').length;
  const autoTotalChecks = run.steps.reduce((n, s) => n + (s.automated?.checks?.length || 0), 0);
  const agentPendingCount = run.steps.filter(s => s.agent?.prompts?.length > 0 && s.agent.result === 'pending').length;

  const renderAutomatedChecks = (checks: AutomatedCheck[]): string => {
    if (!checks || checks.length === 0) return '';
    const rows = checks.map(c => {
      const statusCls = c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'fail' : 'noev';
      const statusLabel = c.status === 'no_evidence' ? 'no evidence' : c.status;
      const expectedStr = c.expected ? Object.entries(c.expected).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : '';
      const actualStr = c.actual && Object.keys(c.actual).length > 0 ? Object.entries(c.actual).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : 'none';
      return `<tr><td>${escHtml(c.kind)}</td><td class="expected">${escHtml(expectedStr)}</td><td class="actual">${escHtml(actualStr)}</td><td class="check-status ${statusCls}">${statusLabel}</td></tr>`;
    }).join('');
    return `<div class="automated-section"><div class="section-label">Automated Checks</div><table class="checks-table"><tr><th>Check</th><th>Expected</th><th>Actual</th><th>Status</th></tr>${rows}</table></div>`;
  };

  const renderAgentPrompts = (prompts: AgentPrompt[]): string => {
    if (!prompts || prompts.length === 0) return '';
    const cards = prompts.map(p => {
      const lookFor = p.look_for?.length ? `<div class="prompt-detail"><b>Look for:</b> ${p.look_for.map(l => escHtml(l)).join(', ')}</div>` : '';
      const failIf = p.fail_if?.length ? `<div class="prompt-detail"><b>Fail if:</b> ${p.fail_if.map(f => escHtml(f)).join(', ')}</div>` : '';
      return `<div class="agent-prompt-card"><div class="prompt-question">${escHtml(p.prompt)}</div>${lookFor}${failIf}<div class="prompt-status">${p.status}</div></div>`;
    }).join('');
    return `<div class="agent-section"><div class="section-label">Agent Review</div>${cards}</div>`;
  };

  const renderStep = (s: VerifyStepResult, i: number): string => {
    const icon = s.outcome === 'pass' ? '&#10003;' : s.outcome === 'fail' ? '&#10007;' : '&#9675;';
    const cls = s.outcome === 'pass' ? 'pass' : s.outcome === 'fail' ? 'fail' : 'skip';
    const artifact = (s.events as Array<Record<string, unknown>>).find(e => e.type === 'artifact' && e.path);
    const artifactPath = artifact?.path as string | undefined;
    const imgKey = (artifactPath && screenshots.has(artifactPath) ? artifactPath : undefined)
      || [`step-${s.id}.webp`, `step-${s.id}.png`, `step-${s.id}.jpg`].find(k => screenshots.has(k))
      || `step-${s.id}.png`;
    const imgB64 = screenshots.get(imgKey);

    const claim = s.claim || s.name || s.do;
    const showDo = s.do !== claim;

    return `<div class="step ${cls}">
      <div class="step-header">
        <span class="step-num">${i + 1}</span>
        <span class="step-id">${escHtml(s.id)}</span>
        <span class="step-icon ${cls}">${icon}</span>
        <span class="step-outcome ${cls}">${s.outcome}</span>
      </div>
      <div class="step-claim">${escHtml(claim)}</div>
      ${showDo ? `<div class="step-do">Action: ${escHtml(s.do)}</div>` : ''}
      ${renderAutomatedChecks(s.automated?.checks)}
      ${renderAgentPrompts(s.agent?.prompts)}
      ${imgB64 ? `<img class="step-screenshot" src="data:${imgMime(imgKey)};base64,${imgB64}" alt="${escHtml(s.id)} screenshot" />` : ''}
    </div>`;
  };

  // Embed run data as JSON for machine consumption
  const reportData = JSON.stringify({
    schema: run.schema || 'flow-walker.run.v3',
    flow: run.flow, mode: run.mode, result: run.result,
    automatedResult: run.automatedResult, agentResult: run.agentResult,
    steps: run.steps.map(s => ({
      id: s.id, name: s.name, do: s.do, claim: s.claim,
      outcome: s.outcome,
      automated: s.automated, agent: s.agent,
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flow Verify: ${escHtml(run.flow)}</title>
<script type="application/json" id="report-data">${reportData.replace(/</g, '\\u003c')}</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; min-height: 100vh; }
  .header { text-align: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #333; }
  .header h1 { font-size: 1.6em; margin-bottom: 8px; }
  .meta { font-size: 0.9em; color: #aaa; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.pass { background: #00d26a22; color: #00d26a; border: 1px solid #00d26a44; }
  .badge.fail { background: #e9456022; color: #e94560; border: 1px solid #e9456044; }
  .badge.pending { background: #f0a50022; color: #f0a500; border: 1px solid #f0a50044; }
  .stats { display: flex; gap: 16px; justify-content: center; margin-top: 12px; font-size: 0.85em; flex-wrap: wrap; }
  .stat { display: flex; align-items: center; gap: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot.pass { background: #00d26a; }
  .dot.fail { background: #e94560; }
  .dot.skip { background: #888; }
  .dot.pending { background: #f0a500; }
  .tier-summary { display: flex; gap: 20px; justify-content: center; margin-top: 8px; font-size: 0.8em; color: #aaa; }
  .container { display: flex; gap: 20px; max-width: 1200px; margin: 0 auto; }
  .video-panel { flex: 0 0 360px; position: sticky; top: 20px; align-self: flex-start; }
  .video-panel video { width: 100%; border-radius: 12px; border: 2px solid #333; }
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
  .step-claim { font-size: 1em; color: #fff; font-weight: 600; line-height: 1.4; margin-bottom: 4px; }
  .step-do { font-size: 0.85em; color: #888; line-height: 1.4; margin-bottom: 8px; font-style: italic; }
  .section-label { font-size: 0.75em; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 6px; font-weight: 600; }
  .automated-section { margin-top: 8px; }
  .checks-table { width: 100%; font-size: 0.8em; border-collapse: collapse; }
  .checks-table th { text-align: left; color: #888; padding: 4px 8px; border-bottom: 1px solid #333; }
  .checks-table td { padding: 4px 8px; border-bottom: 1px solid #222; }
  .checks-table .expected { color: #aaa; }
  .checks-table .actual { color: #ccc; }
  .check-status { font-weight: 600; text-transform: uppercase; font-size: 0.9em; }
  .check-status.pass { color: #00d26a; }
  .check-status.fail { color: #e94560; }
  .check-status.noev { color: #f0a500; }
  .agent-section { margin-top: 10px; }
  .agent-prompt-card { background: #1a1a3e; border: 1px solid #333; border-radius: 6px; padding: 10px; margin-top: 6px; }
  .prompt-question { font-size: 0.9em; color: #ddd; margin-bottom: 4px; }
  .prompt-detail { font-size: 0.8em; color: #aaa; margin-top: 2px; }
  .prompt-status { font-size: 0.75em; color: #f0a500; text-transform: uppercase; margin-top: 4px; }
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
  <div class="tier-summary">
    <span>Automated: ${autoPassCount}/${run.steps.length} pass${autoTotalChecks > 0 ? ` (${autoTotalChecks} checks)` : ''}</span>
    ${agentPendingCount > 0 ? `<span><span class="dot pending"></span> Agent review: ${agentPendingCount} pending</span>` : ''}
  </div>
</div>
<div class="container">
  ${videoBase64 ? `<div class="video-panel"><video controls><source src="data:video/mp4;base64,${videoBase64}" type="video/mp4"></video></div>` : ''}
  <div class="steps">
${run.steps.map((s, i) => renderStep(s, i)).join('\n')}
  </div>
</div>
<div class="footer">Generated by flow-walker v3 &middot; <a href="https://github.com/beastoin/flow-walker" style="color:#666">github.com/beastoin/flow-walker</a></div>
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
