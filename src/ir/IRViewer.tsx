import type { InstructionRef } from "../compiler/irSpans.ts";

interface Props {
  ir: string | null;
  instructions: InstructionRef[];
  selectedIds: ReadonlySet<string>;
}

/**
 * Read-only LLVM IR view.
 *
 * The IR is never editable (R9). Line numbers are display-only: mapping
 * identities are application-owned and survive regeneration.
 */
export function IRViewer({ ir, instructions, selectedIds }: Props) {
  if (ir === null) {
    return (
      <div className="ir-empty">
        <p>No IR yet.</p>
        <p className="muted">Enter a program to compile it.</p>
      </div>
    );
  }

  const lines = ir.split("\n");
  const idByLine = new Map<number, string>();
  for (const instruction of instructions) {
    idByLine.set(instruction.line, instruction.id);
  }

  return (
    <div className="ir-view" role="region" aria-label="Generated LLVM IR, read only">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const id = idByLine.get(lineNumber);
        const selected = id !== undefined && selectedIds.has(id);
        return (
          <div key={lineNumber} className={selected ? "ir-row selected" : "ir-row"}>
            <span className="ir-lineno">{lineNumber}</span>
            <span className="ir-text">{line === "" ? "\u00a0" : line}</span>
          </div>
        );
      })}
    </div>
  );
}
