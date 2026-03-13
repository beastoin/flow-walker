// Remote API: upload/retrieve reports and run data from flow-walker hosted service

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

const DEFAULT_API_URL = 'https://flow-walker.beastoin.workers.dev';

function resolveApiUrl(apiUrl?: string): string {
  return apiUrl || process.env.FLOW_WALKER_API_URL || DEFAULT_API_URL;
}

export interface PushResult {
  id: string;
  url: string;
  htmlUrl: string;
  expiresAt: string;
}

/** Upload a report to the hosted service */
export async function pushReport(
  runDir: string,
  options: { apiUrl?: string; runId?: string } = {},
): Promise<PushResult> {
  const apiUrl = resolveApiUrl(options.apiUrl);

  // Find report.html
  const reportPath = join(runDir, 'report.html');
  if (!existsSync(reportPath)) {
    throw new FlowWalkerError(
      ErrorCodes.FILE_NOT_FOUND,
      'report.html not found in run directory',
      'Generate it first: flow-walker report <run-dir>',
    );
  }

  // Read metadata from run.json if available
  let runId = options.runId;
  let flowName: string | undefined;
  let stepsTotal: number | undefined;
  let stepsPass: number | undefined;
  let duration: number | undefined;
  let appName: string | undefined;
  let appUrl: string | undefined;
  let runJsonContent: string | undefined;
  const runJsonPath = join(runDir, 'run.json');
  if (existsSync(runJsonPath)) {
    try {
      const raw = readFileSync(runJsonPath, 'utf-8');
      const runData = JSON.parse(raw);
      if (!runId) runId = runData.id;
      if (runData.flow) flowName = String(runData.flow);
      if (typeof runData.duration === 'number') duration = runData.duration;
      if (runData.app) appName = String(runData.app);
      if (runData.appUrl || runData.app_url) appUrl = String(runData.appUrl || runData.app_url);
      if (Array.isArray(runData.steps)) {
        stepsTotal = runData.steps.length;
        stepsPass = runData.steps.filter((s: { status?: string; outcome?: string }) => s.status === 'pass' || s.outcome === 'pass').length;
      }
      // Prepare run.json for upload — strip local file paths
      const uploadData = { ...runData };
      delete uploadData.video;
      delete uploadData.log;
      if (Array.isArray(uploadData.steps)) {
        uploadData.steps = uploadData.steps.map((s: Record<string, unknown>) => {
          const { screenshot: _s, ...rest } = s;
          return rest;
        });
      }
      runJsonContent = JSON.stringify(uploadData);
    } catch { /* ignore parse errors */ }
  }

  // Read report
  const reportContent = readFileSync(reportPath);

  // Upload report.html
  const headers: Record<string, string> = {
    'Content-Type': 'text/html',
    'Content-Length': String(reportContent.byteLength),
  };
  if (runId) headers['X-Run-ID'] = runId;
  if (flowName) headers['X-Flow-Name'] = flowName;
  if (stepsTotal !== undefined) headers['X-Steps-Total'] = String(stepsTotal);
  if (stepsPass !== undefined) headers['X-Steps-Pass'] = String(stepsPass);
  if (duration !== undefined) headers['X-Duration'] = String(duration);
  if (appName) headers['X-App-Name'] = appName;
  if (appUrl) headers['X-App-URL'] = appUrl;

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/runs`, {
      method: 'POST',
      headers,
      body: reportContent,
    });
  } catch (err) {
    throw new FlowWalkerError(
      ErrorCodes.COMMAND_FAILED,
      `Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
      `Check your network or set FLOW_WALKER_API_URL`,
    );
  }

  if (!response.ok) {
    let errorMsg = `Upload failed (HTTP ${response.status})`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body.error?.message) errorMsg = body.error.message;
    } catch { /* ignore */ }
    throw new FlowWalkerError(
      ErrorCodes.COMMAND_FAILED,
      errorMsg,
      'Try again or check FLOW_WALKER_API_URL',
    );
  }

  const result = await response.json() as PushResult;

  // Upload run.json (best-effort — don't fail push if this fails)
  if (runJsonContent && result.id) {
    try {
      await fetch(`${apiUrl}/runs/${result.id}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: runJsonContent,
      });
    } catch { /* best-effort */ }
  }

  return result;
}

/** Fetch run data from hosted service */
export async function getRunData(
  runId: string,
  options: { apiUrl?: string } = {},
): Promise<unknown> {
  const apiUrl = resolveApiUrl(options.apiUrl);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/runs/${runId}`, {
      headers: { 'Accept': 'application/json' },
    });
  } catch (err) {
    throw new FlowWalkerError(
      ErrorCodes.COMMAND_FAILED,
      `Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
      'Check your network or set FLOW_WALKER_API_URL',
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new FlowWalkerError(
        ErrorCodes.FILE_NOT_FOUND,
        `Run ${runId} not found`,
        'Check the run ID or push the run first: flow-walker push <run-dir>',
      );
    }
    throw new FlowWalkerError(
      ErrorCodes.COMMAND_FAILED,
      `Failed to fetch run (HTTP ${response.status})`,
      'Try again or check FLOW_WALKER_API_URL',
    );
  }

  return response.json();
}
