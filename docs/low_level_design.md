# Low-Level Design --- Browser-Based AI Compiler

**Status:** Proposed engineering design\
**Architecture:** Static browser application, local inference, local
LLVM toolchain\
**Normative reference:** `compiler-specification.md` (rules);
`decisions.md` (locked choices)

## 1. Design principles

1.  The user's source text is the source of truth.
2.  The LLM is the language frontend and emits LLVM IR directly.
3.  No conventional language-specific parser or separate semantic IR is
    inserted between source and LLVM IR.
4.  LLVM IR is visible but read-only.
5.  All application processing occurs locally in the browser.
6.  The LLM returns machine-readable compiler results, never
    conversational responses.
7.  Incremental updates preserve unaffected IR where safe, and fall back
    to full compilation whenever safety cannot be shown.
8.  Source mapping is a first-class compilation artifact.
9.  LLVM structural verification is mandatory before code generation.
10. No generated unit tests are used as a compilation stage. The
    *project* is tested with its own suite (D-09).
11. Deterministic checks run before model-based ones. A model never
    decides whether the IR is valid.
12. Every artifact carries explicit version identifiers.

## 2. Runtime components

### 2.1 Main application

Responsibilities:

-   Render the responsive UI.
-   Own the source document.
-   Display diagnostics and compilation state.
-   Coordinate workers.
-   Manage compilation versions, cancellation and stale results.
-   Display source-to-IR mappings.
-   Manage the execution console.

Suggested modules:

``` text
src/
  app/
    App.tsx
    layout/
    panels/
  editor/
    SourceEditor.tsx
    SourceDecorations.ts
    ChangeTracker.ts
  ir/
    IRViewer.tsx
    IRDecorations.ts
    IRParser.ts
    IRSpans.ts
  compiler/
    CompilerCoordinator.ts
    CompilationState.ts
    IncrementalPlanner.ts
    ResultValidator.ts
    SubsetChecker.ts
    AbiChecker.ts
    Diagnostics.ts
    MappingStore.ts
    Limits.ts
  workers/
    llm.worker.ts
    llvm.worker.ts
    execution.worker.ts
  toolchain/
    ToolchainAdapter.ts
    WasiCliToolchain.ts
    LibraryToolchain.ts
  runtime/
    WasmRunner.ts
    WasiImports.ts
    Terminal.ts
  model/
    ModelManager.ts
    ModelCapabilities.ts
    LlmClient.ts
    MockLlmClient.ts
    PromptBuilder.ts
    prompts/
  dev/
    IrHarness.ts
  types/
    protocol.ts
    compilation.ts
    diagnostics.ts
```

This is a proposed organization. `ToolchainAdapter` is the seam that
lets Phase 0 compare Track A and Track B (D-01) without rewriting the
coordinator.

### 2.2 LLM worker

Responsibilities:

-   Initialize the local model and check compatibility.
-   Assemble the versioned prompt (§4.1 of the specification).
-   Run generation and review as two separate calls.
-   Normalize output (fence stripping, BOM) before validation.
-   Perform at most the bounded repair attempts allowed by §4.6.
-   Return structured results, never prose.
-   Handle cancellation and stale requests.

The worker must not access a network service for inference. It may fetch
model weights as static assets (D-07).

The worker holds the model; it must not hold application state. It
receives a request, returns a result, and is otherwise stateless.

### 2.3 LLVM worker

Responsibilities:

-   Load the browser-compatible toolchain.
-   Expose the `ToolchainAdapter` interface: `parse`, `verify`,
    `optimize`, `codegen`, `link`.
-   Run the subset checker and ABI checker before parsing.
-   Return structured per-stage diagnostics.
-   Return the resulting `.wasm` bytes.

The exact build and packaging is the Phase 0 comparison (D-01). Both
tracks must satisfy the same adapter contract:

