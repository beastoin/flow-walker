// Input validation for flow-walker
// "Agents hallucinate. Build like it." — validate all inputs before dispatch.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

/** Reject strings containing ASCII control characters (except \n and \t) */
export function rejectControlChars(str: string, fieldName: string): void {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(str)) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `${fieldName} contains invalid control characters`,
      `Remove ASCII control characters (\\n and \\t are allowed)`,
    );
  }
}

/** Reject path traversal attempts */
function rejectPathTraversal(path: string, fieldName: string): void {
  const normalized = resolve(path);
  if (path.includes('..')) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `${fieldName} contains path traversal (..)`,
      `Use an absolute path or a path relative to cwd without ..`,
    );
  }
}

/** Validate a YAML flow file path */
export function validateFlowPath(path: string): void {
  rejectControlChars(path, 'Flow path');
  rejectPathTraversal(path, 'Flow path');

  if (!path.endsWith('.yaml') && !path.endsWith('.yml')) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `Flow path must end in .yaml or .yml: ${path}`,
      `Provide a YAML flow file. Run: flow-walker schema run`,
    );
  }

  if (!existsSync(path)) {
    throw new FlowWalkerError(
      ErrorCodes.FILE_NOT_FOUND,
      `Flow file not found: ${path}`,
      `Check the path and try again. Run: ls ${path}`,
    );
  }
}

/** Validate an output directory path */
export function validateOutputDir(dir: string): void {
  rejectControlChars(dir, 'Output directory');
  rejectPathTraversal(dir, 'Output directory');
}

/** Validate a VM Service WebSocket URI */
export function validateUri(uri: string): void {
  rejectControlChars(uri, 'URI');

  if (!uri.startsWith('ws://') && !uri.startsWith('wss://')) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `URI must start with ws:// or wss://: ${uri}`,
      `Example: ws://127.0.0.1:38047/abc=/ws`,
    );
  }

  try {
    new URL(uri);
  } catch {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `Invalid URI format: ${uri}`,
      `Provide a valid WebSocket URI. Example: ws://127.0.0.1:38047/abc=/ws`,
    );
  }
}

/** Validate a bundle ID (reverse-domain format) */
export function validateBundleId(id: string): void {
  rejectControlChars(id, 'Bundle ID');

  if (!/^[a-zA-Z][a-zA-Z0-9._-]*(\.[a-zA-Z][a-zA-Z0-9._-]*)+$/.test(id)) {
    throw new FlowWalkerError(
      ErrorCodes.INVALID_INPUT,
      `Invalid bundle ID format: ${id}`,
      `Bundle ID must be reverse-domain format. Example: com.example.app`,
    );
  }
}

/** Validate a run directory exists and contains run.json */
export function validateRunDir(dir: string): void {
  rejectControlChars(dir, 'Run directory');
  rejectPathTraversal(dir, 'Run directory');

  if (!existsSync(dir)) {
    throw new FlowWalkerError(
      ErrorCodes.FILE_NOT_FOUND,
      `Run directory not found: ${dir}`,
      `Provide the output directory from a previous flow-walker run`,
    );
  }

  if (!existsSync(`${dir}/run.json`)) {
    throw new FlowWalkerError(
      ErrorCodes.FILE_NOT_FOUND,
      `run.json not found in ${dir}`,
      `Run a flow first: flow-walker run <flow.yaml> --output-dir ${dir}`,
    );
  }
}
