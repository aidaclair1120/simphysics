import type { EntityId } from "../ecs/types.js";
import type { World } from "../ecs/World.js";
import type { Terminal } from "./Terminal.js";
import type { Electrical } from "./components/Electrical.js";

function makeTerminal(entityId: EntityId, id: string, x: number): Terminal {
  return { id, entityId, position: { x, y: 0 }, connections: [] };
}

function addElectrical(world: World, entityId: EntityId): Electrical {
  const electrical: Electrical = { terminals: new Map(), internalLinks: [] };
  world.addComponent(entityId, "Electrical", electrical);
  return electrical;
}

export function createBattery(world: World, voltage: number): EntityId {
  const id = world.createEntity();
  addElectrical(world, id);
  world.addComponent(id, "Battery", { voltage });
  world.addTerminal(id, makeTerminal(id, "positive", -10));
  world.addTerminal(id, makeTerminal(id, "negative", 10));
  return id;
}

export function createResistor(world: World, resistance: number): EntityId {
  const id = world.createEntity();
  addElectrical(world, id);
  world.addComponent(id, "Resistor", { resistance });
  world.addTerminal(id, makeTerminal(id, "A", -10));
  world.addTerminal(id, makeTerminal(id, "B", 10));
  return id;
}

export function createWire(world: World, terminalCount = 2): EntityId {
  if (terminalCount < 2) throw new Error("A wire needs at least two terminals");

  const id = world.createEntity();
  addElectrical(world, id);
  world.addComponent(id, "Wire", { ideal: true });

  for (let i = 0; i < terminalCount; i++) {
    world.addTerminal(id, makeTerminal(id, `T${i}`, i * 20));
  }

  for (let i = 0; i < terminalCount - 1; i++) {
    world.addInternalLink(
      { entityId: id, terminalId: `T${i}` },
      { entityId: id, terminalId: `T${i + 1}` }
    );
  }

  return id;
}


export function createLamp(
  world: World,
  resistance = 60,
  nominalPower = 1
): EntityId {
  const id = world.createEntity();
  addElectrical(world, id);
  world.addComponent(id, "Lamp", { resistance, nominalPower });
  world.addComponent(id, "Resistor", { resistance });
  world.addTerminal(id, makeTerminal(id, "A", -10));
  world.addTerminal(id, makeTerminal(id, "B", 10));
  return id;
}
