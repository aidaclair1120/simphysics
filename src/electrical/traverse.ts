import type { TerminalRef } from "../ecs/types.js";
import type { World } from "../ecs/World.js";

export function traverse(world: World, start: TerminalRef): TerminalRef[] {
  const visited = new Set<string>();
  const queue: TerminalRef[] = [start];
  const result: TerminalRef[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.entityId}:${current.terminalId}`;
    if (visited.has(key)) continue;

    visited.add(key);
    result.push(current);

    for (const next of world.getDirectlyConnected(current)) {
      const nextKey = `${next.entityId}:${next.terminalId}`;
      if (!visited.has(nextKey)) queue.push(next);
    }
  }

  return result;
}