``` ts
interface ToolchainAdapter {
  init(): Promise<ToolchainInfo>;      // versions, capabilities
  parse(ir: string): Promise<ParseResult>;
  verify(module: ModuleHandle): Promise<VerifyResult>;
  optimize(module: ModuleHandle, level: 0 | 2): Promise<ModuleHandle>;
  codegen(module: ModuleHandle): Promise<Uint8Array>;
  link(objects: Uint8Array[]): Promise<Uint8Array>;
  dispose(module: ModuleHandle): void;
}
```

`ToolchainInfo` reports `toolchainVersion`, `abiVersion`,
`irSubsetVersion`, `targetTriple`, `dataLayout` and `sysrootVersion`.
The coordinator refuses to compile if these disagree with the versions
baked into the prompt.

### 2.4 Execution worker

Responsibilities:

-   Instantiate `.wasm` modules with the ABI v1 import object.
-   Implement the WASI subset (`WasiImports.ts`).
-   Capture stdout and stderr with a 1 MiB cap.
-   Accept program input from a line-buffered queue.
-   Report exit status and traps.
-   Be disposable: the main thread terminates it on timeout.

The execution worker must not have access to the editor's internal state
or arbitrary application storage. It receives bytes, an ABI version and
stdin; it returns text and a status.

### 2.5 Capability handshake

At startup each worker reports capabilities. The main thread refuses to
start compilation if:

-   `abiVersion` disagrees between the prompt, the toolchain and the
    runtime;
-   `irSubsetVersion` disagrees between the subset checker and the
    toolchain;
-   the model's context window is below the minimum in §4.9 of the
    specification;
-   WebGPU is unavailable (for the real model; the mock client has no
    such requirement).

### 2.6 Developer harness

`dev/IrHarness.ts` accepts LLVM IR text directly and drives
subset-check → parse → verify → codegen → link → execute. It is gated by
a build flag, excluded from production builds, and never deployed. It is
the primary way to separate toolchain failures from model failures
(D-14).

## 3. Data contracts

All worker messages are versioned and validated at runtime. The
authoritative shapes are in `compiler-specification.md` §4; this section
defines the envelope and transport.

### 3.1 Envelope

``` ts
type ClientMessage =
  | { kind: "capabilities" }
  | { kind: "compile"; request: CompileRequest }
  | { kind: "review"; request: ReviewRequest }
  | { kind: "cancel"; requestId: string }
  | { kind: "execute"; moduleVersion: number; bytes: Uint8Array;
      stdin: string; limits: ExecutionLimits };

type WorkerMessage =
  | { kind: "capabilities"; info: Capabilities }
  | { kind: "progress"; requestId: string; stage: Stage; fraction?: number }
  | { kind: "result"; requestId: string; result: CompileResult }
  | { kind: "reviewResult"; requestId: string; result: ReviewResult }
  | { kind: "execution"; moduleVersion: number; result: ExecutionResult }
  | { kind: "error"; requestId: string; diagnostic: Diagnostic };
```

Rules:

-   `requestId` is unique per request and is echoed on every related
    message.
-   `progress` messages are advisory and may be dropped.
-   `cancel` is best-effort. A cancelled request may still produce a
    `result`; the coordinator discards it (E016, internal log only).
-   A message whose `protocolVersion` major differs from the client's is
    rejected with `E012`.

### 3.2 Compile request

``` json
{
  "protocolVersion": 1,
  "requestId": "req-7f3a",
  "documentVersion": 12,
  "mode": "full",
  "source": "user-authored program",
  "changedRanges": [],
  "previous": null,
  "dependencies": { "functions": [], "globals": [], "runtime": [] },
  "versions": {
    "promptVersion": 3,
    "reviewPromptVersion": 2,
    "schemaVersion": 1,
    "irSubsetVersion": 1,
    "abiVersion": 1
  },
  "limits": { "maxSourceBytes": 32768, "maxOutputTokens": 4096 }
}
```

