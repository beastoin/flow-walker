import { execFileSync, execSync } from 'node:child_process';
import type { SnapshotElement, ScreenSnapshot, AgentType } from './types.ts';
import { FlowWalkerError, ErrorCodes } from './errors.ts';

/** Package name for the app under test — used to bring app to foreground */
const DEFAULT_PACKAGE = 'com.friend.ios.dev';

/** Detect agent type from binary path */
export function detectAgentType(agentPath: string): AgentType {
  const name = agentPath.split('/').pop() || agentPath;
  return name.includes('agent-swift') ? 'swift' : 'flutter';
}

/**
 * Thin wrapper around agent-flutter and agent-swift CLIs.
 * All device interaction goes through this bridge.
 */
export class AgentBridge {
  private bin: string;
  private timeout: number;
  private agentType: AgentType;
  private lastUri?: string;
  private lastBundleId?: string;

  constructor(agentPath: string = 'agent-flutter', timeout: number = 30000, agentType?: AgentType) {
    this.bin = agentPath;
    this.timeout = timeout;
    this.agentType = agentType ?? detectAgentType(agentPath);
  }

  /** Get the agent type */
  getAgentType(): AgentType {
    return this.agentType;
  }

  /** Connect to an app by VM Service URI */
  connect(uri: string): void {
    this.lastUri = uri;
    this.exec(['connect', uri]);
  }

  /** Connect to an app by bundle ID */
  connectBundle(bundleId: string): void {
    this.lastBundleId = bundleId;
    this.exec(['connect', '--bundle-id', bundleId]);
  }

  /** Store URI for reconnection without connecting (for skip-connect mode) */
  setUri(uri: string): void {
    this.lastUri = uri;
  }

