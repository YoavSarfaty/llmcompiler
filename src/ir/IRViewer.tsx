import type { InstructionRef } from "../compiler/irSpans.ts";
import type { ResolvedMapping } from "../compiler/mappingResolver.ts";

interface Props {
  ir: string | null;
  instructions: InstructionRef[];
  mappings: ResolvedMapping[];
  selectedIds: ReadonlySet<string>;
  onHoverInstruction: (instructionId: string | null) => void;
  onPinInstruction: (instructionId: string) => void;
}

/**
 * Read-only LLVM IR view.
 *
 * The IR is never editable (R9). Line numbers are display-only: mapping
 * identities are application-owned and survive regeneration.
 */
export function IRViewer({
  ir,
  instructions,
  mappings,
  selectedIds,
  onHoverInstruction,
  onPinInstruction,
}: Props) {
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
  const mappedIds = new Set(mappings.flatMap((mapping) => mapping.instructionIds));
  const lowConfidenceIds = new Set(
    mappings.filter((mapping) => mapping.confidence === "low").flatMap((mapping) => mapping.instructionIds),
  );
  for (const instruction of instructions) {
    idByLine.set(instruction.line, instruction.id);
  }

  return (
    <div
      className="ir-view"
      role="region"
      aria-label="Generated LLVM IR, read only"
      onMouseLeave={() => onHoverInstruction(null)}
    >
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const id = idByLine.get(lineNumber);
        const selected = id !== undefined && selectedIds.has(id);
        const rowClasses = ["ir-row"];
        if (selected) rowClasses.push("selected");
        if (id && !mappedIds.has(id)) rowClasses.push("unmapped");
        if (id && lowConfidenceIds.has(id)) rowClasses.push("low-confidence");
        return (
          <div
            key={lineNumber}
            className={rowClasses.join(" ")}
            role={id ? "button" : undefined}
            tabIndex={id ? 0 : undefined}
            aria-label={id ? `Instruction ${id}${lowConfidenceIds.has(id) ? ", low-confidence mapping" : ""}` : undefined}
            onMouseEnter={() => onHoverInstruction(id ?? null)}
            onClick={() => {
              if (id) onPinInstruction(id);
            }}
            onKeyDown={(event) => {
              if (id && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPinInstruction(id);
              }
            }}
          >
            <span className="ir-lineno">{lineNumber}</span>
            <span className="ir-text">{line === "" ? "\u00a0" : line}</span>
          </div>
        );
      })}
    </div>
  );
}
