import type { ScreenNode, ScreenEdge } from './types.ts';

/**
 * Directed navigation graph tracking screens and transitions.
 */
export class NavigationGraph {
  nodes: Map<string, ScreenNode> = new Map();
  edges: ScreenEdge[] = [];

  /** Add or update a screen node */
  addScreen(id: string, name: string, elementTypes: string[], elementCount: number): ScreenNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.visits += 1;
      return existing;
    }
    const node: ScreenNode = {
      id,
      name,
      elementTypes,
      elementCount,
      firstSeen: Date.now(),
      visits: 1,
    };
    this.nodes.set(id, node);
    return node;
  }

  /** Add an edge (transition) between two screens */
  addEdge(source: string, target: string, element: { ref: string; type: string; text: string }): void {
    // Avoid duplicate edges for same source→target via same element type+text
    const exists = this.edges.some(
      e => e.source === source && e.target === target &&
           e.element.type === element.type && e.element.text === element.text,
    );
    if (!exists) {
      this.edges.push({ source, target, element });
    }
  }

  /** Check if a screen has been visited */
  hasScreen(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Get visit count for a screen */
  visitCount(id: string): number {
    return this.nodes.get(id)?.visits ?? 0;
  }

  /** Get all edges from a source screen */
  edgesFrom(source: string): ScreenEdge[] {
    return this.edges.filter(e => e.source === source);
  }

  /** Get all edges to a target screen */
  edgesTo(target: string): ScreenEdge[] {
    return this.edges.filter(e => e.target === target);
  }

  /** Get unique screen count */
  screenCount(): number {
    return this.nodes.size;
  }

  /** Export graph as JSON-serializable object */
  toJSON(): { nodes: ScreenNode[]; edges: ScreenEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }
}
