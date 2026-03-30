import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import type { VerifyResult, VerifyStepResult, AutomatedCheck, AgentPrompt } from './verify.ts';
import { parseLogFile, filterByTimeWindow } from './log-parser.ts';
import { findRunFile } from './run-files.ts';
const PKG_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export interface ReportOptions { noVideo?: boolean; output?: string; }
export interface LogEntry { ts: string; source: string; message: string; stepId?: string; level?: string; cite?: string; }

/** Try to load an image file into the screenshot map under one or more keys */
function loadImage(runDir: string, filePath: string, screenshotData: Map<string, string>): boolean {
  const candidates = [join(runDir, filePath), join(runDir, basename(filePath))];
  for (const imgPath of candidates) {
    try {
      const imgData = readFileSync(imgPath);
      if (imgData.length === 0) continue;
      const b64 = imgData.toString('base64');
      screenshotData.set(filePath, b64);
      screenshotData.set(basename(filePath), b64);
      return true;
    } catch { /* try next */ }
  }
  return false;
}

export function generateReportV2(runResult: VerifyResult, runDir: string, options: ReportOptions = {}): string {
  const tsNow = new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
  const outputPath = options.output ?? join(runDir, `${tsNow}-report.html`);
  const screenshotData: Map<string, string> = new Map();
  // Per-step screenshot mapping: step ID → filename
  const stepScreenshot: Map<string, string> = new Map();

  // 1. Collect screenshots from ALL events — artifact events, screenshot fields, path fields
  for (const step of runResult.steps) {
    for (const ev of step.events as Array<Record<string, unknown>>) {
      // Artifact events (primary)
      if (ev.type === 'artifact' && ev.path) {
        const evPath = ev.path as string;
        if (loadImage(runDir, evPath, screenshotData)) {
          stepScreenshot.set(step.id, basename(evPath));
        }
      }
      // Screenshot field on any event type (action, assert, agent-review, etc.)
      const screenshotField = ev.screenshot as string | undefined;
      if (screenshotField && !stepScreenshot.has(step.id)) {
        if (loadImage(runDir, screenshotField, screenshotData)) {
          stepScreenshot.set(step.id, basename(screenshotField));
        }
      }
    }
  }

  // 2. Auto-detect screenshots by step ID pattern
  for (const step of runResult.steps) {
    if (stepScreenshot.has(step.id)) continue;
    const key = `step-${step.id}`;
    if (screenshotData.has(`${key}.webp`) || screenshotData.has(`${key}.png`)) continue;
    const patterns = [`${key}.webp`, `${key}.png`, `${key}.jpg`, `${step.id}.webp`, `${step.id}.png`, `${step.id}.jpg`];
    for (const p of patterns) {
      const candidate = join(runDir, p);
      if (existsSync(candidate)) {
        try { screenshotData.set(p, readFileSync(candidate).toString('base64')); stepScreenshot.set(step.id, p); } catch { /* skip */ }
        break;
      }
    }
  }

  // 3. Scan run directory for any unmatched image files and assign to steps without screenshots
  try {
    const files = readdirSync(runDir).filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f)).sort();
    const unmatched = runResult.steps.filter(s => !stepScreenshot.has(s.id));
    for (const file of files) {
      if (screenshotData.has(file)) continue;
      // Try to match by step ID in filename (e.g., "s1-pending.webp" matches S1)
      const idMatch = file.match(/(?:^|[-_])s(\d+)[-_.]/i) || file.match(/(?:^|[-_])(S\d+)[-_.]/i);
      if (idMatch) {
        const matchId = `S${idMatch[1].replace(/^S/i, '')}`;
        const step = runResult.steps.find(s => s.id === matchId);
        if (step && !stepScreenshot.has(step.id)) {
          if (loadImage(runDir, file, screenshotData)) {
            stepScreenshot.set(step.id, file);
          }
        }
      }
    }
    // Assign remaining images to remaining unmatched steps in order
    const stillUnmatched = runResult.steps.filter(s => !stepScreenshot.has(s.id));
    const unusedImages = files.filter(f => !Array.from(stepScreenshot.values()).includes(f) && !screenshotData.has(f));
    for (let i = 0; i < Math.min(stillUnmatched.length, unusedImages.length); i++) {
      if (loadImage(runDir, unusedImages[i], screenshotData)) {
        stepScreenshot.set(stillUnmatched[i].id, unusedImages[i]);
      }
    }
  } catch { /* directory scan failed — not critical */ }
  // 3. Detect video (supports timestamped names)
  let videoBase64 = '';
  const videoPath = findRunFile(runDir, 'recording.mp4');
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
  // 5. Build log timeline — three sources merged and correlated with steps
  const logTimeline: LogEntry[] = [];

  // 5a. Build step time ranges for auto-correlation
  const stepRanges: Array<{ id: string; start: number; end: number }> = [];
  for (const step of runResult.steps) {
    const evs = step.events as Array<Record<string, unknown>>;
    const startEv = evs.find(e => e.type === 'step.start');
    const endEv = evs.find(e => e.type === 'step.end');
    const startMs = startEv?.ts ? new Date(startEv.ts as string).getTime() : 0;
    const endMs = endEv?.ts ? new Date(endEv.ts as string).getTime() : Infinity;
    if (startMs > 0) stepRanges.push({ id: step.id, start: startMs, end: endMs });
  }
  const findStepForTs = (tsMs: number): string | undefined => {
    for (const r of stepRanges) { if (tsMs >= r.start && tsMs <= r.end) return r.id; }
    return undefined;
  };

  // 5b. Read run time window from meta (filter log files to run duration)
  let runStartIso: string | undefined;
  let runEndIso: string | undefined;
  try {
    const metaPath = join(runDir, 'run.meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      runStartIso = meta.startedAt;
      runEndIso = meta.finishedAt;
    }
  } catch { /* not critical */ }

  // 5c. Auto-discover and parse .log files from run directory
  const rawLogs: Map<string, string> = new Map();
  try {
    const logFiles = readdirSync(runDir).filter(f => /\.log$/i.test(f)).sort();
    for (const logFile of logFiles) {
      try {
        const content = readFileSync(join(runDir, logFile), 'utf-8');
        rawLogs.set(logFile, content);
        // Derive source name: strip timestamp prefix and extension
        // e.g., "20260330T100001Z-S3-backend.log" → "backend"
        // e.g., "backend.log" → "backend"
        const sourceName = logFile.replace(/^\d{8}T\d+Z-\w+-/, '').replace(/\.log$/i, '');
        let parsed = parseLogFile(content);
        parsed = filterByTimeWindow(parsed, runStartIso, runEndIso);
        for (const line of parsed) {
          const tsMs = new Date(line.ts).getTime();
          logTimeline.push({
            ts: line.ts,
            source: sourceName,
            message: line.message,
            stepId: findStepForTs(tsMs),
            level: line.level,
            cite: `${logFile}:${line.line}`,
          });
        }
      } catch { /* skip unparseable log files */ }
    }
  } catch { /* directory scan failed */ }

  // 5d. Collect note events with source field (manual annotations from agents)
  for (const step of runResult.steps) {
    for (const ev of step.events as Array<Record<string, unknown>>) {
      if (ev.type === 'note' && typeof ev.source === 'string' && typeof ev.message === 'string') {
        logTimeline.push({ ts: (ev.ts as string) || '', source: ev.source, message: ev.message, stepId: step.id, level: ev.level as string });
      }
    }
  }
  // Orphaned notes (no step_id) from events.jsonl
  try {
    const eventsPath = findRunFile(runDir, 'events.jsonl');
    if (existsSync(eventsPath)) {
      const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'note' && typeof ev.source === 'string' && !ev.step_id) {
            logTimeline.push({ ts: ev.ts || '', source: ev.source, message: ev.message || '', level: ev.level });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* not critical */ }

  // 5e. Sort and cap at 1000 entries
  logTimeline.sort((a, b) => a.ts.localeCompare(b.ts));
  if (logTimeline.length > 1000) logTimeline.length = 1000;

  const html = buildHtmlV2(runResult, screenshotData, videoBase64, durationMs, stepScreenshot, logTimeline, rawLogs);
  writeFileSync(outputPath, html);
  // Store report filename in meta
  try {
    const metaPath = join(runDir, 'run.meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.reportFile = basename(outputPath);
      writeFileSync(metaPath, JSON.stringify(meta));
    }
  } catch { /* best-effort */ }
  return outputPath;
}

