import type { WalkerConfig, SnapshotElement } from './types.ts';
import { computeFingerprint, deriveScreenName } from './fingerprint.ts';
import { filterSafe } from './safety.ts';
import { NavigationGraph } from './graph.ts';
import { generateFlows, writeFlows } from './yaml-writer.ts';
import { AgentBridge } from './agent-bridge.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface WalkResult {
  screensFound: number;
  flowsGenerated: number;
  elementsSkipped: number;
  flowFiles: string[];
}

/**
 * Recursive screen walker.
 * Connects to a Flutter app, explores screens by pressing interactive elements,
 * builds a navigation graph, and outputs YAML flow files.
 */
export async function walk(config: WalkerConfig): Promise<WalkResult> {
  const bridge = new AgentBridge(config.agentFlutterPath);
  const graph = new NavigationGraph();
  let totalSkipped = 0;

  // Connect (skip if using existing session)
  if (config.skipConnect) {
    log(config, `Using existing agent-flutter session...`);
    // Store URI for auto-reconnect even in skip-connect mode
    if (config.appUri) bridge.setUri(config.appUri);
  } else {
    log(config, `Connecting...`);
    if (config.appUri) {
      bridge.connect(config.appUri);
    } else if (config.bundleId) {
      bridge.connectBundle(config.bundleId);
    } else {
      throw new Error('Either --app-uri or --bundle-id is required');
    }
  }

  try {
    // Wait for app to stabilize before capturing home screen
    log(config, `Waiting for app to stabilize...`);
    await sleep(3000); // Initial wait for app to fully load
    let homeSnapshot = bridge.snapshot();
    let prevCount = homeSnapshot.elements.length;
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(1500);
      const freshSnapshot = bridge.snapshot();
      log(config, `  Snapshot: ${freshSnapshot.elements.length} elements (prev: ${prevCount})`);
      if (freshSnapshot.elements.length === prevCount && freshSnapshot.elements.length >= 5) break;
      prevCount = freshSnapshot.elements.length;
      homeSnapshot = freshSnapshot;
    }
    const homeFingerprint = computeFingerprint(homeSnapshot.elements);
    const homeName = deriveScreenName(homeSnapshot.elements);
    const homeTypes = homeSnapshot.elements.map(e => e.flutterType || e.type).sort();

    graph.addScreen(homeFingerprint, homeName, homeTypes, homeSnapshot.elements.length);
    log(config, `Home screen: ${homeName} (${homeFingerprint}) — ${homeSnapshot.elements.length} elements`);

    // Filter safe elements
    const [safeElements, skipped] = filterSafe(homeSnapshot.elements, config.blocklist);
    totalSkipped += skipped.length;

    for (const s of skipped) {
      log(config, `  SKIP ${s.element.ref} "${s.element.text}" — ${s.reason}`);
    }

    if (config.dryRun) {
      log(config, `\nDry run — listing elements without pressing:`);
      for (const el of safeElements) {
        log(config, `  SAFE ${el.ref} [${el.type}] "${el.text}"`);
      }
      for (const s of skipped) {
        log(config, `  BLOCKED ${s.element.ref} [${s.element.type}] "${s.element.text}" — ${s.reason}`);
      }
      log(config, `\nSummary: ${safeElements.length} safe, ${skipped.length} blocked`);
      return { screensFound: 1, flowsGenerated: 0, elementsSkipped: totalSkipped, flowFiles: [] };
    }

    // BFS walk: explore from home, always return to home between branches
    try {
      await walkBFS(
        bridge, graph, config,
        homeFingerprint, safeElements,
        { skipped: totalSkipped },
      );
    } catch (err) {
      log(config, `Walk interrupted: ${err}`);
    }

    // Always write results (even partial) so we capture what was discovered
    const flows = generateFlows(graph);
    const flowFiles = writeFlows(flows, config.outputDir);

    const graphPath = join(config.outputDir, '_nav-graph.json');
    writeFileSync(graphPath, JSON.stringify(graph.toJSON(), null, 2));
    flowFiles.push(graphPath);

    log(config, `\n=== Walk complete ===`);
    log(config, `Screens: ${graph.screenCount()}`);
    log(config, `Flows: ${flows.length}`);
    log(config, `Files: ${flowFiles.join(', ')}`);

    return {
      screensFound: graph.screenCount(),
      flowsGenerated: flows.length,
      elementsSkipped: totalSkipped,
      flowFiles,
    };
  } finally {
    try { bridge.disconnect(); } catch { /* ignore disconnect errors */ }
  }
}