  /** Reconnect using auto-detect first, then last connection parameters */
  reconnect(): boolean {
    try {
      try { this.exec(['disconnect']); } catch { /* ignore */ }
      // Try auto-detect first (handles app restart with new VM Service port)
      try {
        const out = this.exec(['connect']);
        // Update lastUri from auto-detected connection
        const uriMatch = out.match(/Auto-detected:\s*(ws:\/\/\S+)/);
        if (uriMatch) this.lastUri = uriMatch[1];
        return true;
      } catch { /* auto-detect failed, fall back to stored URI */ }
      if (this.lastUri) {
        this.exec(['connect', this.lastUri]);
      } else if (this.lastBundleId) {
        this.exec(['connect', '--bundle-id', this.lastBundleId]);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Disconnect from the current app */
  disconnect(): void {
    this.exec(['disconnect']);
  }

  /** Take a snapshot of interactive elements, with auto-reconnect on failure */
  snapshot(): ScreenSnapshot {
    let raw: string;
    const checkHint = this.agentType === 'swift'
      ? 'Check app is running and accessible'
      : 'Check device connection: adb devices';
    try {
      raw = this.exec(['snapshot', '-i', '--json']);
    } catch {
      // Try reconnecting once
      if (!this.reconnect()) throw new FlowWalkerError(ErrorCodes.DEVICE_ERROR, 'Snapshot failed and reconnect failed', checkHint);
      raw = this.exec(['snapshot', '-i', '--json']);
    }
    const parsed = JSON.parse(raw);

    // Both agents return { elements: [...] } or an array directly
    const rawElements = Array.isArray(parsed) ? parsed : (parsed.elements || []);

    const elements: SnapshotElement[] = rawElements.map((el: Record<string, unknown>) => ({
      ref: String(el.ref || ''),
      type: String(el.type || ''),
      text: String(el.text || el.label || ''),
      flutterType: el.flutterType ? String(el.flutterType) : undefined,
      enabled: el.enabled !== false,
      bounds: el.bounds as SnapshotElement['bounds'],
    }));

    return { elements, raw };
  }

  /** Press an element by ref */
  press(ref: string): string {
    return this.exec(['press', ref, '--json']);
  }

  /** Scroll in a direction */
  scroll(direction: string): string {
    return this.exec(['scroll', direction]);
  }

  /** Fill text into an element by ref */
  fill(ref: string, text: string): string {
    return this.exec(['fill', ref, text]);
  }

  /** Press text on screen (UIAutomator for flutter, find+press for swift) */
  textPress(query: string): boolean {
    try {
      if (this.agentType === 'swift') {
        this.exec(['find', 'text', query, 'press']);
      } else {
        this.exec(['text', query, '--press']);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Fill text field by label (tap to focus + type value) */
  textFill(query: string, value: string): boolean {
    try {
      this.exec(['text', query, '--fill', value]);
      return true;
    } catch {
      return false;
    }
  }

  /** Fill currently focused text field (no text matching needed) */
  textFillFocused(value: string): boolean {
    try {
      this.exec(['text', '--fill', value, '--focused']);
      return true;
    } catch {
      return false;
    }
  }

  /** Execute raw ADB command — no-op for swift agent */
  adbExec(command: string): boolean {
    if (this.agentType === 'swift') return false;
    try {
      const adbArgs = this.adbDeviceArgs();
      const parts = command.split(/\s+/);
      execFileSync('adb', [...adbArgs, ...parts], {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Navigate back */
  back(): string {
    return this.exec(['back', '--json']);
  }

  /** Get all visible text from accessibility layer */
  text(): string[] {
    try {
      const raw = this.exec(['text', '--json']);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Check if specific text is visible on screen */
  textVisible(query: string): boolean {
    try {
      this.exec(['text', query]);
      return true;
    } catch {
      return false;
    }
  }

  /** Get connection status */
  status(): string {
    return this.exec(['status', '--json']);
  }

  /** Bring app to foreground */
  bringToForeground(packageName: string = DEFAULT_PACKAGE): boolean {
    try {
      if (this.agentType === 'swift') {
        execSync(`open -b "${packageName}"`, { encoding: 'utf8', timeout: 5000 });
      } else {
        const adbArgs = this.adbDeviceArgs();
        execFileSync('adb', [
          ...adbArgs, 'shell', 'am', 'start', '-n',
          `${packageName}/${packageName.replace('.dev', '')}.MainActivity`,
        ], { encoding: 'utf8', timeout: 5000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the current foreground app matches our package */
  isAppInForeground(packageName: string = DEFAULT_PACKAGE): boolean {
    try {
      if (this.agentType === 'swift') {
        const result = execSync(
          `osascript -e 'tell application "System Events" to get bundle identifier of first process whose frontmost is true'`,
          { encoding: 'utf8', timeout: 5000 },
        );
        return result.trim() === packageName;
      }
      const adbArgs = this.adbDeviceArgs().join(' ');
      const result = execSync(
        `adb ${adbArgs} shell "dumpsys window displays | grep mCurrentFocus"`,
        { encoding: 'utf8', timeout: 5000 },
      );
      // mCurrentFocus=null means window transition — treat as in foreground
      if (result.includes('null')) return true;
      return result.includes(packageName);
    } catch {
      // If the check fails, assume in foreground to avoid false negatives
      return true;
    }
  }

  /** Get ADB device args from AGENT_FLUTTER_DEVICE env var */
  private adbDeviceArgs(): string[] {
    const device = process.env.AGENT_FLUTTER_DEVICE;
    return device ? ['-s', device] : [];
  }

  private exec(args: string[]): string {
    const jsonEnv = this.agentType === 'swift'
      ? { AGENT_SWIFT_JSON: '1' }
      : { AGENT_FLUTTER_JSON: '1' };
    try {
      const result = execFileSync(this.bin, args, {
        encoding: 'utf8',
        timeout: this.timeout,
        env: { ...process.env, ...jsonEnv },
      });
      return result.trim();
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      const agentName = this.agentType === 'swift' ? 'agent-swift' : 'agent-flutter';
      throw new FlowWalkerError(
        ErrorCodes.COMMAND_FAILED,
        `${agentName} ${args[0]} failed: ${error.stderr || error.message}`,
        `Run: ${agentName} doctor`,
      );
    }
  }
}