For `mode: "incremental"`, `changedRanges` is non-empty and `previous`
carries:

``` json
{
  "ir": "...",
  "irVersion": 11,
  "mappings": [ ... ],
  "dependencies": { "functions": [ ... ], "globals": [ ... ] }
}
```

The target triple, data layout and ABI prelude are **not** part of the
request; they are fixed by the prompt version and injected by the
application.

### 3.3 Result

`CompileResult` is the union of the success and error shapes in
`compiler-specification.md` §4.2, plus the transport fields:

``` ts
interface CompileResult {
  status: "success" | "error";
  ir?: string | Patch;
  mappings?: RawMapping[];
  dependencies?: DependencySet;
  notes?: Note[];
  diagnostics: Diagnostic[];
  timings: StageTimings;   // ms per stage, for the diagnostic bundle
  versions: ArtifactVersions;
}
```

`ReviewResult` is §4.4 of the specification plus `timings`.

### 3.4 Validation

Every inbound message passes three checks, in order:

1.  **Transport validation** --- shape, required fields, version.
    Failure: `E012`.
2.  **Semantic validation** --- ranges within source bounds, no split
    surrogates, `semanticId` unique, anchors syntactically plausible.
    Failure: `E019` for structural problems; `W001` for individual
    unresolvable anchors.
3.  **Cross-reference validation** --- every `irRef.function` exists in
    the IR; every `dependency` symbol is declared or defined; the
    module has exactly one `main`.

Validation never mutates the result. A result that fails is rejected
whole, except for the per-anchor degradation allowed by W001.

### 3.5 Diagnostics

``` ts
interface Diagnostic {
  code: string;                       // E0xx or W0xx
  severity: "error" | "warning" | "info";
  message: string;                    // short, user-facing
  details?: string;                   // raw tool text, technical
  sourceRanges?: SourceRange[];       // UTF-16, half-open
  irRanges?: { line: number; column: number; length?: number }[];
  stage: Stage;
}
```

Codes are defined in `compiler-specification.md` §7. They are stable and
independent of the UI framework. Adding a code is a minor version bump;
changing a code's meaning is a major one.

## 4. LLM compilation contract

### 4.1 Two stages

**Generation** --- source plus context to IR, mappings, dependencies and
diagnostics.

**Review** --- source plus the *generated IR* to a verdict and findings.
The review prompt does not receive the generator's reasoning, only its
`notes`.

The two stages use separate workers-in-flight bookkeeping: a review is
keyed to `(requestId, irVersion)` and is discarded if the IR it was
reviewing is no longer the current IR.

### 4.2 Prompt assembly

`PromptBuilder` composes sections `P-ROLE`, `P-SRC`, `P-IR`, `P-ABI`,
`P-OUT`, `P-EX`, `P-REQ` from versioned source files under
`model/prompts/`. The builder is pure: same inputs and same
`promptVersion` produce the same string.

Rules:

-   `P-ABI` embeds the declaration block from
    `compiler-specification.md` §3.5 verbatim. It is generated from the
    same source of truth used by `AbiChecker`, so the two cannot drift.
-   `P-IR` states the triple, the opaque-pointer rule and the forbidden
    list. It includes at least one example in the pinned dialect.
-   `P-EX` contains a small number of complete input/output pairs,
    including a prompt-only rejection and an ambiguity error. Examples
    are the highest-leverage part of the prompt and are versioned.
-   `P-REQ` carries the source, the ranges and, for incremental
    requests, the previous IR and the dependency set.

### 4.3 Decoding

Configured per `compiler-specification.md` §4.5. The client prefers
schema-constrained decoding when the runtime and model support it, and
otherwise validates after the fact. In both cases the result must pass
schema validation before it is used.

### 4.4 Normalization and repair

Per `compiler-specification.md` §4.6. Repair is bounded, silent, and
recorded as `W007`. It is never a conversation.