/**
 * BFS walk from a root screen.
 * For each element: press it, record the transition, return to root.
 * Then for each discovered screen, navigate to it again and explore its children.
 * This avoids the fragile back-navigation issue by always returning to a known screen.
 */
async function walkBFS(
  bridge: AgentBridge,
  graph: NavigationGraph,
  config: WalkerConfig,
  rootFingerprint: string,
  rootElements: SnapshotElement[],
  counters: { skipped: number },
): Promise<void> {
  // Queue: [parentFingerprint, elementToPress, depth, pathFromRoot[]]
  // pathFromRoot stores type+text+bounds for each step — text is stable across rebuilds,
  // bounds is fallback when text is empty or ambiguous
  type PathStep = {
    type: string;
    text: string;
    boundsKey: string;
  };
  type QueueItem = {
    parentFingerprint: string;
    element: SnapshotElement;
    depth: number;
    pathFromRoot: PathStep[];
  };

  const queue: QueueItem[] = [];
  const rootElementCount = rootElements.length;
  // Track known root fingerprints (dynamic content causes fingerprint drift)
  const knownRootFingerprints = new Set<string>([rootFingerprint]);

  // Detect root screen's bottom nav "home tab" position.
  // Bottom nav elements are at y > 780 with small height.
  // The leftmost one is typically the "home" tab.
  const rootBottomNav = rootElements
    .filter(e => e.bounds && e.bounds.y > 780 && e.bounds.height < 100)
    .sort((a, b) => (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0));
  const homeTabBounds = rootBottomNav.length >= 3 ? rootBottomNav[0].bounds : undefined;

  // Seed queue with root screen elements
  for (const el of rootElements) {
    queue.push({
      parentFingerprint: rootFingerprint,
      element: el,
      depth: 0,
      pathFromRoot: [],
    });
  }

  // Track pressed elements per screen to avoid duplicates
  const pressedPerScreen = new Map<string, Set<string>>();
  pressedPerScreen.set(rootFingerprint, new Set());

  // Circuit breaker: abort if returnToRoot fails too many times in a row
  let consecutiveRootFailures = 0;
  const MAX_ROOT_FAILURES = 5;

  // Per-parent failure tracking: skip remaining children after N failures
  const parentFailCounts = new Map<string, number>();
  const MAX_PARENT_FAILURES = 3;
  // Screen mutation aliases: map original fingerprint → mutated fingerprints
  // (e.g., after a switch toggle changes the element count)
  const screenAliases = new Map<string, Set<string>>();

  async function safeReturnToRoot(): Promise<boolean> {
    const ok = await returnToRoot(bridge, config, rootFingerprint, rootElementCount, homeTabBounds, knownRootFingerprints);
    if (ok) {
      consecutiveRootFailures = 0;
      // Record any new root fingerprint variant
      try {
        const snap = bridge.snapshot();
        const fp = computeFingerprint(snap.elements);
        knownRootFingerprints.add(fp);
      } catch { /* ignore */ }
      return true;
    }

    // returnToRoot failed — try full app recovery with clean navigation stack.
    // This handles the case where back() exits the app (e.g., bottom nav tabs).
    log(config, `  returnToRoot failed — attempting clean app recovery`);
    try {
      bridge.bringToForeground();
      await sleep(5000);
      try { bridge.reconnect(); } catch { /* ignore */ }
      await sleep(2000);
      const snap = bridge.snapshot();
      const fp = computeFingerprint(snap.elements);
      if (fp === rootFingerprint || knownRootFingerprints.has(fp)) {
        consecutiveRootFailures = 0;
        knownRootFingerprints.add(fp);
        log(config, `  App recovery succeeded (${snap.elements.length} elements)`);
        return true;
      }
      log(config, `  App recovery: wrong screen (${snap.elements.length} elements, fp=${fp.slice(0,8)})`);
    } catch {
      log(config, `  App recovery failed`);
    }

    consecutiveRootFailures++;
    log(config, `  returnToRoot failed (${consecutiveRootFailures}/${MAX_ROOT_FAILURES})`);
    return false;
  }

  while (queue.length > 0) {
    if (consecutiveRootFailures >= MAX_ROOT_FAILURES) {
      log(config, `\nAborting: returnToRoot failed ${MAX_ROOT_FAILURES} times in a row`);
      break;
    }

    const item = queue.shift()!;
    const { parentFingerprint, element, depth, pathFromRoot } = item;

    if (depth >= config.maxDepth) continue;

    // Skip if this parent has been unreachable too many times
    if ((parentFailCounts.get(parentFingerprint) ?? 0) >= MAX_PARENT_FAILURES) continue;

    const boundsKey = element.bounds
      ? `${Math.round(element.bounds.x)},${Math.round(element.bounds.y)},${element.type}`
      : `${element.ref},${element.type}`;

    const pressed = pressedPerScreen.get(parentFingerprint)!;
    if (pressed.has(boundsKey)) continue;
    pressed.add(boundsKey);

    const indent = '  '.repeat(depth + 1);

    // Navigate to parent screen from root if not already there
    if (pathFromRoot.length > 0) {
      const navigated = await navigateToScreen(bridge, config, rootFingerprint, pathFromRoot);
      if (!navigated) {
        parentFailCounts.set(parentFingerprint, (parentFailCounts.get(parentFingerprint) ?? 0) + 1);
        log(config, `${indent}SKIP: could not navigate to parent screen (${parentFailCounts.get(parentFingerprint)}/${MAX_PARENT_FAILURES})`);
        continue;
      }
    }

    // Verify we're on the expected screen
    let currentSnapshot;
    try {
      currentSnapshot = bridge.snapshot();
    } catch {
      log(config, `${indent}SKIP: snapshot failed`);
      await safeReturnToRoot();
      continue;
    }

    const currentFingerprint = computeFingerprint(currentSnapshot.elements);
    // Successfully on target screen — reset failure counters
    if (currentFingerprint === parentFingerprint) {
      consecutiveRootFailures = 0;
      parentFailCounts.delete(parentFingerprint);
    }

    // Accept known root fingerprint variants (registered by safeReturnToRoot)
    const isKnownRoot = knownRootFingerprints.has(currentFingerprint);
    if (isKnownRoot && currentFingerprint !== parentFingerprint) {
      consecutiveRootFailures = 0;
    }

    // Check screen mutation aliases (e.g., switch toggle changed parent fingerprint)
    const isAlias = screenAliases.get(parentFingerprint)?.has(currentFingerprint) ?? false;

    if (currentFingerprint !== parentFingerprint && !isKnownRoot && !isAlias) {
      parentFailCounts.set(parentFingerprint, (parentFailCounts.get(parentFingerprint) ?? 0) + 1);
      log(config, `${indent}SKIP: on wrong screen (${currentFingerprint} != ${parentFingerprint}) (${parentFailCounts.get(parentFingerprint)}/${MAX_PARENT_FAILURES})`);
      await safeReturnToRoot();
      continue;
    }

    // Find the element in the fresh snapshot — try text+type first, then bounds
    let freshElement: SnapshotElement | undefined;
    if (element.text) {
      freshElement = currentSnapshot.elements.find(
        e => e.type === element.type && e.text === element.text,
      );
      // Disambiguate if multiple matches
      if (freshElement) {
        const sameTextEls = currentSnapshot.elements.filter(
          e => e.type === element.type && e.text === element.text,
        );
        if (sameTextEls.length > 1 && element.bounds) {
          freshElement = findByBounds(sameTextEls, {
            type: element.type,
            boundsKey: `${Math.round(element.bounds.x)},${Math.round(element.bounds.y)},${element.type}`,
          }) || freshElement;
        }
      }
    }
    if (!freshElement && element.bounds) {
      freshElement = findByBounds(currentSnapshot.elements, {
        type: element.type,
        boundsKey: `${Math.round(element.bounds.x)},${Math.round(element.bounds.y)},${element.type}`,
      });
    }

    if (!freshElement) {
      log(config, `${indent}SKIP: element not found in fresh snapshot`);
      await safeReturnToRoot();
      continue;
    }

    log(config, `${indent}Press ${freshElement.ref} [${freshElement.type}] "${freshElement.text}"`);

    try {
      bridge.press(freshElement.ref);
    } catch {
      log(config, `${indent}  FAILED to press, skipping`);
      await safeReturnToRoot();
      continue;
    }

    await sleep(1000);

    let newSnapshot;
    try {
      newSnapshot = bridge.snapshot();
    } catch {
      log(config, `${indent}  FAILED to snapshot after press`);
      await safeReturnToRoot();
      continue;
    }

    const newFingerprint = computeFingerprint(newSnapshot.elements);

    if (newFingerprint === parentFingerprint
      || (screenAliases.get(parentFingerprint)?.has(newFingerprint))) {
      log(config, `${indent}  Same screen — no-op`);
      // No need to return to root if on root, or already on parent
      if (parentFingerprint !== rootFingerprint) {
        await safeReturnToRoot();
      }
      continue;
    }

    // Detect screen mutation: pressing a toggle/switch changes the parent screen's
    // fingerprint slightly. If element count is close (±3) and the pressed element
    // was a switch/toggle type, register as an alias instead of a new screen.
    const isMutation = (
      freshElement.type === 'switch'
      || freshElement.flutterType === 'Switch'
      || freshElement.type === 'checkbox'
      || freshElement.flutterType === 'Checkbox'
    ) && Math.abs(newSnapshot.elements.length - currentSnapshot.elements.length) <= 3;

    if (isMutation) {
      log(config, `${indent}  Screen mutation (${freshElement.type} toggled): ${parentFingerprint.slice(0,8)} → ${newFingerprint.slice(0,8)}`);
      if (!screenAliases.has(parentFingerprint)) screenAliases.set(parentFingerprint, new Set());
      screenAliases.get(parentFingerprint)!.add(newFingerprint);
      // Don't queue children — it's the same screen in a different state
      if (parentFingerprint !== rootFingerprint) {
        await safeReturnToRoot();
      }
      continue;
    }

    // New screen discovered
    const newName = deriveScreenName(newSnapshot.elements);
    const newTypes = newSnapshot.elements.map(e => e.flutterType || e.type).sort();
    graph.addScreen(newFingerprint, newName, newTypes, newSnapshot.elements.length);
    graph.addEdge(parentFingerprint, newFingerprint, {
      ref: freshElement.ref,
      type: freshElement.type,
      text: freshElement.text,
    });

    log(config, `${indent}  → ${newName} (${newFingerprint}) — ${newSnapshot.elements.length} elements`);

    // Queue children for exploration if not visited too much
    if (graph.visitCount(newFingerprint) <= 1 && depth + 1 < config.maxDepth) {
      const [safeChildren, skippedChildren] = filterSafe(newSnapshot.elements, config.blocklist);
      counters.skipped += skippedChildren.length;

      if (!pressedPerScreen.has(newFingerprint)) {
        pressedPerScreen.set(newFingerprint, new Set());
      }

      const newPath: PathStep[] = [...pathFromRoot, {
        type: freshElement.type,
        text: freshElement.text,
        boundsKey,
      }];
      for (const child of safeChildren) {
        queue.push({
          parentFingerprint: newFingerprint,
          element: child,
          depth: depth + 1,
          pathFromRoot: newPath,
        });
      }
    }

    // Return to root
    await returnToRoot(bridge, config, rootFingerprint, rootElementCount, homeTabBounds, knownRootFingerprints);
  }
}

