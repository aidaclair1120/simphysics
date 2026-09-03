import type { EntityId, TerminalId, TerminalRef } from "../ecs/types.js";
import type { World } from "../ecs/World.js";
import type { Electrical } from "./components/Electrical.js";
import type { Battery } from "./components/Battery.js";
import type { Resistor } from "./components/Resistor.js";
import type { ElectricalState } from "./components/ElectricalState.js";

export interface ElectricalNode {
  id: number;
  terminals: TerminalRef[];
}

export interface ResistorAnalysis {
  entityId: EntityId;
  nodeA: number;
  nodeB: number;
  resistance: number;
  current: number;
  voltage: number;
  power: number;
}

export interface BatteryAnalysis {
  entityId: EntityId;
  positiveNode: number;
  negativeNode: number;
  voltage: number;
  current: number;
  power: number;
}

export interface DCSolution {
  solved: boolean;
  nodes: ElectricalNode[];
  nodeVoltages: Map<number, number>;
  resistors: ResistorAnalysis[];
  batteries: BatteryAnalysis[];
  error?: string;
}

interface UnionFind {
  find(key: string): string;
  union(a: string, b: string): void;
}

function makeUnionFind(): UnionFind {
  const parent = new Map<string, string>();

  function find(key: string): string {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    let current = key;
    while (parent.get(current)! !== current) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  }

  return { find, union };
}

function key(ref: TerminalRef): string {
  return `${ref.entityId}:${ref.terminalId}`;
}

function clearElectricalStates(world: World): void {
  // A circuit change can make the previous solution invalid. Keep the
  // derived ElectricalState components present, but reset them so the UI
  // never displays stale voltage/current/power from an earlier solution.
  for (const entityId of world.getEntitiesWith("ElectricalState")) {
    world.addComponent<ElectricalState>(entityId, "ElectricalState", {
      voltage: 0,
      current: 0,
      power: 0
    });
  }
}

export function deriveNodes(world: World): ElectricalNode[] {
  const uf = makeUnionFind();
  const allTerminals: TerminalRef[] = [];

  for (const entityId of world.getEntitiesWith("Electrical")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    for (const terminal of electrical.terminals.values()) {
      const ref = { entityId, terminalId: terminal.id };
      allTerminals.push(ref);
      uf.find(key(ref));
    }
  }

  // External connections.
  for (const entityId of world.getEntitiesWith("Electrical")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");

    for (const terminal of electrical.terminals.values()) {
      const from = { entityId, terminalId: terminal.id };
      for (const connection of terminal.connections) {
        uf.union(key(from), key(connection));
      }
    }

    // Internal ideal-conductive links, e.g. inside an ideal wire.
    for (const link of electrical.internalLinks) {
      uf.union(key(link.a), key(link.b));
    }
  }

  const groups = new Map<string, TerminalRef[]>();

  for (const terminal of allTerminals) {
    const root = uf.find(key(terminal));
    const group = groups.get(root) ?? [];
    group.push(terminal);
    groups.set(root, group);
  }

  return [...groups.values()].map((terminals, id) => ({ id, terminals }));
}

function nodeOf(nodes: ElectricalNode[], ref: TerminalRef): number {
  const found = nodes.find(node =>
    node.terminals.some(
      terminal =>
        terminal.entityId === ref.entityId &&
        terminal.terminalId === ref.terminalId
    )
  );

  if (!found) throw new Error(`No electrical node contains ${key(ref)}`);
  return found.id;
}

function gaussianSolve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }

    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];

    const pivotValue = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= pivotValue;

    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }

  return a.map(row => row[n]);
}

/**
 * First DC solver milestone:
 * ideal voltage sources + resistors + ideal conductive topology.
 *
 * The ECS remains authoritative. The node list and matrix are derived
 * representations used only for solving.
 */