### 4.5 No conversational behaviour

The model must never ask a question, request clarification, offer
alternatives, or emit prose. If semantics cannot be determined it
returns a diagnostic. This is enforced in three places: the prompt, the
schema (there is no field for prose), and validation (a response that is
not a JSON object is `E019`).

### 4.6 Prompt-only detection

The prompt instructs the generator to reject requests. Validation cannot
detect a semantic misjudgement, so the detection is model-based. The
test suite pins the behaviour with fixtures (T13, T17) and the mock
client reproduces it deterministically.

## 5. Incremental compilation

### 5.1 Framing

Incremental compilation is a product requirement (R11) and a milestone
after the end-to-end loop (D-11). It is specified now so that the full
path is written in a way that can be extended, not retrofitted.

### 5.2 Change detection

CodeMirror transactions provide document changes. The application:

1.  Records changed ranges as half-open UTF-16 intervals.
2.  Debounces bursts of typing (500 ms, D-12).
3.  Assigns a monotonically increasing `documentVersion`.
4.  Maps ranges to containing functions using the last accepted IR's
    source mappings.
5.  Expands the region using the dependency set.
6.  Chooses `incremental` only if the affected region is provable;
    otherwise `full`.

### 5.3 Planner rules

The planner expands the region when the edit touches:

-   a function signature,
-   a global declaration or initializer,
-   a shared type or struct layout,
-   a runtime declaration,
-   a source range mapped to more than one function,
-   a range with no mapping at all (unknown provenance → full).

If expansion crosses more than half the module, the planner chooses
`full`. The threshold is configuration, not a magic constant.

### 5.4 Patch application

1.  The parser records byte spans for every function definition,
    declaration and global. Spans come from the parser, never from brace
    counting.
2.  The patch is applied to a copy of the current IR text by replacing
    those spans. Untouched text is preserved byte-for-byte.
3.  The result is re-parsed and re-verified (S3--S8).
4.  On success, the new IR replaces the old atomically and
    `irVersion` increments.
5.  On failure, the copy is discarded, `W008` is emitted, and a full
    compilation is issued. The failed patch is never shown as a
    compilation result.

### 5.5 Mapping updates

Mappings for replaced functions are dropped and replaced by the
response's top-level mappings. Mappings for untouched functions keep
their identities.
Instruction identities are `fn:<name>#<ordinal>` scoped to `irVersion`,
so they change only where the text changed.

### 5.6 Stale responses

Every request carries `requestId` and `documentVersion`. A response whose
`documentVersion` is older than the current one is discarded from the
visible artifact and retained only in the request log. Cancellation is
attempted on supersession (E016).

### 5.7 Fallback

Full compilation is always available and is the default whenever
anything is uncertain. No UI state or feature may depend on incremental
being enabled.

## 6. Source-to-IR mapping

### 6.1 Model output versus application state

The model emits anchors (§4.3 of the specification). The application
resolves them against the parsed module and owns the resulting
instruction identities. This split exists because ordinals are fragile
and because the application must never present a mapping it cannot
verify.

### 6.2 Resolution

1.  Normalize instruction text: collapse whitespace, strip comments.
2.  Scan the named function body for an exact match.
3.  Resolve duplicates in module order, consuming each occurrence once.
4.  Drop unresolvable references with `W001`.

### 6.3 Coverage

The application computes the unmapped set. Instructions with no mapping
are styled as compiler-generated. Mappings with `confidence: low` are
shown with a distinct style; they are never hidden.

### 6.4 UI behaviour

-   Hover source: highlight corresponding IR.
-   Hover IR: highlight corresponding source.
-   Click source: pin corresponding IR highlights.
-   Click IR: pin corresponding source highlights.
-   Unmapped instructions: distinct neutral style.
-   Uncertain mappings: distinct style, not silently equal to confident
    ones.

### 6.5 Optimized IR