/**
 * Navigate from root to a target screen by replaying a path of element presses.
 * Uses text+type matching first (stable across widget rebuilds), bounds as fallback.
 */
async function navigateToScreen(
  bridge: AgentBridge,
  config: WalkerConfig,
  rootFingerprint: string,
  path: { type: string; text: string; boundsKey: string }[],
): Promise<boolean> {
  for (let stepIdx = 0; stepIdx < path.length; stepIdx++) {
    const step = path[stepIdx];
    let snapshot;
    try {
      snapshot = bridge.snapshot();
    } catch {
      return false;
    }

    // Strategy 1: Match by type + exact text (most stable across rebuilds)
    let el: SnapshotElement | undefined;
    if (step.text) {
      el = snapshot.elements.find(e => e.type === step.type && e.text === step.text);
      // If multiple matches by text, disambiguate by bounds proximity
      if (el && step.boundsKey) {
        const sameTextEls = snapshot.elements.filter(
          e => e.type === step.type && e.text === step.text,
        );
        if (sameTextEls.length > 1) {
          el = findByBounds(sameTextEls, step) || el;
        }
      }
    }

    // Strategy 2: Match by bounds (fallback for elements without text)
    if (!el) {
      el = findByBounds(snapshot.elements, step);
    }

    if (!el) {
      log(config, `  NAV step ${stepIdx}: element not found (${step.type} "${step.text}")`);
      return false;
    }

    try {
      bridge.press(el.ref);
    } catch {
      return false;
    }

    await sleep(1000);
  }
  return true;
}

