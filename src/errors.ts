// Structured error handling for flow-walker
// Every error has: code, message, hint, diagnosticId

import { randomUUID } from 'node:crypto';

export const ErrorCodes = {
  INVALID_ARGS: 'INVALID_ARGS',
  INVALID_INPUT: 'INVALID_INPUT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FLOW_PARSE_ERROR: 'FLOW_PARSE_ERROR',
  STEP_FAILED: 'STEP_FAILED',
  DEVICE_ERROR: 'DEVICE_ERROR',
  COMMAND_FAILED: 'COMMAND_FAILED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class FlowWalkerError extends Error {
  code: ErrorCode;
  hint?: string;
  diagnosticId: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'FlowWalkerError';
    this.code = code;
    this.hint = hint;
    this.diagnosticId = randomUUID().slice(0, 8);
  }

  toJSON(): { error: { code: string; message: string; hint?: string; diagnosticId: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        diagnosticId: this.diagnosticId,
      },
    };
  }
}

/** Format any error as structured output */
export function formatError(err: unknown, json: boolean): string {
  if (err instanceof FlowWalkerError) {
    if (json) {
      return JSON.stringify(err.toJSON());
    }
    const parts = [`Error [${err.code}:${err.diagnosticId}]: ${err.message}`];
    if (err.hint) parts.push(`Hint: ${err.hint}`);
    return parts.join('\n');
  }

  // Wrap unknown errors
  const wrapped = new FlowWalkerError(
    ErrorCodes.COMMAND_FAILED,
    String(err),
  );
  if (json) {
    return JSON.stringify(wrapped.toJSON());
  }
  return `Error [${wrapped.code}:${wrapped.diagnosticId}]: ${wrapped.message}`;
}
