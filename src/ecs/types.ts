export type EntityId = number;
export type ComponentType = string;
export type TerminalId = string;

export interface TerminalRef {
  entityId: EntityId;
  terminalId: TerminalId;
}

export interface Vector2 {
  x: number;
  y: number;
}