Optimization removes, combines, inlines and reorders instructions.
Original mappings do not survive it. The optimized view is separate, is
explicitly labelled as unmapped, and is never the primary view.

## 7. LLVM toolchain

### 7.1 Two candidate implementations

Per D-01, the adapter is implemented twice during Phase 0:

-   **Track A --- WASI CLI.** `opt`, `llc`, `wasm-ld` built for
    `wasm32-wasip1`, running in a WASI shim with a virtual filesystem.
    Diagnostics are parsed from stderr into `Diagnostic` records.
-   **Track B --- library.** `libLLVM` plus a C driver, with LLD's wasm
    linker linked in-process through a C shim. Diagnostics come from the
    LLVM diagnostic handler.

Track A's stderr parsing is the main risk: message text is version-
coupled. The parser maps text to codes by pattern and falls back to a
generic code with the raw text in `details` when it cannot classify.

### 7.2 Pipeline

``` text
LLM-generated LLVM IR
        |
        v
subset checker (deterministic, E018)
        |
        v
ABI checker (deterministic, E017)
        |
        v
LLVM IR parser (E007)
        |
        v
LLVM verifier (E007)
        |
        v
optional optimization
        |
        v
WebAssembly backend (E008)
        |
        v
object file
        |
        v
wasm-ld + wasi sysroot (E009)
        |
        v
WASM module
```

### 7.3 Subset and ABI checkers

Both are small, deterministic text/AST passes that run before the
toolchain so that policy violations get precise diagnostics:

-   `SubsetChecker` --- scans the token stream for forbidden constructs
    and typed pointers; reports the line and column.
-   `AbiChecker` --- extracts every `declare` and every call to a
    runtime symbol; compares signatures against the canonical table;
    reports mismatches as `E017` with the symbol name.

Neither checker attempts to parse IR semantics. They exist to make
common failures legible, not to replace LLVM.

### 7.4 Target and ABI

Fixed by `compiler-specification.md` §3: `wasm32-wasip1`, opaque
pointers, ILP32, `_start` entry, 1 MiB stack, 256 MiB ceiling, no
`--allow-undefined`. The sysroot is a versioned asset whose
`sysrootVersion` is checked against the toolchain.

### 7.5 Determinism

Same IR, flags, toolchain and sysroot produce byte-identical output.
This is required for fixture comparison (T01--T09) and for caching. Any
non-determinism is a bug in the adapter.

### 7.6 Caching

The adapter may cache parse and codegen results keyed by
`(irHash, flags, toolchainVersion)`. Cache entries live in memory only;
persistent caching of compilation state is not permitted (D-13 privacy
posture is about uploads, but persistent IR storage is also unnecessary
and is excluded by the in-memory-state requirement).

## 8. Runtime ABI and execution

### 8.1 Imports

ABI v1 is the WASI preview1 subset in `compiler-specification.md` §6.2.
The import object is built from an allowlist; unknown imports fail
instantiation with `E017`. There is no catch-all stub.

### 8.2 Execution lifecycle

1.  Receive `.wasm` bytes and `abiVersion`.
2.  Spawn a fresh execution worker.
3.  Build the import object.
4.  Instantiate; on failure report `E017` with the offending import.
5.  Call `_start` exactly once.
6.  Stream stdout and stderr to the terminal, capped at 1 MiB.
7.  Catch the exit sentinel; report the status.
8.  Terminate the worker and discard it.

### 8.3 Interruption and limits

`_start` runs synchronously inside the worker, so the worker cannot
interrupt itself. The main thread enforces the 5 s wall clock by
terminating the worker and reporting `E010`. Memory is bounded by the
module's own 256 MiB ceiling, so allocation failure traps inside wasm
instead of exhausting the tab.

### 8.4 Safety

-   Controlled imports only.
-   No filesystem, no network, no threads (D-08).
-   No access to application source state.
-   No browser storage access from the executed module.
-   stdin is supplied by the user; there is no ambient input.

