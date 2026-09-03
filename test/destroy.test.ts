import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/ecs/World.js";
import { createResistor, createWire } from "../src/electrical/factories.js";

const ref = (entityId: number, terminalId: string) => ({ entityId, terminalId });

test("destroying a wire removes its connections from neighbouring terminals", () => {
  const world = new World();
  const resistor = createResistor(world, 100);
  const wire = createWire(world);

  world.connect(ref(resistor, "A"), ref(wire, "T0"));
  assert.equal(world.getTerminal(resistor, "A").connections.length, 1);

  world.destroyEntity(wire);

  assert.equal(world.getTerminal(resistor, "A").connections.length, 0);
});
