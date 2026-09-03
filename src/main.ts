import "./styles.css";

import { World } from "./ecs/World.js";
import type { WorldSnapshot } from "./ecs/World.js";
import { createBattery, createLamp, createResistor, createWire } from "./electrical/factories.js";
import { solveDC } from "./electrical/analysis.js";
import type { EntityId, TerminalRef, Vector2 } from "./ecs/types.js";
import type { Electrical } from "./electrical/components/Electrical.js";
import type { ElectricalState } from "./electrical/components/ElectricalState.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const world = new World();
const positions = new Map<EntityId, Vector2>();
let nextX = 120;

let selected: EntityId | null = null;
let draggingEntity = false;
let wiringFrom: TerminalRef | null = null;
let pointer: Vector2 = { x: 0, y: 0 };
let dragOffset: Vector2 = { x: 0, y: 0 };
let dragStartSnapshot: EditorSnapshot | null = null;
let dragMoved = false;
let lastSolution = solveDC(world);

interface EditorSnapshot {
  world: WorldSnapshot;
  positions: Map<EntityId, Vector2>;
  nextX: number;
}

const undoStack: EditorSnapshot[] = [];
const redoStack: EditorSnapshot[] = [];

const battery = createBattery(world, 9);
const resistor = createResistor(world, 100);
const lamp = createLamp(world, 60, 1);

positions.set(battery, { x: 110, y: 210 });
positions.set(resistor, { x: 300, y: 210 });
positions.set(lamp, { x: 500, y: 210 });

// The initial circuit uses ordinary editable wire entities. They are not
// special or protected; free-play should allow every entity to be edited.
connectWithExistingWire(battery, "positive", resistor, "A");
connectWithExistingWire(resistor, "B", lamp, "A");
connectWithExistingWire(lamp, "B", battery, "negative");

undoStack.push(captureSnapshot());

