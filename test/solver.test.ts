import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/ecs/World.js";
import { createBattery, createResistor, createWire } from "../src/electrical/factories.js";
import { deriveNodes, solveDC } from "../src/electrical/analysis.js";

const ref = (entityId: number, terminalId: string) => ({ entityId, terminalId });

function connectSeries(world: World, battery: number, resistor: number): void {
  const w1 = createWire(world);
  const w2 = createWire(world);
  world.connect(ref(battery, "positive"), ref(w1, "T0"));
  world.connect(ref(w1, "T1"), ref(resistor, "A"));
  world.connect(ref(resistor, "B"), ref(w2, "T0"));
  world.connect(ref(w2, "T1"), ref(battery, "negative"));
}

test("9 V across 100 ohms produces 0.09 A", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  const resistor = createResistor(world, 100);
  connectSeries(world, battery, resistor);

  const result = solveDC(world);

  assert.equal(result.solved, true);
  assert.equal(result.resistors.length, 1);
  assert.ok(Math.abs(result.resistors[0].current - 0.09) < 1e-10);
  assert.ok(Math.abs(result.resistors[0].voltage - 9) < 1e-10);
  assert.ok(Math.abs(result.resistors[0].power - 0.81) < 1e-10);
});

test("100 ohm and 200 ohm resistors in parallel share voltage", () => {
  const world = new World();
  const battery = createBattery(world, 9);
  const r1 = createResistor(world, 100);
  const r2 = createResistor(world, 200);
  const left = createWire(world, 3);
  const right = createWire(world, 3);

  world.connect(ref(battery, "positive"), ref(left, "T0"));
  world.connect(ref(left, "T1"), ref(r1, "A"));
  world.connect(ref(left, "T2"), ref(r2, "A"));

  world.connect(ref(r1, "B"), ref(right, "T0"));
  world.connect(ref(r2, "B"), ref(right, "T1"));
  world.connect(ref(right, "T2"), ref(battery, "negative"));

  const result = solveDC(world);
  assert.equal(result.solved, true);

  const byEntity = new Map(result.resistors.map(r => [r.entityId, r]));
  const a = byEntity.get(r1)!;
  const b = byEntity.get(r2)!;

  assert.ok(Math.abs(a.voltage - 9) < 1e-10);
  assert.ok(Math.abs(b.voltage - 9) < 1e-10);
  assert.ok(Math.abs(a.current - 0.09) < 1e-10);
  assert.ok(Math.abs(b.current - 0.045) < 1e-10);
});

test("an ideal four-terminal wire collapses to one electrical node", () => {
  const world = new World();
  const wire = createWire(world, 4);
  assert.equal(deriveNodes(world).length, 1);
});
