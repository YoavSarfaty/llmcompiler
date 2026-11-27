import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SourceEditor, type SourceHighlight } from "../editor/SourceEditor.tsx";
import { IRViewer } from "../ir/IRViewer.tsx";
import { MockLlmClient } from "../model/MockLlmClient.ts";
import { FIB_SOURCE } from "../model/fibFixture.ts";
import { Console } from "../console/Console.tsx";
import { runCompilation, type CompileOutput } from "../compiler/coordinator.ts";
import { LIMITS } from "../compiler/limits.ts";
import { TOOLCHAIN_STATUS } from "../toolchain/ToolchainAdapter.ts";
import { hasErrors, type Diagnostic } from "../types/diagnostics.ts";
import type { ReviewPayload } from "../types/protocol.ts";
import { createDiagnosticBundle } from "./diagnosticBundle.ts";

type Tone = "idle" | "busy" | "ok" | "warn" | "error";

function compileStatus(state: CompileOutput | null, busy: boolean): { label: string; tone: Tone } {
  if (busy) return { label: "Compiling", tone: "busy" };
  if (!state) return { label: "Ready", tone: "idle" };
  if (hasErrors(state.diagnostics)) return { label: "Compilation failed", tone: "error" };
  if (state.succeeded) return { label: "IR checks passed · LLVM unavailable", tone: "ok" };
  return { label: "Ready", tone: "idle" };
}

function reviewStatus(review: ReviewPayload | null): { label: string; tone: Tone } {
  if (!review) return { label: "Mock review: not run", tone: "warn" };
  if (review.verdict === "pass") return { label: "Mock review: pass", tone: "ok" };
  if (review.verdict === "fail") return { label: "Mock review: fail", tone: "error" };
  return { label: "Mock review: inconclusive", tone: "warn" };
}

function locationLabel(diagnostic: Diagnostic): string | null {
  if (diagnostic.irRanges && diagnostic.irRanges.length > 0) {
    const first = diagnostic.irRanges[0]!;
    return `IR line ${first.line}`;
  }
  if (diagnostic.sourceRanges && diagnostic.sourceRanges.length > 0) {
    return `source ${diagnostic.sourceRanges[0]!.from}..${diagnostic.sourceRanges[0]!.to}`;
  }
  return null;
}