app.innerHTML = `
  <main class="shell">
    <header>
      <div>
        <div class="eyebrow">SIM HSC PHYSICS</div>
        <h1>Electrical Minigame</h1>
        <p>Phase 1: ECS topology + DC solver + interactive wiring.</p>
      </div>
      <div class="status">ENGINE ONLINE</div>
    </header>

    <section class="panel">
      <div class="toolbar">
        <button id="undo" disabled>Undo</button>
        <button id="redo" disabled>Redo</button>
        <button id="add-battery">Add battery</button>
        <button id="add-resistor">Add resistor</button>
        <button id="add-lamp">Add lamp</button>
        <button id="delete">Delete selected</button>
        <button id="reset">Reset</button>
        <span id="message">Drag components. Drag from a terminal to make a wire.</span>
      </div>
      <div class="help">
        <span><b>Move:</b> drag a component body</span>
        <span><b>Wire:</b> drag from a terminal to another terminal</span>
        <span><b>Reattach:</b> select a wire, then drag its endpoint to a terminal</span>
        <span><b>Delete:</b> select any object and press Delete or use the button</span>
        <span><b>Undo/Redo:</b> Ctrl+Z / Ctrl+Y</span>
        <span><b>Simulation:</b> updates automatically whenever the circuit changes</span>
      </div>
      <canvas id="canvas" width="820" height="470"></canvas>
    </section>

    <section class="panel">
      <h2>Live electrical analysis</h2>
      <div id="results"></div>
    </section>

    <section class="panel">
      <h2>ECS topology</h2>
      <pre id="topology"></pre>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d")!;
const results = document.querySelector<HTMLDivElement>("#results")!;
const topology = document.querySelector<HTMLPreElement>("#topology")!;
const message = document.querySelector<HTMLSpanElement>("#message")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo")!;
const deleteButton = document.querySelector<HTMLButtonElement>("#delete")!;

function ref(entityId: EntityId, terminalId: string): TerminalRef {
  return { entityId, terminalId };
}

function captureSnapshot(): EditorSnapshot {
  return {
    world: world.createSnapshot(),
    positions: new Map([...positions.entries()].map(([id, position]) => [id, { ...position }])),
    nextX
  };
}

function recordBeforeChange(): void {
  undoStack.push(captureSnapshot());
  redoStack.length = 0;
  updateHistoryButtons();
}

function restoreEditorSnapshot(snapshot: EditorSnapshot): void {
  world.restoreSnapshot(snapshot.world);

  positions.clear();
  for (const [entityId, position] of snapshot.positions) {
    positions.set(entityId, { ...position });
  }

  nextX = snapshot.nextX;
  selected = null;
  wiringFrom = null;
  draggingEntity = false;
  dragStartSnapshot = null;
  dragMoved = false;

  simulate();
}

function undo(): void {
  if (undoStack.length <= 1) return;

  const current = captureSnapshot();
  const previous = undoStack.pop()!;
  redoStack.push(current);
  restoreEditorSnapshot(previous);
  message.textContent = "Undid last change.";
  updateHistoryButtons();
}

function redo(): void {
  if (redoStack.length === 0) return;

  const current = captureSnapshot();
  const next = redoStack.pop()!;
  undoStack.push(current);
  restoreEditorSnapshot(next);
  message.textContent = "Redid last change.";
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  undoButton.disabled = undoStack.length <= 1;
  redoButton.disabled = redoStack.length === 0;
}

function simulate(): void {
  lastSolution = solveDC(world);
  renderSimulation();
}

function connectWithExistingWire(
  aEntity: EntityId,
  aTerminal: string,
  bEntity: EntityId,
  bTerminal: string
): EntityId {
  const wire = createWire(world);
  const start = terminalScreenPosition(aEntity, aTerminal);
  const end = terminalScreenPosition(bEntity, bTerminal);
  setWireTerminalPosition(wire, "T0", start);
  setWireTerminalPosition(wire, "T1", end);
  world.connect(ref(aEntity, aTerminal), ref(wire, "T0"));
  world.connect(ref(wire, "T1"), ref(bEntity, bTerminal));
  positions.set(wire, midpoint(start, end));
  return wire;
}

function createWireBetweenTerminals(start: TerminalRef, end: TerminalRef): void {
  if (sameTerminal(start, end)) {
    message.textContent = "A terminal cannot connect to itself.";
    return;
  }

  recordBeforeChange();

  const wire = createWire(world);

  const startPosition = terminalScreenPosition(start.entityId, start.terminalId);
  const endPosition = terminalScreenPosition(end.entityId, end.terminalId);

  setWireTerminalPosition(wire, "T0", startPosition);
  setWireTerminalPosition(wire, "T1", endPosition);
  positions.set(wire, midpoint(startPosition, endPosition));

  world.connect(start, ref(wire, "T0"));
  world.connect(ref(wire, "T1"), end);

  selected = wire;
  message.textContent = `Created wire entity ${wire}.`;
  simulate();
}

function reattachWireEndpoint(wireTerminal: TerminalRef, target: TerminalRef): void {
  if (sameTerminal(wireTerminal, target)) {
    message.textContent = "Cannot connect a wire endpoint to itself.";
    return;
  }

  recordBeforeChange();

  const endpoint = world.getTerminal(wireTerminal.entityId, wireTerminal.terminalId);

  for (const oldConnection of [...endpoint.connections]) {
    world.disconnect(wireTerminal, oldConnection);
  }

  const targetPosition = terminalScreenPosition(target.entityId, target.terminalId);
  setWireTerminalPosition(wireTerminal.entityId, wireTerminal.terminalId, targetPosition);
  world.connect(wireTerminal, target);
  updateWireMidpoint(wireTerminal.entityId);

  selected = wireTerminal.entityId;
  message.textContent = `Reattached wire ${wireTerminal.entityId}:${wireTerminal.terminalId} to ${target.entityId}:${target.terminalId}.`;
  simulate();
}

function setWireTerminalPosition(
  wireId: EntityId,
  terminalId: string,
  position: Vector2
): void {
  world.getTerminal(wireId, terminalId).position = { ...position };
}

function updateWireMidpoint(wireId: EntityId): void {
  const electrical = world.getComponent<Electrical>(wireId, "Electrical");
  const terminals = [...electrical.terminals.values()];
  if (terminals.length < 2) return;

  positions.set(wireId, midpoint(
    terminals[0].position,
    terminals[1].position
  ));
}

function syncConnectedWireEndpoints(movedEntityId: EntityId): void {
  const electrical = world.getComponent<Electrical>(movedEntityId, "Electrical");

  for (const terminal of electrical.terminals.values()) {
    const targetPosition = terminalScreenPosition(movedEntityId, terminal.id);

    for (const connection of [...terminal.connections]) {
      if (!world.hasComponent(connection.entityId, "Wire")) continue;
      setWireTerminalPosition(connection.entityId, connection.terminalId, targetPosition);
      updateWireMidpoint(connection.entityId);
    }
  }
}

function entityKind(entityId: EntityId): "battery" | "resistor" | "lamp" | "wire" | "unknown" {
  if (world.hasComponent(entityId, "Battery")) return "battery";
  if (world.hasComponent(entityId, "Lamp")) return "lamp";
  if (world.hasComponent(entityId, "Resistor")) return "resistor";
  if (world.hasComponent(entityId, "Wire")) return "wire";
  return "unknown";
}

function terminalScreenPosition(entityId: EntityId, terminalId: string): Vector2 {
  const entityPosition = positions.get(entityId);
  if (!entityPosition) throw new Error(`No position for entity ${entityId}`);

  const electrical = world.getComponent<Electrical>(entityId, "Electrical");
  const terminal = electrical.terminals.get(terminalId);
  if (!terminal) throw new Error(`Terminal ${entityId}:${terminalId} not found`);

  // Wire endpoint positions are absolute because they represent physical
  // endpoints that can be attached to other objects.
  if (entityKind(entityId) === "wire") return { ...terminal.position };

  return {
    x: entityPosition.x + terminal.position.x * 2.5,
    y: entityPosition.y + terminal.position.y
  };
}

function hitNonWireTerminal(point: Vector2): TerminalRef | null {
  let best: { ref: TerminalRef; distance: number } | null = null;

  for (const entityId of [...positions.keys()].reverse()) {
    if (entityKind(entityId) === "wire") continue;

    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    for (const terminal of electrical.terminals.values()) {
      const p = terminalScreenPosition(entityId, terminal.id);
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance <= 12 && (!best || distance < best.distance)) {
        best = { ref: ref(entityId, terminal.id), distance };
      }
    }
  }

  return best?.ref ?? null;
}

function hitWireEndpoint(entityId: EntityId, point: Vector2): string | null {
  const electrical = world.getComponent<Electrical>(entityId, "Electrical");
  let best: { id: string; distance: number } | null = null;

  for (const terminal of electrical.terminals.values()) {
    const p = terminalScreenPosition(entityId, terminal.id);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance <= 14 && (!best || distance < best.distance)) {
      best = { id: terminal.id, distance };
    }
  }

  return best?.id ?? null;
}

function hitEntity(point: Vector2): EntityId | null {
  const ids = [...positions.keys()].reverse();

  for (const entityId of ids) {
    if (entityKind(entityId) === "wire") {
      const electrical = world.getComponent<Electrical>(entityId, "Electrical");
      const terminals = [...electrical.terminals.values()];
      if (terminals.length >= 2) {
        const a = terminalScreenPosition(entityId, terminals[0].id);
        const b = terminalScreenPosition(entityId, terminals[1].id);
        if (distanceToSegment(point, a, b) <= 9) return entityId;
      }
      continue;
    }

    const p = positions.get(entityId)!;
    if (Math.hypot(point.x - p.x, point.y - p.y) <= 48) return entityId;
  }

  return null;
}

function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
  );
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function midpoint(a: Vector2, b: Vector2): Vector2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function canvasPoint(event: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

canvas.addEventListener("pointerdown", event => {
  pointer = canvasPoint(event);

  // Terminal hit-testing has priority over component bodies and wire lines.
  // If a wire is already selected, its endpoint has priority over the
  // underlying component terminal at the same physical location. This avoids
  // the common case where a wire endpoint and component terminal overlap.
  if (selected !== null && entityKind(selected) === "wire") {
    const endpoint = hitWireEndpoint(selected, pointer);
    if (endpoint) {
      wiringFrom = ref(selected, endpoint);
      canvas.setPointerCapture(event.pointerId);
      message.textContent = `Reattaching wire ${selected}:${endpoint}…`;
      redraw();
      return;
    }
  }

  // Otherwise prefer component terminals over overlapping wire endpoints.
  const terminal = hitNonWireTerminal(pointer);
  if (terminal) {
    wiringFrom = terminal;
    canvas.setPointerCapture(event.pointerId);
    message.textContent = `Wiring from ${terminal.entityId}:${terminal.terminalId}…`;
    redraw();
    return;
  }

  selected = hitEntity(pointer);
  if (selected !== null && entityKind(selected) !== "wire") {
    const p = positions.get(selected)!;
    dragOffset = { x: pointer.x - p.x, y: pointer.y - p.y };
    dragStartSnapshot = captureSnapshot();
    dragMoved = false;
    draggingEntity = true;
    canvas.setPointerCapture(event.pointerId);
    message.textContent = `Moving entity ${selected}`;
    updateDeleteButton();
    return;
  }

  if (selected !== null) {
    message.textContent = `Selected wire ${selected}`;
  } else {
    message.textContent = "Nothing selected.";
  }
  updateDeleteButton();
  redraw();
});

canvas.addEventListener("pointermove", event => {
  pointer = canvasPoint(event);

  if (wiringFrom) {
    redraw();
    return;
  }

  if (draggingEntity && selected !== null) {
    const nextPosition = {
      x: pointer.x - dragOffset.x,
      y: pointer.y - dragOffset.y
    };
    const currentPosition = positions.get(selected)!;
    if (nextPosition.x !== currentPosition.x || nextPosition.y !== currentPosition.y) {
      dragMoved = true;
    }

    positions.set(selected, nextPosition);

    // Connected wire endpoints follow the terminal they are attached to.
    syncConnectedWireEndpoints(selected);
    redraw();
  }
});

canvas.addEventListener("pointerup", event => {
  pointer = canvasPoint(event);

  if (wiringFrom) {
    const destination = hitNonWireTerminal(pointer);

    if (destination && !sameTerminal(wiringFrom, destination)) {
      if (entityKind(wiringFrom.entityId) === "wire") {
        reattachWireEndpoint(wiringFrom, destination);
      } else {
        createWireBetweenTerminals(wiringFrom, destination);
      }
    } else {
      message.textContent = "Connection cancelled.";
    }

    wiringFrom = null;
    redraw();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    return;
  }

  if (draggingEntity && dragMoved && dragStartSnapshot) {
    undoStack.push(dragStartSnapshot);
    redoStack.length = 0;
    updateHistoryButtons();
  }

  draggingEntity = false;
  dragStartSnapshot = null;
  dragMoved = false;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  updateDeleteButton();
  redraw();
});

canvas.addEventListener("contextmenu", event => event.preventDefault());

window.addEventListener("keydown", event => {
  if (event.key === "Delete") {
    event.preventDefault();
    deleteSelectedEntity();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
});

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
deleteButton.addEventListener("click", deleteSelectedEntity);

document.querySelector<HTMLButtonElement>("#add-battery")!.addEventListener("click", () => {
  recordBeforeChange();
  const entity = createBattery(world, 9);
  positions.set(entity, { x: nextX, y: 250 });
  nextX += 90;
  if (nextX > 740) nextX = 120;
  selected = entity;
  message.textContent = `Added battery entity ${entity}.`;
  updateDeleteButton();
  simulate();
});

document.querySelector<HTMLButtonElement>("#add-resistor")!.addEventListener("click", () => {
  recordBeforeChange();
  const entity = createResistor(world, 100);
  positions.set(entity, { x: nextX, y: 100 });
  nextX += 90;
  if (nextX > 740) nextX = 120;
  selected = entity;
  message.textContent = `Added resistor entity ${entity}.`;
  updateDeleteButton();
  simulate();
});

document.querySelector<HTMLButtonElement>("#add-lamp")!.addEventListener("click", () => {
  recordBeforeChange();
  const entity = createLamp(world, 60, 1);
  positions.set(entity, { x: nextX, y: 390 });
  nextX += 90;
  if (nextX > 740) nextX = 120;
  selected = entity;
  message.textContent = `Added lamp entity ${entity}.`;
  updateDeleteButton();
  simulate();
});

document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  location.reload();
});

function deleteSelectedEntity(): void {
  if (selected === null) {
    message.textContent = "Nothing selected.";
    return;
  }

  const entity = selected;

  if (!world.hasComponent(entity, "Electrical")) {
    message.textContent = "Selected object cannot be deleted.";
    return;
  }

  recordBeforeChange();
  world.destroyEntity(entity);
  positions.delete(entity);
  selected = null;
  wiringFrom = null;
  draggingEntity = false;
  dragStartSnapshot = null;
  dragMoved = false;
  message.textContent = `Deleted entity ${entity}.`;
  updateDeleteButton();
  simulate();
}

function updateDeleteButton(): void {
  deleteButton.disabled = selected === null || !world.hasComponent(selected, "Electrical");
}

function sameTerminal(a: TerminalRef, b: TerminalRef): boolean {
  return a.entityId === b.entityId && a.terminalId === b.terminalId;
}

function renderSimulation(): void {
  if (!lastSolution.solved) {
    results.innerHTML = `<p class="error">${lastSolution.error ?? "Unable to solve."}</p>`;
  } else {
    const rows = lastSolution.resistors.map(r => `
      <tr>
        <td>Entity ${r.entityId}</td>
        <td>${r.resistance.toFixed(2)} Ω</td>
        <td>${r.voltage.toFixed(3)} V</td>
        <td>${r.current.toFixed(3)} A</td>
        <td>${r.power.toFixed(3)} W</td>
      </tr>
    `).join("");

    results.innerHTML = `
      <p class="success">Circuit solved — ${lastSolution.nodes.length} electrical nodes.</p>
      <table>
        <thead><tr><th>Component</th><th>R</th><th>V</th><th>I</th><th>P</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  updateTopology();
  updateDeleteButton();
  updateHistoryButtons();
  redraw();
}

