import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/ecs/World.js";
import { createBattery, createResistor, createWire } from "../src/electrical/factories.js";
import { traverse } from "../src/electrical/traverse.js";

const ref = (entityId: number, terminalId: string) => ({ entityId, terminalId });

test("bidirectional connections", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  const resistor = createResistor(world, 100);

  world.connect(ref(battery, "positive"), ref(resistor, "A"));

  assert.deepEqual(world.getTerminal(battery, "positive").connections, [ref(resistor, "A")]);
  assert.deepEqual(world.getTerminal(resistor, "A").connections, [ref(battery, "positive")]);
});

test("parallel-style junction can have multiple attachments", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  const r1 = createResistor(world, 100);
  const r2 = createResistor(world, 200);

  world.connect(ref(battery, "positive"), ref(r1, "A"));
  world.connect(ref(battery, "positive"), ref(r2, "A"));

  assert.equal(world.getTerminal(battery, "positive").connections.length, 2);
});

test("multi-terminal wire connects its internal terminals", () => {
  const world = new World();
  const wire = createWire(world, 4);

  assert.equal(traverse(world, ref(wire, "T0")).length, 4);
});

test("loops terminate safely", () => {
  const world = new World();
  const a = createWire(world);
  const b = createWire(world);
  const c = createWire(world);

  world.connect(ref(a, "T0"), ref(b, "T0"));
  world.connect(ref(b, "T1"), ref(c, "T0"));
  world.connect(ref(c, "T1"), ref(a, "T1"));

  assert.ok(traverse(world, ref(a, "T0")).length <= 6);
});

test("disconnect is bidirectional", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  const resistor = createResistor(world, 100);

  world.connect(ref(battery, "positive"), ref(resistor, "A"));
  world.disconnect(ref(battery, "positive"), ref(resistor, "A"));

  assert.equal(world.getTerminal(battery, "positive").connections.length, 0);
  assert.equal(world.getTerminal(resistor, "A").connections.length, 0);
});

test("component queries work", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  createResistor(world, 100);

  assert.equal(world.hasComponent(battery, "Battery"), true);
  assert.equal(world.getEntitiesWith("Electrical").length, 2);
});
