import type { EntityId, TerminalId, TerminalRef, Vector2 } from "../ecs/types.js";

export interface Terminal {
  id: TerminalId;
  entityId: EntityId;
  position: Vector2;
  connections: TerminalRef[];
}
