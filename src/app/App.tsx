import { useEffect, useMemo, useRef, useState } from "react";
import { SourceEditor } from "../editor/SourceEditor.tsx";
import { IRViewer } from "../ir/IRViewer.tsx";
import { MockLlmClient } from "../model/MockLlmClient.ts";
import { FIB_SOURCE } from "../model/fibFixture.ts";
import { Console } from "../console/Console.tsx";
import { runCompilation, type CompileOutput } from "../compiler/coordinator.ts";
import { LIMITS } from "../compiler/limits.ts";
import { hasErrors, type Diagnostic } from "../types/diagnostics.ts";
import type { ReviewPayload } from "../types/protocol.ts";

type Tone = "idle" | "busy" | "ok" | "warn" | "error";

function compileStatus(state: CompileOutput | null, busy: boolean): { label: string; tone: Tone } {
  if (busy) return { label: "Compiling", tone: "busy" };
  if (!state) return { label: "Ready", tone: "idle" };
  if (hasErrors(state.diagnostics)) return { label: "Compilation failed", tone: "error" };
  if (state.succeeded) return { label: "IR valid", tone: "ok" };
  return { label: "Ready", tone: "idle" };
}

function reviewStatus(review: ReviewPayload | null): { label: string; tone: Tone } {
  if (!review) return { label: "Semantic review not run", tone: "warn" };
  if (review.verdict === "pass") return { label: "Semantic review passed", tone: "ok" };
  if (review.verdict === "fail") return { label: "Semantic review failed", tone: "error" };
  return { label: "Semantic review inconclusive", tone: "warn" };
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
  const [busy, setBusy] = useState(true);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [pinnedLines, setPinnedLines] = useState<number[]>([]);
  const [tab, setTab] = useState<"diagnostics" | "console">("diagnostics");
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
        setBusy(false);
        setPinnedLines([]);
      });
    }, LIMITS.debounceMs);
    return () => window.clearTimeout(timer);
  }, [source, client]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!state) return ids;
    for (const mapping of state.mappings) {
      const underCursor = mapping.sourceRanges.some(
        (range) => cursorOffset >= range.from && cursorOffset < range.to,
      );
      if (underCursor) {
        for (const id of mapping.instructionIds) ids.add(id);
      }
    }
    for (const instruction of state.instructions) {
      if (pinnedLines.includes(instruction.line)) ids.add(instruction.id);
    }
    return ids;
  }, [state, cursorOffset, pinnedLines]);

  const status = compileStatus(state, busy);
  const review = reviewStatus(state?.review ?? null);
  const errors = state?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const warnings = state?.diagnostics.filter((d) => d.severity !== "error") ?? [];
  const canRun = Boolean(state?.succeeded) && review.tone !== "error";

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
            canRun
              ? "Execution requires the LLVM toolchain, which is not part of this milestone."
              : "Compile successfully first."
          }
        >
          Run
        </button>
      </header>

      <div className="notice">
        This build uses a deterministic mock model and does not yet include the LLVM toolchain. Checks
        shown here are structural: source limits, IR subset, ABI conformance. Execution is disabled.
      </div>

      <main className="panes">
        <section className="pane">
          <div className="pane-head">
            <h2>Source</h2>
            <span className="muted">{source.length} chars</span>
          </div>
          <SourceEditor initialDoc={FIB_SOURCE} onChange={setSource} onCursorOffset={setCursorOffset} />
        </section>

        <section className="pane">
          <div className="pane-head">
            <h2>LLVM IR</h2>
            <span className="muted read-only">read-only</span>
          </div>
          <IRViewer ir={state?.ir ?? null} instructions={state?.instructions ?? []} selectedIds={selectedIds} />
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
          <span className="spacer" />
          {state ? (
            <span className="muted">
              {state.mappings.length} mappings · {state.instructions.length} instructions
              {state.timings.total !== undefined ? ` · ${state.timings.total} ms` : ""}
            </span>
          ) : null}
        </div>

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
                      if (diagnostic.irRanges) setPinnedLines(diagnostic.irRanges.map((range) => range.line));
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