export function App() {
  const client = useMemo(() => new MockLlmClient(), []);
  const [source, setSource] = useState(FIB_SOURCE);
  const [state, setState] = useState<CompileOutput | null>(null);
  const [lastSuccessfulState, setLastSuccessfulState] = useState<CompileOutput | null>(null);
  const [lastSuccessfulSource, setLastSuccessfulSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [hoverOffset, setHoverOffset] = useState<number | null>(null);
  const [hoveredInstructionId, setHoveredInstructionId] = useState<string | null>(null);
  const [pinnedLines, setPinnedLines] = useState<number[]>([]);
  const [pinnedInstructionIds, setPinnedInstructionIds] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<"diagnostics" | "console">("diagnostics");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [mobilePane, setMobilePane] = useState<"source" | "ir">("source");
  const [splitPercent, setSplitPercent] = useState(50);
  const requestCounter = useRef(0);

  useEffect(() => {
    const id = ++requestCounter.current;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void runCompilation({
        source,
        documentVersion: id,
        requestId: `req-${id}`,
        client,
      }).then((out) => {
        if (id !== requestCounter.current) return; // stale response
        setState(out);
        if (out.succeeded) {
          setLastSuccessfulState(out);
          setLastSuccessfulSource(source);
        }
        setBusy(false);
        setPinnedLines([]);
        setPinnedInstructionIds(new Set());
      });
    }, LIMITS.debounceMs);
    return () => window.clearTimeout(timer);
  }, [source, client]);

  const displayState = state?.succeeded ? state : lastSuccessfulState;
  const hasStaleIr = Boolean(displayState?.ir && (busy || source !== lastSuccessfulSource));

  const activeMappings = useMemo(() => {
    if (!displayState || hasStaleIr) return [];
    return displayState.mappings.filter((mapping) => {
      const sourceActive = mapping.sourceRanges.some((range) =>
        [cursorOffset, hoverOffset].some((offset) => offset !== null && offset >= range.from && offset < range.to),
      );
      const instructionActive = mapping.instructionIds.some(
        (id) => id === hoveredInstructionId || pinnedInstructionIds.has(id),
      );
      return sourceActive || instructionActive;
    });
  }, [displayState, hasStaleIr, cursorOffset, hoverOffset, hoveredInstructionId, pinnedInstructionIds]);

  const sourceHighlights = useMemo<SourceHighlight[]>(() => {
    if (!displayState || hasStaleIr) return [];
    const activeSemanticIds = new Set(activeMappings.map((mapping) => mapping.semanticId));
    return displayState.mappings.flatMap((mapping) =>
      mapping.sourceRanges.map((range) => ({
        range,
        confidence: mapping.confidence,
        active: activeSemanticIds.has(mapping.semanticId),
      })),
    );
  }, [displayState, hasStaleIr, activeMappings]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!displayState || hasStaleIr) return ids;
    for (const mapping of activeMappings) {
      for (const id of mapping.instructionIds) ids.add(id);
    }
    for (const instruction of displayState.instructions) {
      if (pinnedLines.includes(instruction.line)) ids.add(instruction.id);
    }
    for (const id of pinnedInstructionIds) ids.add(id);
    return ids;
  }, [displayState, hasStaleIr, activeMappings, pinnedLines, pinnedInstructionIds]);

  const status = compileStatus(state, busy);
  const review = reviewStatus(state?.review ?? null);
  const errors = state?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const warnings = state?.diagnostics.filter((d) => d.severity !== "error") ?? [];
  const canRun =
    TOOLCHAIN_STATUS.available && Boolean(state?.succeeded) && !busy && !hasStaleIr && review.tone !== "error";

  async function copyDiagnosticBundle() {
    const bundle = createDiagnosticBundle({
      diagnostics: state?.diagnostics ?? [],
      timings: state?.timings ?? {},
      review: state?.review ?? null,
    });
    try {
      await navigator.clipboard.writeText(bundle);
      setCopyFeedback("Diagnostic bundle copied (source and IR excluded).");
    } catch {
      setCopyFeedback("Clipboard access is unavailable in this browser context.");
    }
  }

  function togglePinnedInstruction(instructionId: string) {
    setPinnedInstructionIds((current) => {
      const next = new Set(current);
      if (next.has(instructionId)) next.delete(instructionId);
      else next.add(instructionId);
      return next;
    });
  }

  function pinSourceOffset(offset: number) {
    if (!displayState || hasStaleIr) return;
    const mappedIds = displayState.mappings
      .filter((mapping) => mapping.sourceRanges.some((range) => offset >= range.from && offset < range.to))
      .flatMap((mapping) => mapping.instructionIds);
    if (mappedIds.length === 0) return;
    setPinnedInstructionIds((current) => {
      const next = new Set(current);
      const shouldUnpin = mappedIds.every((id) => next.has(id));
      for (const id of mappedIds) {
        if (shouldUnpin) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function handleSourceChange(nextSource: string) {
    // Invalidate in-flight responses during the editor event, before React's
    // effect cleanup runs, so an old result cannot win this render boundary.
    requestCounter.current += 1;
    setSource(nextSource);
  }

  function resizePanels(clientX: number, container: HTMLElement | null) {
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const next = ((clientX - bounds.left) / bounds.width) * 100;
    setSplitPercent(Math.max(28, Math.min(72, next)));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">λ</span>
          <span className="brand-name">LLM Compiler</span>
        </div>
        <div className="status-group">
          <span className={`badge ${status.tone}`}>{status.label}</span>
          <span className={`badge ${review.tone}`}>{review.label}</span>
          <span className="badge idle">mock model</span>
        </div>
        <button
          className="run"
          disabled={!canRun}
          title={
            !TOOLCHAIN_STATUS.available
              ? "Execution requires the LLVM toolchain, which is not part of this build."
              : canRun
                ? "Run the current WebAssembly module."
                : "Compile successfully first."
          }
        >
          Run
        </button>
        <button
          className="secondary"
          type="button"
          aria-expanded={aboutOpen}
          aria-controls="about-limitations"
          onClick={() => setAboutOpen((open) => !open)}
        >
          About &amp; limitations
        </button>
      </header>

      <div className="notice">
        This build uses a deterministic mock model and does not yet include the LLVM toolchain. Checks
        shown here are structural: source limits, IR subset, ABI conformance. Execution is disabled.
        {aboutOpen ? (
          <section className="about-panel" id="about-limitations" aria-label="About and limitations">
            <h2>About this prototype</h2>
            <p>
              The current model and reviewer are deterministic fixtures. A “Mock review: pass”
              result here is not a model assessment and is not proof that generated IR matches the source.
            </p>
            <p>
              Real LLVM parsing, verification, code generation, linking, and WebAssembly execution are
              not available in this build. The Run control is intentionally disabled.
            </p>
            <p>
              No telemetry, analytics, backend, or remote inference is configured. The diagnostic bundle
              contains version identifiers, codes, static diagnostic titles, timings, and review status only; it excludes
              source text, IR, source ranges, and raw tool details.
            </p>
          </section>
        ) : null}
      </div>

      <div className="mobile-pane-tabs" aria-label="Editor panels">
        <button
          className={mobilePane === "source" ? "mobile-pane-tab active" : "mobile-pane-tab"}
          type="button"
          aria-pressed={mobilePane === "source"}
          onClick={() => setMobilePane("source")}
        >
          Source
        </button>
        <button
          className={mobilePane === "ir" ? "mobile-pane-tab active" : "mobile-pane-tab"}
          type="button"
          aria-pressed={mobilePane === "ir"}
          onClick={() => setMobilePane("ir")}
        >
          LLVM IR
        </button>
      </div>

      <main
        className={`panes mobile-${mobilePane}`}
        style={{ "--source-fr": `${splitPercent}fr`, "--ir-fr": `${100 - splitPercent}fr` } as CSSProperties}
      >
        <section className="pane source-pane">
          <div className="pane-head">
            <h2>Source</h2>
            <span className="muted">{source.length} chars</span>
          </div>
          <SourceEditor
            initialDoc={FIB_SOURCE}
            onChange={handleSourceChange}
            onCursorOffset={setCursorOffset}
            onHoverOffset={setHoverOffset}
            onClickOffset={pinSourceOffset}
            highlights={sourceHighlights}
          />
        </section>

        <button
          className="pane-resizer"
          type="button"
          role="separator"
          aria-label="Resize source and LLVM IR panels"
          aria-orientation="vertical"
          aria-valuemin={28}
          aria-valuemax={72}
          aria-valuenow={Math.round(splitPercent)}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            resizePanels(event.clientX, event.currentTarget.parentElement);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSplitPercent((current) => Math.max(28, current - 5));
            if (event.key === "ArrowRight") setSplitPercent((current) => Math.min(72, current + 5));
          }}
        />

        <section className="pane ir-pane">
          <div className="pane-head">
            <h2>LLVM IR</h2>
            <span className={hasStaleIr ? "stale-label" : "muted read-only"}>
              {hasStaleIr ? "stale · previous successful IR" : "read-only"}
            </span>
          </div>
          <IRViewer
            ir={displayState?.ir ?? null}
            instructions={displayState?.instructions ?? []}
            mappings={displayState?.mappings ?? []}
            selectedIds={selectedIds}
            onHoverInstruction={setHoveredInstructionId}
            onPinInstruction={togglePinnedInstruction}
          />
        </section>
      </main>

      <section className="bottom">
        <div className="tabs">
          <button className={tab === "diagnostics" ? "tab active" : "tab"} onClick={() => setTab("diagnostics")}>
            Diagnostics
            {errors.length + warnings.length > 0 ? <span className="count">{errors.length + warnings.length}</span> : null}
          </button>
          <button className={tab === "console" ? "tab active" : "tab"} onClick={() => setTab("console")}>
            Console
          </button>
          <button className="secondary copy-diagnostics" type="button" onClick={() => void copyDiagnosticBundle()}>
            Copy diagnostic bundle
          </button>
          <span className="spacer" />
          {state ? (
            <span className="muted">
              {displayState?.mappings.length ?? 0} mappings · {displayState?.instructions.length ?? 0} instructions
              {state.timings.total !== undefined ? ` · ${state.timings.total} ms` : ""}
            </span>
          ) : null}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {copyFeedback}
        </span>

        {tab === "diagnostics" ? (
          <div className="diagnostics">
            {state === null ? (
              <p className="muted pad">Waiting for the first compilation.</p>
            ) : errors.length + warnings.length === 0 ? (
              <p className="muted pad">No diagnostics.</p>
            ) : (
              [...errors, ...warnings].map((diagnostic, index) => {
                const location = locationLabel(diagnostic);
                return (
                  <button
                    key={`${diagnostic.code}-${index}`}
                    className={`diagnostic ${diagnostic.severity}`}
                    onClick={() => {
                      if (!hasStaleIr && diagnostic.irRanges) {
                        setPinnedLines(diagnostic.irRanges.map((range) => range.line));
                      }
                    }}
                  >
                    <span className="code">{diagnostic.code}</span>
                    <span className="message">
                      {diagnostic.message}
                      {diagnostic.details ? <span className="details">{diagnostic.details}</span> : null}
                    </span>
                    {location ? <span className="location">{location}</span> : null}
                  </button>
                );
              })
            )}
            {state?.review && state.review.verdict !== "pass" && state.review.findings.length > 0 ? (
              <div className="review-findings">
                <h3>Review findings</h3>
                {state.review.findings.map((finding, index) => (
                  <p key={index} className="muted">
                    {finding.code}: {finding.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <Console diagnostics={state?.diagnostics ?? []} />
        )}
      </section>
    </div>
  );
}
