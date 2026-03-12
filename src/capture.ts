// Screenshot, video, and logcat capture helpers

import { execSync, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const PIPE_STDIO: StdioOptions = ['pipe', 'pipe', 'pipe'];

function adbArgs(): string[] {
  const addr = process.env.ANDROID_ADB_SERVER_ADDRESS;
  const port = process.env.ANDROID_ADB_SERVER_PORT;
  const device = process.env.AGENT_FLUTTER_DEVICE;
  const args: string[] = [];
  if (addr) args.push('-H', addr);
  if (port) args.push('-P', port);
  if (device) args.push('-s', device);
  return args;
}

function adb(shellArgs: string[], timeout = 10000): string {
  const args = [...adbArgs(), ...shellArgs];
  return execSync(`adb ${args.join(' ')}`, {
    encoding: 'utf-8',
    timeout,
    stdio: PIPE_STDIO,
  }).trim();
}

/** Take a screenshot via ADB and pull to local path */
export function screenshot(localPath: string): boolean {
  try {
    const devicePath = '/sdcard/fw-screenshot.png';
    adb(['shell', 'screencap', '-p', devicePath]);
    adb(['pull', devicePath, localPath]);
    adb(['shell', 'rm', devicePath]);
    return true;
  } catch {
    return false;
  }
}

/** Start ADB screen recording. Returns handle to stop it later. */
export function startRecording(devicePath: string = '/sdcard/fw-recording.mp4'): {
  process: ChildProcess;
  devicePath: string;
} {
  const args = [...adbArgs(), 'shell', 'screenrecord', '--time-limit', '180', devicePath];
  const proc = spawn('adb', args, { stdio: 'ignore', detached: true });
  return { process: proc, devicePath };
}

/** Stop recording and pull video to local path */
export function stopRecording(
  handle: { process: ChildProcess; devicePath: string },
  localPath: string,
): boolean {
  try {
    // Send SIGINT to stop recording
    handle.process.kill('SIGINT');
    // Wait a moment for file to finalize
    execSync('sleep 2', { stdio: 'ignore' });
    adb(['pull', handle.devicePath, localPath], 30000);
    adb(['shell', 'rm', handle.devicePath]);
    return true;
  } catch {
    return false;
  }
}

/** Start logcat capture. Returns handle to stop it later. */
export function startLogcat(): { process: ChildProcess; lines: string[] } {
  const args = [...adbArgs(), 'logcat', '-v', 'time', '-s', 'flutter'];
  // Clear first
  try { adb(['logcat', '-c']); } catch { /* ignore */ }
  const proc = spawn('adb', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const lines: string[] = [];
  proc.stdout?.on('data', (data: Buffer) => {
    lines.push(...data.toString().split('\n').filter(Boolean));
  });
  return { process: proc, lines };
}

/** Stop logcat capture and return collected lines */
export function stopLogcat(handle: { process: ChildProcess; lines: string[] }): string[] {
  handle.process.kill('SIGTERM');
  return handle.lines;
}

/** Get device model name */
export function getDeviceName(): string {
  try {
    return adb(['shell', 'getprop', 'ro.product.model']);
  } catch {
    return process.env.AGENT_FLUTTER_DEVICE ?? 'unknown';
  }
}

/** Ensure output directory exists */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