export function buildHtmlV2(run: VerifyResult, screenshots: Map<string, string> = new Map(), videoBase64: string = '', durationMs: number = 0, stepScreenshotMap: Map<string, string> = new Map(), logTimeline: LogEntry[] = [], rawLogs: Map<string, string> = new Map()): string {
  const passCount = run.steps.filter(s => s.outcome === 'pass').length;
  const failCount = run.steps.filter(s => s.outcome === 'fail').length;
  const skipCount = run.steps.filter(s => s.outcome === 'skipped').length;
  const resultClass = run.result === 'pass' ? 'pass' : run.result === 'unverified' ? 'unverified' : 'fail';
  const resultLabel = run.mode === 'audit' && run.result !== 'fail' ? 'AUDIT' : run.result.toUpperCase();
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
    const validPrompts = prompts.filter(p => p.prompt);
    if (validPrompts.length === 0) return '';
    const cards = validPrompts.map(p => {
      const lookFor = p.look_for?.length ? `<div class="prompt-detail"><b>Look for:</b> ${p.look_for.map(l => escHtml(l)).join(', ')}</div>` : '';
      const failIf = p.fail_if?.length ? `<div class="prompt-detail"><b>Fail if:</b> ${p.fail_if.map(f => escHtml(f)).join(', ')}</div>` : '';
      return `<div class="agent-prompt-card"><div class="prompt-question">${escHtml(p.prompt)}</div>${lookFor}${failIf}<div class="prompt-status">${p.status}</div></div>`;
    }).join('');
    return `<div class="agent-section"><div class="section-label">Agent Review</div>${cards}</div>`;
  };

  const renderStep = (s: VerifyStepResult, i: number): string => {
    const icon = s.outcome === 'pass' ? '&#10003;' : s.outcome === 'fail' ? '&#10007;' : '&#9675;';
    const cls = s.outcome === 'pass' ? 'pass' : s.outcome === 'fail' ? 'fail' : 'skip';
    // Find screenshot: explicit map → artifact event → screenshot field → pattern match
    const mapped = stepScreenshotMap.get(s.id);
    const artifact = (s.events as Array<Record<string, unknown>>).find(e => e.type === 'artifact' && e.path);
    const artifactPath = artifact?.path as string | undefined;
    const screenshotField = (s.events as Array<Record<string, unknown>>).find(e => e.screenshot)?.screenshot as string | undefined;
    const imgKey = (mapped && screenshots.has(mapped) ? mapped : undefined)
      || (artifactPath && screenshots.has(artifactPath) ? artifactPath : undefined)
      || (artifactPath && screenshots.has(basename(artifactPath)) ? basename(artifactPath) : undefined)
      || (screenshotField && screenshots.has(screenshotField) ? screenshotField : undefined)
      || (screenshotField && screenshots.has(basename(screenshotField)) ? basename(screenshotField) : undefined)
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

  // Render log timeline with citations and raw log sections
  const renderLogTimeline = (): string => {
    if (logTimeline.length === 0 && rawLogs.size === 0) return '';
    let html = '';
    // Timeline table
    if (logTimeline.length > 0) {
      const baseTs = logTimeline[0].ts ? new Date(logTimeline[0].ts).getTime() : 0;
      const rows = logTimeline.map(entry => {
        const entryMs = entry.ts ? new Date(entry.ts).getTime() : 0;
        const relMs = baseTs > 0 && entryMs > 0 ? entryMs - baseTs : 0;
        const relStr = relMs >= 0 ? `+${(relMs / 1000).toFixed(2)}s` : '';
        const levelCls = entry.level === 'error' ? 'log-error' : entry.level === 'warn' ? 'log-warn' : '';
        // Citation: clickable link to raw log line if available
        const citeHtml = entry.cite ? (() => {
          const [file, lineNo] = entry.cite.split(':');
          const anchor = `${file.replace(/[^a-zA-Z0-9]/g, '-')}-L${lineNo}`;
          return `<td class="log-cite"><a href="#${anchor}">${escHtml(entry.cite)}</a></td>`;
        })() : '<td class="log-cite"></td>';
        return `<tr class="${levelCls}"><td class="log-ts">${escHtml(relStr)}</td><td><span class="log-source log-src-${escHtml(entry.source)}">${escHtml(entry.source)}</span></td><td class="log-step">${escHtml(entry.stepId || '')}</td><td class="log-msg">${escHtml(entry.message)}</td>${citeHtml}</tr>`;
      }).join('');
      const sources = [...new Set(logTimeline.map(e => e.source))];
      const sourcesSummary = sources.map(s => `<span class="log-source log-src-${escHtml(s)}">${escHtml(s)}</span>`).join(' ');
      html += `<div class="log-timeline-section"><div class="section-title">Log Timeline</div><div class="timeline-meta">${logTimeline.length} entries from ${sourcesSummary}</div><table class="timeline-table"><tr><th>Time</th><th>Source</th><th>Step</th><th>Message</th><th>Cite</th></tr>${rows}</table></div>`;
    }
    // Raw log sections (collapsible, with line numbers and anchors for citations)
    if (rawLogs.size > 0) {
      html += '<div class="raw-logs-section"><div class="section-title">Raw Logs</div>';
      for (const [filename, content] of rawLogs) {
        const fileSlug = filename.replace(/[^a-zA-Z0-9]/g, '-');
        const lines = content.split('\n');
        const maxLines = Math.min(lines.length, 1000);
        const numberedLines = lines.slice(0, maxLines).map((line, i) => {
          const lineNo = i + 1;
          const anchor = `${fileSlug}-L${lineNo}`;
          return `<span id="${anchor}" class="raw-line"><span class="raw-ln">${lineNo}</span>${escHtml(line)}</span>`;
        }).join('\n');
        const truncNote = lines.length > 1000 ? `<div class="raw-trunc">Showing first 1000 of ${lines.length} lines</div>` : '';
        html += `<details class="raw-log-block"><summary>${escHtml(filename)} (${lines.length} lines)</summary><pre class="raw-log-pre">${numberedLines}</pre>${truncNote}</details>`;
      }
      html += '</div>';
    }
    return html;
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
  .badge.unverified { background: #f0a50022; color: #f0a500; border: 1px solid #f0a50044; }
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
  .log-timeline-section { max-width: 1200px; margin: 24px auto 0; }
  .section-title { font-size: 1.1em; font-weight: 700; color: #ddd; margin-bottom: 12px; }
  .timeline-meta { font-size: 0.8em; color: #888; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .timeline-table { width: 100%; font-size: 0.8em; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
  .timeline-table th { text-align: left; color: #888; padding: 8px 10px; border-bottom: 1px solid #333; font-weight: 600; }
  .timeline-table td { padding: 5px 10px; border-bottom: 1px solid #222; vertical-align: top; }
  .log-ts { font-family: 'SF Mono', 'Consolas', monospace; color: #888; white-space: nowrap; }
  .log-source { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 0.85em; font-weight: 600; }
  .log-src-app { background: #4fc3f722; color: #4fc3f7; }
  .log-src-backend { background: #81c78422; color: #81c784; }
  .log-src-device { background: #ce93d822; color: #ce93d8; }
  .log-source:not(.log-src-app):not(.log-src-backend):not(.log-src-device) { background: #aaa22; color: #aaa; }
  .log-step { color: #888; font-size: 0.9em; }
  .log-msg { color: #ccc; font-family: 'SF Mono', 'Consolas', monospace; font-size: 0.95em; word-break: break-word; }
  .log-cite { white-space: nowrap; }
  .log-cite a { color: #666; text-decoration: none; font-family: 'SF Mono', 'Consolas', monospace; font-size: 0.85em; }
  .log-cite a:hover { color: #4fc3f7; text-decoration: underline; }
  .log-error td { background: #e9456010; }
  .log-error .log-msg { color: #e94560; }
  .log-warn td { background: #f0a50010; }
  .log-warn .log-msg { color: #f0a500; }
  .raw-logs-section { max-width: 1200px; margin: 20px auto 0; }
  .raw-log-block { background: #16213e; border-radius: 8px; margin-bottom: 8px; border: 1px solid #333; }
  .raw-log-block summary { padding: 10px 14px; cursor: pointer; color: #aaa; font-size: 0.85em; font-weight: 600; }
  .raw-log-block summary:hover { color: #ddd; }
  .raw-log-pre { padding: 10px; overflow-x: auto; font-size: 0.75em; line-height: 1.6; color: #aaa; max-height: 400px; overflow-y: auto; }
  .raw-line { display: block; }
  .raw-line:target { background: #f0a50020; color: #fff; }
  .raw-ln { display: inline-block; width: 45px; text-align: right; padding-right: 10px; color: #555; user-select: none; }
  .raw-trunc { padding: 6px 14px; font-size: 0.75em; color: #888; border-top: 1px solid #333; }
  @media (max-width: 768px) { .container { flex-direction: column; } .video-panel { flex: none; position: static; } .video-panel video { max-width: 100%; } body { padding: 12px; } .step-screenshot { max-width: 100%; } }
</style>
</head>
<body>
<div class="header">
  <h1>${escHtml(run.flow)}</h1>
  <div class="meta">mode: ${escHtml(run.mode)} &middot; ${run.steps.length} steps${durationStr ? ` &middot; ${durationStr}` : ''}</div>
  <span class="badge ${resultClass}">${resultLabel}</span>
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
${renderLogTimeline()}
<div class="footer">Generated by flow-walker v${PKG_VERSION} &middot; <a href="https://github.com/beastoin/flow-walker" style="color:#666">github.com/beastoin/flow-walker</a></div>
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