## 9. Local model management

### 9.1 Engine

WebLLM, single-threaded on WebGPU (D-08). No remote fallback, ever.

### 9.2 Selection

Per D-06: benchmarked candidates, license-checked, preferring models
with existing MLC builds. The benchmark records IR validity rate,
semantic review pass rate, structured-error compliance, patch quality,
latency and memory for each candidate and quantization.

### 9.3 Context budget

Enforced per `compiler-specification.md` §4.9. The application measures
the assembled prompt and fails with `E014` rather than truncating.

### 9.4 Device capability

At startup: detect WebGPU, check the model against available memory
where measurable, select a variant, and report unsupported
configurations with `E011`. Without cross-origin isolation,
`measureUserAgentSpecificMemory` is often unavailable; the check is
therefore heuristic and the UI must say so rather than claim a precise
budget.

### 9.5 Mock client

`MockLlmClient` implements the same `LlmClient` interface and returns
fixtures keyed by a hash of the source. It is used by every CI test
(D-09). It must reproduce: valid output, fenced output, invalid JSON,
typed pointers, missing `main`, undefined symbol, oversized source and
prompt-only rejection.

## 10. UI layout

### Desktop

-   Source editor on the left.
-   Read-only LLVM IR explorer on the right.
-   Terminal/console at the bottom.
-   Resizable panels.
-   Synchronized source and IR highlights.

### Mobile

-   Source and IR as switchable tabs.
-   Full-width editor.
-   Console in a bottom drawer or separate panel.
-   Compact mapping indicators.
-   No forced multi-column layout.

### Main UI states

-   Initial/loading.
-   Capability check.
-   Model loading (with progress and size).
-   Ready.
-   Compiling (with stage progress).
-   Compilation error (diagnostics).
-   IR valid (structural verification passed).
-   Semantic review passed / inconclusive / failed / not run.
-   Linking.
-   Ready to execute.
-   Running.
-   Execution completed.
-   Runtime error.
-   Stale (source changed since the displayed result).
-   Device unsupported.

Wording is constrained by `compiler-specification.md` §5.4: no
"verified", "correct" or "proven".

### Empty and error states

-   First run with no model: a single clear call to action with the
    download size.
-   Model download failure: `E020`, with a retry and the asset hash.
-   Toolchain fetch failure: `E012` with the expected hash and the
    actual result, if computable.
-   No WebGPU: `E011` with a link to the limitations view.

## 11. Storage and network boundaries

No application database or backend is present.

In-memory state: current source, current IR, mappings, dependencies,
compilation versions, diagnostics, current module and execution state.

Network activity is limited to fetching static assets: the application
shell, the toolchain wasm, the sysroot, and model weights. Bulk assets
come from an external static host with long-lived caching (D-07) and are
verified against pinned SHA-256 hashes before use. A hash mismatch is
fatal and reported; it is never ignored.

Browser-managed caching of model and compiler assets is permitted and
expected. No source, IR or runtime data is uploaded anywhere, and there
is no telemetry, analytics or crash reporting (D-13).

## 12. Error handling

Errors are structured, versioned and tied to a stage. Codes are in
`compiler-specification.md` §7.

The UI distinguishes: source interpretation errors, subset and ABI
violations, LLVM IR errors, toolchain errors, linker errors, runtime
errors, review outcomes, and hardware/browser compatibility errors.

Automatic repair of malformed output is bounded (one schema repair, one
IR repair per failure class) and never becomes a conversation. If repair
fails, a compiler error is returned. There is no retry loop.

Because there is no telemetry, every diagnostic must be self-explanatory
and copyable. A "copy diagnostic bundle" action produces versions,
timings, codes and messages only --- never source text --- and the user
chooses to share it.

## 13. Test strategy

Per D-09. Layers, all required:

| Layer                | Tooling            | Covers                                              |
| -------------------- | ------------------ | --------------------------------------------------- |
| Unit                 | Vitest             | Schema validation, offset math, subset checker, ABI checker, patch splicer, span mapping, limit checks |
| Golden IR            | Vitest + adapter   | Fixtures T01--T09: parse, verify, link, run          |
| Model-response       | Vitest + mock      | Fixtures T10--T15: normalization, repair, rejection |
| Browser integration  | Playwright/Chromium| T18--T20 plus the full worker round-trip            |
| Type and lint        | `tsc --noEmit`, ESLint | ---                                             |
| Manual model smoke   | Recorded checklist | Real inference on a real GPU device                 |

Rules:

-   CI never builds LLVM. It downloads the pinned toolchain artifact
    from a release and verifies its hash.
-   CI never requires a GPU. The mock client stands in for the model.
-   Every new diagnostic code ships with a fixture.
-   The specification's test-vector table (§9) is the contract; a build
    that disagrees is non-conforming.

Workflows:

-   `ci.yml` --- typecheck, unit, golden, model-response, browser
    integration on pull requests.
-   `deploy.yml` --- build and publish the shell to GitHub Pages.
-   `toolchain-release.yml` --- manually triggered LLVM + sysroot build
    that publishes a versioned artifact with hashes.

## 14. Key technical risks

| Risk                                | Mitigation                                                     |
| ----------------------------------- | -------------------------------------------------------------- |
| Model cannot understand arbitrary syntax | Explicit errors; benchmark diverse inputs                 |
| Model invents semantics             | Two-stage review; fail on uncertainty; `E002`--`E005`          |
| Model emits pre-opaque-pointer IR   | Dialect pinned in prompt; `SubsetChecker` rejects with `E018`  |
| LLM produces invalid IR             | LLVM verifier; bounded repair; full diagnostic                 |
| Browser LLVM build is too large     | Two-track comparison; minimal build; measure before committing |
| Track A stderr parsing is brittle   | Structured-code mapping with raw text fallback; version-pinned |
| WASI import surface is larger than expected | Allowlist plus fail-closed instantiation (`E017`)     |
| GPU memory insufficient             | Compatibility checks; smaller variants; `E011`                 |
| Incremental patch is incomplete     | Span-based splice, re-verify, discard and fall back (`W008`)   |
| Mapping becomes stale               | Anchors resolved per version; unresolved dropped (`W001`)      |
| Runtime hangs                       | Disposable worker; terminate at 5 s (`E010`)                   |
| Mobile performance is poor          | Responsive UI; hardware-aware model selection                  |
| Pages bandwidth is exhausted        | Bulk assets on a cache-friendly external host (D-07)           |
| No telemetry means silent failures  | Self-explanatory diagnostics; copyable bundle                  |

## 15. Acceptance criteria for the first complete implementation

-   The application is deployed on GitHub Pages and requires no
    application backend.
-   A local model loads and runs in a supported browser, with no remote
    inference fallback.
-   User-authored pseudocode is translated directly to LLVM IR.
-   Prompt-only input returns `E001`.
-   The LLVM IR is read-only in the product.
-   Generated IR passes the subset checker, the ABI checker and LLVM
    structural verification.
-   The browser-compatible toolchain produces a `.wasm` module.
-   The browser executes the module with working stdin and stdout.
-   Semantic review runs as a separate stage and its verdict is shown
    with the specified wording.
-   Source and IR highlights are synchronized, with unmapped and
    uncertain instructions distinguished.
-   A local source edit updates only the affected IR region when
    dependencies permit, and falls back to full compilation otherwise.
-   Stale compilation responses cannot overwrite newer source versions.
-   All limits in D-12 are enforced and reported with their codes.
-   Unsupported hardware produces `E011`.
-   The test suite passes in CI with the mock model, including the
    specification's test vectors.
-   No source, IR or execution data leaves the device; no telemetry
    exists.
