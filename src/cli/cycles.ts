/**
 * Circular dependency detection via Tarjan's strongly-connected-components algorithm.
 * Returns the list of cycles (each cycle = array of node ids) and the set of
 * edge keys that participate in at least one cycle, so the renderer can
 * highlight them.
 */

export interface CycleInfo {
  /** Each cycle is a list of node ids: a -> b -> c -> a */
  cycles: string[][];
  /** Set of "from\0to" edge keys that are part of a cycle */
  cyclicEdgeKeys: Set<string>;
  /** Node ids that participate in at least one cycle */
  cyclicNodeIds: Set<string>;
}

export function findCircularDependencies(
  nodeIds: string[],
  edges: { from: string; to: string }[]
): CycleInfo {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from)!.push(e.to);
  }

  // Tarjan's SCC
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongconnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const v of nodeIds) {
    if (!indices.has(v)) strongconnect(v);
  }

  // Also treat self-loops as cycles (already excluded at edge build, but be safe)
  const cycles: string[][] = [];
  const cyclicNodeIds = new Set<string>();
  const cyclicEdgeKeys = new Set<string>();

  for (const scc of sccs) {
    for (const id of scc) cyclicNodeIds.add(id);
    // Build a representative cycle path within the SCC: order nodes by first edge found
    const sccSet = new Set(scc);
    // Find a cycle: start from first node, follow edges that stay within SCC
    const start: string = scc[0] ?? '';
    const path: string[] = [start];
    const visited = new Set<string>([start]);
    let cur: string = start;
    while (true) {
      const next: string | undefined = (adj.get(cur) || []).find(n => sccSet.has(n) && (!visited.has(n) || n === start));
      if (!next) break;
      if (next === start) break;
      path.push(next);
      visited.add(next);
      cur = next;
      if (path.length > scc.length) break; // safety
    }
    // Mark all edges within the SCC as cyclic
    for (const e of edges) {
      if (sccSet.has(e.from) && sccSet.has(e.to)) {
        cyclicEdgeKeys.add(e.from + '\0' + e.to);
      }
    }
    cycles.push(path);
  }

  return { cycles, cyclicEdgeKeys, cyclicNodeIds };
}