/** Find element by bounds proximity (±5px tolerance) and type match */
function findByBounds(
  elements: SnapshotElement[],
  step: { type: string; boundsKey: string },
): SnapshotElement | undefined {
  const [xStr, yStr] = step.boundsKey.split(',');
  const targetX = parseInt(xStr, 10);
  const targetY = parseInt(yStr, 10);
  if (isNaN(targetX) || isNaN(targetY)) return undefined;

  // Try exact match first (±3px), then wider tolerances
  for (const tolerance of [3, 8, 15]) {
    const match = elements.find(e =>
      e.bounds
      && Math.abs(Math.round(e.bounds.x) - targetX) <= tolerance
      && Math.abs(Math.round(e.bounds.y) - targetY) <= tolerance
      && e.type === step.type,
    );
    if (match) return match;
  }
  return undefined;
}

/**
 * Return to root screen by pressing back repeatedly.
 * Limit attempts to avoid exiting the app entirely.
 * Uses rootElementCount to detect "close enough" instead of a hardcoded threshold.
 */
async function returnToRoot(
  bridge: AgentBridge,
  config: WalkerConfig,
  rootFingerprint: string,
  rootElementCount: number = 0,
  homeTabBounds?: { x: number; y: number; width: number; height: number },
  knownRootFingerprints?: Set<string>,
): Promise<boolean> {
  let lowElementStreak = 0; // Track consecutive low-element snapshots
  let triedBottomNav = false; // Only try bottom nav once per returnToRoot call
  // Max 5 back presses — any more and we risk exiting the app
  for (let i = 0; i < 5; i++) {
    let snapshot;
    try {
      snapshot = bridge.snapshot();
    } catch {
      // Snapshot failed — app may have exited. Try recovery:
      // bringToForeground → wait → reconnect → snapshot
      log(config, `  Snapshot failed — attempting app recovery`);
      bridge.bringToForeground();
      await sleep(3000);
      try { bridge.reconnect(); } catch { /* ignore */ }
      await sleep(2000);
      try {
        snapshot = bridge.snapshot();
      } catch {
        return false;
      }
    }

    const fp = computeFingerprint(snapshot.elements);
    if (fp === rootFingerprint) return true;
    // Accept known root fingerprint variants
    if (knownRootFingerprints?.has(fp)) {
      log(config, `  Accepted known root variant (${snapshot.elements.length} elements)`);
      return true;
    }

    // If element count dropped very low, might be a dialog/overlay or exited app
    if (snapshot.elements.length < 3) {
      lowElementStreak++;
      log(config, `  Very few elements (${snapshot.elements.length}) — attempt ${lowElementStreak}`);

      // First attempt: try back() to dismiss overlay/dialog
      if (lowElementStreak === 1) {
        try {
          bridge.back();
          await sleep(1500);
          const check = bridge.snapshot();
          if (check.elements.length >= 5) {
            lowElementStreak = 0;
            continue; // Overlay dismissed, re-check from top of loop
          }
        } catch { /* ignore */ }
      }

      // Second attempt: clean relaunch with cleared navigation stack
      if (lowElementStreak >= 2) {
        log(config, `  Attempting clean app relaunch`);
        try {
          // Use --activity-clear-task to reset navigation to root
          bridge.bringToForeground();
          await sleep(5000); // Give app time to fully load and navigate to home
          // Reconnect in case isolate changed
          try { bridge.reconnect(); } catch { /* ignore */ }
          await sleep(2000);
          const verify = bridge.snapshot();
          if (verify.elements.length >= 10) {
            log(config, `  Clean relaunch recovered (${verify.elements.length} elements)`);
            lowElementStreak = 0;
            continue;
          }
          log(config, `  Clean relaunch didn't recover (${verify.elements.length} elements)`);
        } catch {
          log(config, `  Clean relaunch failed`);
        }
        return false;
      }

      continue;
    }

    lowElementStreak = 0;

    // If this screen has bottom nav and we know the home tab position,
    // try pressing the home tab instead of back() (back() on bottom nav exits the app).
    // Only try once per returnToRoot call — if it doesn't work, fall through to back().
    if (!triedBottomNav && homeTabBounds && snapshot.elements.length >= 10) {
      const bottomNavEls = snapshot.elements.filter(
        e => e.bounds && e.bounds.y > 780 && e.bounds.height < 100,
      );
      if (bottomNavEls.length >= 3) {
        // Find element closest to root's home tab x position
        const targetX = homeTabBounds.x;
        const closest = bottomNavEls.reduce((best, el) =>
          Math.abs((el.bounds?.x ?? 999) - targetX) < Math.abs((best.bounds?.x ?? 999) - targetX)
            ? el : best,
        );
        if (closest.bounds && Math.abs(closest.bounds.x - targetX) < 20) {
          triedBottomNav = true;
          log(config, `  Pressing home tab (${closest.ref}) at x=${Math.round(closest.bounds.x)}`);
          try {
            bridge.press(closest.ref);
            await sleep(1500);
            continue;
          } catch { /* fall through to back() */ }
        }
      }
    }

    try {
      bridge.back();
    } catch {
      return false;
    }
    await sleep(1000);
  }

  // Check one final time
  try {
    const snapshot = bridge.snapshot();
    const finalFp = computeFingerprint(snapshot.elements);
    if (finalFp === rootFingerprint || knownRootFingerprints?.has(finalFp)) return true;
  } catch { /* ignore */ }

  return false;
}

function log(config: WalkerConfig, message: string): void {
  if (config.json) {
    console.log(JSON.stringify({ type: 'log', message }));
  } else {
    console.error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