export function solveDC(world: World): DCSolution {
  // Always clear derived results first. This is important when a previously
  // solved circuit is disconnected or an entity such as the original battery
  // is deleted and the new circuit can no longer be solved.
  clearElectricalStates(world);

  const nodes = deriveNodes(world);

  const resistors: Array<{
    entityId: EntityId;
    nodeA: number;
    nodeB: number;
    resistance: number;
  }> = [];

  for (const entityId of world.getEntitiesWith("Electrical", "Resistor")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    const resistor = world.getComponent<Resistor>(entityId, "Resistor");
    const terminals = [...electrical.terminals.values()];

    if (terminals.length !== 2) {
      return { solved: false, nodes, nodeVoltages: new Map(), resistors: [], batteries: [],
        error: `Resistor ${entityId} must have exactly two terminals.` };
    }

    if (!(resistor.resistance > 0)) {
      return { solved: false, nodes, nodeVoltages: new Map(), resistors: [], batteries: [],
        error: `Resistor ${entityId} must have positive resistance.` };
    }

    resistors.push({
      entityId,
      nodeA: nodeOf(nodes, { entityId, terminalId: terminals[0].id }),
      nodeB: nodeOf(nodes, { entityId, terminalId: terminals[1].id }),
      resistance: resistor.resistance
    });
  }

  const batteries: Array<{
    entityId: EntityId;
    positiveNode: number;
    negativeNode: number;
    voltage: number;
  }> = [];

  for (const entityId of world.getEntitiesWith("Electrical", "Battery")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    const battery = world.getComponent<Battery>(entityId, "Battery");
    const positive = electrical.terminals.get("positive");
    const negative = electrical.terminals.get("negative");

    if (!positive || !negative) {
      return { solved: false, nodes, nodeVoltages: new Map(), resistors: [], batteries: [],
        error: `Battery ${entityId} requires positive and negative terminals.` };
    }

    batteries.push({
      entityId,
      positiveNode: nodeOf(nodes, { entityId, terminalId: "positive" }),
      negativeNode: nodeOf(nodes, { entityId, terminalId: "negative" }),
      voltage: battery.voltage
    });
  }

  if (batteries.length === 0) {
    return { solved: false, nodes, nodeVoltages: new Map(), resistors: [], batteries: [],
      error: "No voltage source found." };
  }

  // Node 0 is the reference potential (ground).
  const ground = 0;
  const nonGroundNodes = nodes.map(n => n.id).filter(id => id !== ground);
  const nodeIndex = new Map<number, number>();
  nonGroundNodes.forEach((nodeId, i) => nodeIndex.set(nodeId, i));

  const sourceCount = batteries.length;
  const dimension = nonGroundNodes.length + sourceCount;
  const matrix = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0));
  const rhs = Array<number>(dimension).fill(0);

  const stampConductance = (a: number, b: number, g: number): void => {
    if (a !== ground) matrix[nodeIndex.get(a)!][nodeIndex.get(a)!] += g;
    if (b !== ground) matrix[nodeIndex.get(b)!][nodeIndex.get(b)!] += g;

    if (a !== ground && b !== ground) {
      const ia = nodeIndex.get(a)!;
      const ib = nodeIndex.get(b)!;
      matrix[ia][ib] -= g;
      matrix[ib][ia] -= g;
    }
  };

  for (const resistor of resistors) {
    if (resistor.nodeA !== resistor.nodeB) {
      stampConductance(resistor.nodeA, resistor.nodeB, 1 / resistor.resistance);
    }
  }

  batteries.forEach((battery, i) => {
    const row = nonGroundNodes.length + i;

    if (battery.positiveNode !== ground) {
      const p = nodeIndex.get(battery.positiveNode)!;
      matrix[p][row] += 1;
      matrix[row][p] += 1;
    }

    if (battery.negativeNode !== ground) {
      const n = nodeIndex.get(battery.negativeNode)!;
      matrix[n][row] -= 1;
      matrix[row][n] -= 1;
    }

    rhs[row] = battery.voltage;
  });

  const solution = gaussianSolve(matrix, rhs);

  if (!solution) {
    return {
      solved: false, nodes, nodeVoltages: new Map(), resistors: [], batteries: [],
      error: "Circuit could not be solved. Check connectivity and voltage-source topology."
    };
  }

  const nodeVoltages = new Map<number, number>();
  nodeVoltages.set(ground, 0);
  nonGroundNodes.forEach((nodeId, i) => nodeVoltages.set(nodeId, solution[i]));

  const resistorResults = resistors.map(resistor => {
    const va = nodeVoltages.get(resistor.nodeA) ?? 0;
    const vb = nodeVoltages.get(resistor.nodeB) ?? 0;
    const voltage = va - vb;
    const current = voltage / resistor.resistance;
    const power = voltage * current;

    return { ...resistor, voltage, current, power };
  });

  const batteryResults = batteries.map((battery, i) => {
    const current = solution[nonGroundNodes.length + i];
    return {
      ...battery,
      current,
      power: -battery.voltage * current
    };
  });

  // Derived state goes back into ECS components.
  for (const result of resistorResults) {
    world.addComponent<ElectricalState>(
      result.entityId,
      "ElectricalState",
      {
        voltage: result.voltage,
        current: result.current,
        power: result.power
      }
    );
  }

  for (const result of batteryResults) {
    world.addComponent<ElectricalState>(
      result.entityId,
      "ElectricalState",
      {
        voltage: result.voltage,
        current: result.current,
        power: result.power
      }
    );
  }

  return {
    solved: true,
    nodes,
    nodeVoltages,
    resistors: resistorResults,
    batteries: batteryResults
  };
}
