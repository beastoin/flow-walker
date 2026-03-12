import { execFileSync, execSync } from 'node:child_process';
import type { SnapshotElement, ScreenSnapshot } from './types.ts';

/** Package name for the app under test — used to bring app to foreground */
const DEFAULT_PACKAGE = 'com.friend.ios.dev';

/**
 * Thin wrapper around the agent-flutter CLI.
 * All device interaction goes through this bridge.
 */
export class AgentBridge {
  private bin: string;
  private timeout: number;
  private lastUri?: string;
  private lastBundleId?: string;

  constructor(agentFlutterPath: string = 'agent-flutter', timeout: number = 30000) {
    this.bin = agentFlutterPath;
    this.timeout = timeout;
  }

  /** Connect to a Flutter app by VM Service URI */
  connect(uri: string): void {
    this.lastUri = uri;
    this.exec(['connect', uri]);
  }

  /** Connect to a Flutter app by bundle ID */
  connectBundle(bundleId: string): void {
    this.lastBundleId = bundleId;
    this.exec(['connect', '--bundle-id', bundleId]);
  }

  /** Store URI for reconnection without connecting (for skip-connect mode) */
  setUri(uri: string): void {
    this.lastUri = uri;
  }

  /** Reconnect using the last connection parameters */
  reconnect(): boolean {
    try {
      try { this.exec(['disconnect']); } catch { /* ignore */ }
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
    try {
      raw = this.exec(['snapshot', '-i', '--json']);
    } catch {
      // Try reconnecting once
      if (!this.reconnect()) throw new Error('Snapshot failed and reconnect failed');
      raw = this.exec(['snapshot', '-i', '--json']);
    }
    const parsed = JSON.parse(raw);

    // agent-flutter returns { elements: [...] } or an array directly
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

  /** Navigate back */
  back(): string {
    return this.exec(['back', '--json']);
  }

  /** Get connection status */
  status(): string {
    return this.exec(['status', '--json']);
  }

  /** Bring app to foreground via ADB am start */
  bringToForeground(packageName: string = DEFAULT_PACKAGE): boolean {
    try {
      const adbArgs = this.adbDeviceArgs();
      execFileSync('adb', [
        ...adbArgs, 'shell', 'am', 'start', '-n',
        `${packageName}/${packageName.replace('.dev', '')}.MainActivity`,
      ], { encoding: 'utf8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the current foreground app matches our package */
  isAppInForeground(packageName: string = DEFAULT_PACKAGE): boolean {
    try {
      const adbArgs = this.adbDeviceArgs().join(' ');
      const result = execSync(
        `adb ${adbArgs} shell "dumpsys window displays | grep mCurrentFocus"`,
        { encoding: 'utf8', timeout: 5000 },
      );
      // mCurrentFocus=null means window transition — treat as in foreground
      if (result.includes('null')) return true;
      return result.includes(packageName);
    } catch {
      // If the grep/dumpsys fails, assume in foreground to avoid false negatives
      return true;
    }
  }

  /** Get ADB device args from AGENT_FLUTTER_DEVICE env var */
  private adbDeviceArgs(): string[] {
    const device = process.env.AGENT_FLUTTER_DEVICE;
    return device ? ['-s', device] : [];
  }

  private exec(args: string[]): string {
    try {
      const result = execFileSync(this.bin, args, {
        encoding: 'utf8',
        timeout: this.timeout,
        env: { ...process.env, AGENT_FLUTTER_JSON: '1' },
      });
      return result.trim();
    } catch (err: unknown) {
      const error = err as { stderr?: string; message?: string };
      throw new Error(
        `agent-flutter ${args[0]} failed: ${error.stderr || error.message}`,
      );
    }
  }
}
