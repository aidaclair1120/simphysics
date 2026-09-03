import type { TerminalId, TerminalRef } from "../../ecs/types.js";
import type { Terminal } from "../Terminal.js";

export interface TerminalRefPair {
  a: TerminalRef;
  b: TerminalRef;
}

export interface Electrical {
  terminals: Map<TerminalId, Terminal>;
  internalLinks: TerminalRefPair[];
}
