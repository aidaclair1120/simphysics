import type { ComponentType, EntityId, TerminalId, TerminalRef } from "./types.js";
import type { Terminal } from "../electrical/Terminal.js";
import type { Electrical } from "../electrical/components/Electrical.js";

export interface WorldSnapshot {
  nextEntityId: number;
  components: Map<ComponentType, Map<EntityId, unknown>>;
}

export class World {
  private nextEntityId = 1;
  private readonly components = new Map<ComponentType, Map<EntityId, unknown>>();

  createEntity(): EntityId {
    return this.nextEntityId++;
  }

  destroyEntity(entityId: EntityId): void {
    // Remove this entity from every terminal connection before deleting its
    // components. Connections are part of the ECS electrical state, so they
    // must never be left dangling after an entity is destroyed.
    for (const otherEntityId of this.getEntitiesWith("Electrical")) {
      const electrical = this.getComponent<Electrical>(otherEntityId, "Electrical");
      for (const terminal of electrical.terminals.values()) {
        terminal.connections = terminal.connections.filter(c => c.entityId !== entityId);
      }
    }

    for (const store of this.components.values()) store.delete(entityId);
  }

  /** Capture a deep snapshot of the ECS state for editor undo/redo. */
  createSnapshot(): WorldSnapshot {
    return {
      nextEntityId: this.nextEntityId,
      components: structuredClone(this.components)
    };
  }

  /** Restore a previously captured ECS snapshot. */
  restoreSnapshot(snapshot: WorldSnapshot): void {
    this.nextEntityId = snapshot.nextEntityId;
    this.components.clear();

    for (const [type, store] of snapshot.components) {
      this.components.set(type, structuredClone(store));
    }
  }

  addComponent<T>(entityId: EntityId, type: ComponentType, component: T): void {
    let store = this.components.get(type);
    if (!store) {
      store = new Map<EntityId, unknown>();
      this.components.set(type, store);
    }
    store.set(entityId, component);
  }

  hasComponent(entityId: EntityId, type: ComponentType): boolean {
    return this.components.get(type)?.has(entityId) ?? false;
  }

  getComponent<T>(entityId: EntityId, type: ComponentType): T {
    const component = this.components.get(type)?.get(entityId);
    if (component === undefined) throw new Error(`Component '${type}' not found on entity ${entityId}`);
    return component as T;
  }

  getOptionalComponent<T>(entityId: EntityId, type: ComponentType): T | undefined {
    return this.components.get(type)?.get(entityId) as T | undefined;
  }

  getEntitiesWith(...types: ComponentType[]): EntityId[] {
    if (types.length === 0) return [];
    const first = this.components.get(types[0]);
    if (!first) return [];

    return [...first.keys()].filter(entityId =>
      types.every(type => this.components.get(type)?.has(entityId) ?? false)
    );
  }

  addTerminal(entityId: EntityId, terminal: Terminal): void {
    if (terminal.entityId !== entityId) throw new Error("Terminal owner mismatch");

    const electrical = this.getComponent<Electrical>(entityId, "Electrical");
    if (electrical.terminals.has(terminal.id)) {
      throw new Error(`Terminal '${terminal.id}' already exists on entity ${entityId}`);
    }
    electrical.terminals.set(terminal.id, terminal);
  }

  getTerminal(entityId: EntityId, terminalId: TerminalId): Terminal {
    const electrical = this.getComponent<Electrical>(entityId, "Electrical");
    const terminal = electrical.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal '${terminalId}' not found on entity ${entityId}`);
    return terminal;
  }

  connect(a: TerminalRef, b: TerminalRef): void {
    if (this.sameTerminal(a, b)) throw new Error("A terminal cannot connect to itself");

    const terminalA = this.getTerminal(a.entityId, a.terminalId);
    const terminalB = this.getTerminal(b.entityId, b.terminalId);

    if (!this.hasConnection(terminalA, b)) terminalA.connections.push(b);
    if (!this.hasConnection(terminalB, a)) terminalB.connections.push(a);
  }

  disconnect(a: TerminalRef, b: TerminalRef): void {
    const terminalA = this.getTerminal(a.entityId, a.terminalId);
    const terminalB = this.getTerminal(b.entityId, b.terminalId);

    terminalA.connections = terminalA.connections.filter(c => !this.sameTerminal(c, b));
    terminalB.connections = terminalB.connections.filter(c => !this.sameTerminal(c, a));
  }

  addInternalLink(a: TerminalRef, b: TerminalRef): void {
    if (a.entityId !== b.entityId) throw new Error("Internal links must belong to one entity");

    const electrical = this.getComponent<Electrical>(a.entityId, "Electrical");
    this.getTerminal(a.entityId, a.terminalId);
    this.getTerminal(b.entityId, b.terminalId);

    const exists = electrical.internalLinks.some(link =>
      (this.sameTerminal(link.a, a) && this.sameTerminal(link.b, b)) ||
      (this.sameTerminal(link.a, b) && this.sameTerminal(link.b, a))
    );

    if (!exists) electrical.internalLinks.push({ a, b });
  }

  getDirectlyConnected(term: TerminalRef): TerminalRef[] {
    const terminal = this.getTerminal(term.entityId, term.terminalId);
    const electrical = this.getComponent<Electrical>(term.entityId, "Electrical");

    const refs = [...terminal.connections];

    for (const link of electrical.internalLinks) {
      if (this.sameTerminal(link.a, term)) refs.push(link.b);
      else if (this.sameTerminal(link.b, term)) refs.push(link.a);
    }

    const seen = new Set<string>();
    return refs.filter(ref => {
      const key = `${ref.entityId}:${ref.terminalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private hasConnection(terminal: Terminal, target: TerminalRef): boolean {
    return terminal.connections.some(c => this.sameTerminal(c, target));
  }

  private sameTerminal(a: TerminalRef, b: TerminalRef): boolean {
    return a.entityId === b.entityId && a.terminalId === b.terminalId;
  }
}