function updateTopology(): void {
  const lines: string[] = [];
  for (const entityId of world.getEntitiesWith("Electrical")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    for (const terminal of electrical.terminals.values()) {
      const targets = terminal.connections
        .map(connection => `${connection.entityId}:${connection.terminalId}`)
        .join(", ") || "—";
      lines.push(`${entityId}:${terminal.id} → ${targets}`);
    }
  }
  topology.textContent = lines.join("\n");
}

function drawTerminal(refValue: TerminalRef): void {
  const p = terminalScreenPosition(refValue.entityId, refValue.terminalId);
  const isStart = wiringFrom && sameTerminal(wiringFrom, refValue);

  ctx.beginPath();
  ctx.arc(p.x, p.y, isStart ? 10 : 8, 0, Math.PI * 2);
  ctx.fillStyle = isStart ? "#f59e0b" : "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawEntity(entityId: EntityId): void {
  const p = positions.get(entityId)!;
  const kind = entityKind(entityId);
  const isSelected = selected === entityId;

  ctx.strokeStyle = isSelected ? "#f59e0b" : "#334155";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = isSelected ? 4 : 2;

  if (kind === "wire") {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    const terminals = [...electrical.terminals.values()];
    if (terminals.length >= 2) {
      const first = terminalScreenPosition(entityId, terminals[0].id);
      const last = terminalScreenPosition(entityId, terminals[1].id);
      ctx.strokeStyle = isSelected ? "#f59e0b" : "#475569";
      ctx.lineWidth = isSelected ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`wire ${entityId}`, p.x, p.y - 12);
      terminals.forEach(t => drawTerminal(ref(entityId, t.id)));
    }
    return;
  }

  if (kind === "battery") {
    ctx.strokeRect(p.x - 30, p.y - 30, 60, 60);
    ctx.beginPath();
    ctx.moveTo(p.x - 7, p.y - 18); ctx.lineTo(p.x - 7, p.y + 18);
    ctx.moveTo(p.x + 7, p.y - 10); ctx.lineTo(p.x + 7, p.y + 10);
    ctx.stroke();
    const component = world.getComponent<{ voltage: number }>(entityId, "Battery");
    label(`🔋 ${component.voltage} V`, p.x, p.y + 50);
  } else if (kind === "resistor") {
    ctx.strokeRect(p.x - 38, p.y - 20, 76, 40);
    const component = world.getComponent<{ resistance: number }>(entityId, "Resistor");
    label(`[ ${component.resistance} Ω ]`, p.x, p.y + 43);
  } else if (kind === "lamp") {
    const component = world.getComponent<{ nominalPower: number }>(entityId, "Lamp");
    const state = world.getOptionalComponent<ElectricalState>(entityId, "ElectricalState");
    const power = state?.power ?? 0;
    const brightness = Math.max(0, Math.min(1, Math.abs(power) / component.nominalPower));
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 220, 40, ${0.10 + 0.85 * brightness})`;
    ctx.fill();
    label(`💡 ${Math.abs(power).toFixed(2)} W`, p.x, p.y + 48);
  }

  const electrical = world.getComponent<Electrical>(entityId, "Electrical");
  for (const terminal of electrical.terminals.values()) {
    drawTerminal(ref(entityId, terminal.id));
  }
}

function label(text: string, x: number, y: number): void {
  ctx.fillStyle = "#1f2937";
  ctx.font = "14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function redraw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw direct non-wire connections for completeness, then draw wire entities.
  for (const entityId of world.getEntitiesWith("Electrical")) {
    const electrical = world.getComponent<Electrical>(entityId, "Electrical");
    if (entityKind(entityId) === "wire") continue;

    for (const terminal of electrical.terminals.values()) {
      const from = terminalScreenPosition(entityId, terminal.id);
      for (const target of terminal.connections) {
        if (entityKind(target.entityId) === "wire") continue;
        if (target.entityId < entityId) continue;
        const to = terminalScreenPosition(target.entityId, target.terminalId);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
  }

  for (const entityId of world.getEntitiesWith("Wire")) drawEntity(entityId);

  if (wiringFrom) {
    const from = terminalScreenPosition(wiringFrom.entityId, wiringFrom.terminalId);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(pointer.x, pointer.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const entityId of positions.keys()) {
    if (entityKind(entityId) !== "wire") drawEntity(entityId);
  }
}

lastSolution = solveDC(world);
renderSimulation();
updateDeleteButton();
updateHistoryButtons();
redraw();
