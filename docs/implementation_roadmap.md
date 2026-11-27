# Implementation Roadmap --- Browser-Based AI Compiler

**Goal:** Deliver a language-agnostic, browser-only AI compiler hosted
on GitHub Pages.\
**Normative reference:** `compiler-specification.md`\
**Locked decisions:** `decisions.md`

## 1. Delivery strategy

Build the project in vertical slices, and prove the uncertain parts with
working code rather than with design.

Three risks dominate:

1.  **A real LLVM toolchain in the browser.** Nothing else matters if
    this fails.
2.  **A small local model producing valid LLVM IR in a pinned dialect.**
    This is unusual enough that public code benchmarks do not predict
    it.
3.  **A patch protocol that is safe enough to enable.** A wrong
    localized update is worse than a slow full compile.

The first two are resolved in Phase 0. The third is deferred until a
full-module baseline exists to compare against (D-11).

No server, backend, database, account system, or generated test suite is
part of the product. The project itself is tested (D-09).

Every phase ends with an exit criterion that is observable, not a
judgement call.

## 2. Phase 0 --- Technical feasibility spikes

**Objective:** Establish, with two working prototypes and measured
numbers, that the two core technologies work inside browser
constraints, and choose a toolchain packaging.

### 2.1 Prerequisites

0.  The document baseline is in place: this file,
    `high_level_design.md`, `compiler-specification.md`,
    `low_level_design.md`, `decisions.md`. No Phase 0 work starts
    before the specification exists, because the spike must be measured
    against a contract.

### 2.2 Work items

1.  Create a minimal Vite + TypeScript project and a GitHub Pages
    deployment workflow.
2.  Build the **Track A** toolchain: `opt`, `llc`, `wasm-ld` compiled
    for `wasm32-wasip1`, running under a WASI shim in a Web Worker with
    a virtual filesystem.
3.  Build the **Track B** toolchain: `libLLVM` plus a C driver, with
    LLD's wasm linker in-process through a C shim.
4.  Assemble the pinned `wasi-libc` sysroot and verify it links against
    the reference IR.
5.  Implement the developer IR harness (`dev/IrHarness.ts`) and use it
    for every toolchain experiment.
6.  Implement the subset checker and ABI checker against the
    specification's tables, and confirm they catch the fixtures before
    LLVM does.
7.  Verify, compile and link the reference Fibonacci IR through both
    tracks; execute it with stdin `10` and confirm `89`.
8.  Load WebLLM in a dedicated worker and run one small candidate model
    on a WebGPU device.
9.  Have that model translate the Fibonacci pseudocode to IR that passes
    the pipeline, without any network call after the model is loaded.
10. Measure the metrics in §2.4 for both tracks and record them.
11. Record the resulting decision in `decisions.md` (D-01, O-04).

### 2.3 Reference artifacts

-   `fixtures/ir/fib.ll` --- the reference module from
    `compiler-specification.md` §9 (T02).
-   `fixtures/source/fib.txt` --- the Fibonacci pseudocode from the
    high-level design.
-   The ABI prelude block from `compiler-specification.md` §3.5.

### 2.4 Measurements

Record, per track, in a checked-in results file:

| Metric               | Notes                                                    |
| -------------------- | -------------------------------------------------------- |
| Bundle size          | Uncompressed and brotli, toolchain assets only            |
| Cold start           | Worker spawn to first successful parse, median of 5       |
| Compile latency      | 200-line module, `-O0` and `-O2`, median of 20            |
| Peak memory          | Stress module, plus browser-reported figure where available |
| Diagnostic fidelity  | Induced failures classified correctly, out of 8          |
| Implementation effort| Engineer-days to reach the contract                       |
| Maintenance risk     | Patch count, LLVM bump difficulty, upstream breakage      |

The eight induced failures: bad syntax, type mismatch, undefined
symbol, duplicate symbol, typed pointer, missing `main`, bad flag, and
oversized module.

### 2.5 Exit criteria

-   A static GitHub Pages deployment works with no application server.
-   A real LLVM toolchain processes LLVM IR in the browser, from both
    tracks.
-   The reference module links against `wasi-libc` and produces a
    `.wasm`.
-   The module executes in the browser, reads `10` from stdin and prints
    `89`.
-   Local LLM inference works with no remote endpoint.
-   The model's IR passes the subset checker, the ABI checker and the
    verifier at least once, end to end.
-   Metrics are recorded for both tracks and D-01 is resolved.

### 2.6 Go/no-go

Do not proceed to product implementation until both the toolchain and
the model spikes succeed and D-01 is decided. If the LLVM build proves
impractical in both packagings, revisit packaging before considering any
alternative to real LLVM --- but note that replacing LLVM changes the
product's definition, not just its implementation.

If the model cannot produce valid IR at all, that is a finding, not a
failure of the spike: record it, try a second candidate, and escalate
before building UI.

## 3. Phase 1 --- Minimal end-to-end compiler

**Objective:** Demonstrate the central product idea with the contract
fully implemented and no UI polish.

### 3.1 Work items

1.  Build a minimal source editor with CodeMirror 6.
2.  Implement `PromptBuilder` with versioned sections and the ABI
    prelude from the specification.
3.  Implement schema validation, normalization and bounded repair
    (specification §4.2, §4.6).
4.  Implement prompt-only rejection and pin it with fixtures.
5.  Implement the two-stage flow: generation, then semantic review
    (D-10).
6.  Implement the subset checker and ABI checker as first-class
    components.
7.  Implement the toolchain adapter for the winning track.
8.  Implement the WASI import allowlist and the execution worker.
9.  Implement the console with stdin, stdout, stderr, exit status and
    limits.
10. Implement the compilation state model from specification §1.2:
    versions, staleness, and the rule that a failed compile does not
    erase the last good IR.
11. Implement `MockLlmClient` and the fixture corpus (D-09).
12. Stand up CI: typecheck, unit, golden IR, model-response, browser
    integration.

### 3.2 Initial demonstration program

``` text
Make a function called fib:
Takes number x
If x is 0 or 1 return 1
Else return fib of x-1 plus fib of x-2

Ask user "what's you number dude:\n"
Take user input number
Print fib of user input
```

The compiler must interpret this as user-supplied pseudocode. The base
cases return `1`; input `10` produces `89`.

### 3.3 Exit criteria

-   A user can enter the example, obtain IR from the local model, have
    it pass the subset check, the ABI check and LLVM verification, have
    it link, enter `10` and see `89`.
-   Semantic review runs as a separate stage and its verdict is
    displayed with the specified wording.
-   `Make me a Fibonacci program` produces `E001` and no IR.
-   Every diagnostic code in the specification has at least one
    fixture.
-   CI passes with the mock model and with the real toolchain worker.
-   The developer IR harness reproduces the same result without the
    model.

## 4. Phase 2 --- Product interface

**Objective:** Turn the prototype into a usable compiler playground.

### 4.1 Work items

1.  Implement responsive desktop and mobile layouts.
2.  Add a read-only LLVM IR viewer with syntax highlighting.
3.  Add diagnostics with source and IR locations, including the rule
    that parse failures never get a guessed source range.
4.  Add all UI states from the low-level design, including *stale*,
    *review inconclusive* and *device unsupported*.
5.  Add execution status, trap display and the truncation notice.
6.  Add resizable desktop panels and mobile tabs.
7.  Add model loading with progress and download size, and hardware
    compatibility screens.
8.  Add the "copy diagnostic bundle" action (versions, codes, timings;
    never source).
9.  Ensure inference and compilation never block the UI thread.
10. Add the limitations/about view required by specification §5.5.

### 4.2 Exit criteria

-   The interface is usable on desktop and mobile with source editing,
    IR inspection, diagnostics and execution.
-   The LLVM IR cannot be edited.
-   No label violates specification §5.4.
-   A failed compile leaves the last good IR visible and marked stale.
-   Keyboard-only operation works for the editor, IR pane and console.

## 5. Phase 3 --- Source-to-IR mapping

**Objective:** Implement the Compiler Explorer-style visual feature.

### 5.1 Work items

1.  Implement anchor resolution and drop-with-warning (specification
    §4.3).
2.  Assign application-owned instruction identities scoped to
    `irVersion`.
3.  Compute the unmapped set in the application.
4.  Implement source editor decorations.
5.  Implement IR viewer decorations.
6.  Implement hover synchronization in both directions.
7.  Implement click-to-pin selection.
8.  Distinguish unmapped and low-confidence mappings visually.
9.  Add mapping fixtures, including duplicate anchors and unresolvable
    anchors.

### 5.2 Exit criteria

-   Hovering a source statement highlights its IR instructions, and the
    reverse.
-   One-to-many and many-to-many mappings work.
-   An unresolvable anchor produces `W001` and no fabricated highlight.
-   Unmapped instructions are visually distinct.

### 5.3 Implementation note

Start with unoptimized IR. Optimization changes instruction identity and
is a separate, explicitly unmapped view.

## 6. Phase 4 --- Incremental compilation

**Objective:** Make a small edit produce a small IR change, safely.

This is a release requirement (R11) and is scheduled after the
end-to-end loop, per D-11.

### 6.1 Work items

1.  Detect changed ranges from CodeMirror transactions.
2.  Debounce at 500 ms.
3.  Map changed ranges to functions using existing mappings.
4.  Implement the dependency-aware planner with the expansion rules in
    the low-level design §5.3.
5.  Record parser spans for functions, globals and declarations.
6.  Implement the patch schema and validation.
7.  Implement span-based splicing with byte-for-byte preservation of
    untouched text.
8.  Re-verify the spliced module and discard on failure with `W008`,
    then fall back to full compilation.
9.  Preserve mappings and identities for untouched functions.
10. Re-run semantic review for patches that change behaviour.
11. Reject stale responses and cancel superseded requests.
12. Add fixtures for each patch operation and each fallback path.

### 6.2 Demonstration

Original:

``` text
return fib(x-1) + fib(x-2)
```

Edited:

``` text
return fib(x-1) + fib(x-3)
```

Expected: the changed range is detected, only `fib` is regenerated, the
patch is spliced, re-verified and re-reviewed, unaffected module content
and mappings are preserved, and no obsolete response is applied.

### 6.3 Exit criteria

-   A local edit updates only the affected IR region when safe.
-   An edit with wider dependencies triggers expansion or full
    compilation, and says so (`W004`).
-   A failed patch never becomes a visible result.
-   Latency for a one-line edit is measurably below a full compile on
    the same device, and the measurement is recorded.

## 7. Phase 5 --- Reliability and compatibility

**Objective:** Make the compiler robust across supported devices and
inputs, with evidence.

### 7.1 Work items

1.  Run the model benchmark (D-06) over the candidate set and
    quantizations; record results.
2.  Evaluate known-language, pseudocode, assembly, mixed-notation and
    invented-syntax corpora.
3.  Measure review agreement: how often review catches a deliberately
    wrong IR, and how often it rejects a correct one.
4.  Tune bounded repair using measured failure classes.
5.  Verify every diagnostic code is reachable and correctly mapped.
6.  Add compile timeouts and cancellation across all stages.
7.  Verify execution limits and worker replacement under load.
8.  Establish the supported device matrix (O-05).
9.  Provide smaller-model variants for constrained devices.
10. Measure memory and download size on each supported device class.
11. Pin compiler, sysroot and model versions; publish hashes.
12. Validate the deployed Pages build and asset integrity.

### 7.2 Exit criteria

-   The application reports unsupported or ambiguous input honestly.
-   It does not silently change program semantics.
-   It does not hang the editor or the browser when inference or
    execution exceeds its limits.
-   Benchmark and device-matrix results are checked in.
-   No generated unit-test suite is part of the pipeline; LLVM
    verification and semantic review remain the compilation checks.

## 8. Phase 6 --- Release preparation

**Objective:** Publish a reproducible, self-contained static
application.

### 8.1 Work items

1.  Finalize the Pages deployment workflow and Vite base path.
2.  Version compiler, sysroot and model assets; publish SHA-256 hashes.
3.  Document model downloads and license obligations (O-02).
4.  Document browser and hardware requirements (O-05).
5.  Confirm no source or IR is uploaded, and that no telemetry exists.
6.  Confirm there is no application backend or database.
7.  Verify the application works from the deployed URL, including a
    cold cache and an offline-after-cache run.
8.  Provide a clear first-run model download experience.
9.  Document known limitations of local inference and semantic review.
10. Add the repository `LICENSE` and product naming (O-01).

### 8.2 Exit criteria

The application can be deployed and used from GitHub Pages without
operating an application server, and every claim it makes about
verification is accurate.

## 9. Suggested repository structure

``` text
llmcompiler/
  public/
    assets/
      llvm/            # toolchain wasm (or fetched from the asset host)
      sysroot/         # wasi-libc sysroot
  src/
    app/
    editor/
    ir/
    compiler/
    toolchain/
    workers/
    runtime/
    model/
      prompts/
    dev/
    types/
  fixtures/
    ir/
    model/
    source/
  tests/
    unit/
    golden/
    browser/
  scripts/
    build-llvm-wasm/
    package-assets/
    fetch-assets/
  docs/
    high_level_design.md
    compiler-specification.md
    low_level_design.md
    implementation_roadmap.md
    decisions.md
  .github/
    workflows/
      ci.yml
      deploy.yml
      toolchain-release.yml
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

Large model weights do not live in the repository. They are fetched as
static assets from the external host (D-07), verified by hash, and
cached by the browser. The distribution source and model license must be
documented.

## 10. Prioritization

| Priority | Work                                    | Why                                        |
| -------- | --------------------------------------- | ------------------------------------------ |
| P0       | LLVM compiled for browser (two tracks)  | Fundamental feasibility                    |
| P0       | Local WebLLM inference                  | Fundamental privacy and deployment requirement |
| P0       | Specification artifacts: prompt, schema, ABI prelude, subset | The compiler contract is the product |
| P0       | Test harness with mock model and fixtures | Nothing is verifiable without it          |
| P1       | Direct source-to-IR translation         | Core product behaviour                     |
| P1       | WASM linking and execution with WASI    | Completes the compiler loop                |
| P1       | Compiler error protocol                 | Required compiler behaviour                |
| P1       | Two-stage semantic review               | Required honesty mechanism                 |
| P2       | Read-only IR viewer                     | Core user experience                       |
| P2       | Source-to-IR mapping                    | Distinctive product feature                |
| P3       | Incremental compilation                 | Responsiveness; release requirement        |
| P4       | Optimized IR view                       | Advanced inspection                        |
| P4       | Broader device and model support        | Product maturity                           |

## 11. Key risks and decision gates

### Risk A: LLVM toolchain size and browser compatibility

**Decision gate:** both tracks demonstrate IR verification, code
generation and linking in a browser, with measurements recorded, before
full implementation. D-01 is resolved here.

### Risk B: Local model quality

**Decision gate:** benchmark actual compiler tasks, especially
unfamiliar syntax and incremental changes. Do not select a model by
parameter count or public benchmark ranking.

### Risk C: Incremental translation correctness

**Decision gate:** dependency tracking, span-based splicing and
transactional application must exist, and every fallback path must have
a fixture, before incremental is enabled by default.

### Risk D: Semantic review value

**Decision gate:** measure whether review catches deliberately wrong IR
and how often it rejects correct IR. If it is not better than a coin
flip, say so in the product rather than presenting it as a safeguard.

### Risk E: Hardware variation

**Decision gate:** establish supported device profiles and startup
compatibility checks. Never silently fall back to remote inference.

### Risk F: GitHub Pages limits

**Decision gate:** confirm that the shell fits Pages limits and that
bulk assets load from the external host with correct hashes and caching
before Phase 2 polish.

## 12. Definition of done

The product is ready for its first public release when:

-   It is hosted on GitHub Pages.
-   It requires no application backend or database, and has no
    telemetry.
-   The user supplies code rather than a program-generation prompt.
-   Source can use real, invented, mixed or pseudocode syntax.
-   A local LLM translates source directly into LLVM IR.
-   The LLM returns structured compiler errors rather than asking
    questions.
-   The IR passes the subset checker, the ABI checker and LLVM
    verification.
-   The resulting WASM executes in the browser with working stdin and
    stdout.
-   Semantic review runs independently and the interface uses the
    specified wording.
-   The LLVM IR is visible and read-only.
-   Source-to-IR highlighting works, with unmapped instructions
    distinguished.
-   Incremental edits update the affected IR safely, with full
    recompilation as fallback.
-   All published limits are enforced and reported.
-   The application is responsive.
-   Source code, IR and execution data remain local.
-   The test suite passes in CI without a GPU and without the real
    model.

## 13. First milestone

The first concrete milestone is deliberately small:

**A static GitHub Pages application that loads a local model, accepts
the Fibonacci pseudocode example, generates LLVM IR, passes the subset
and ABI checks, verifies the IR with real LLVM, links it against
`wasi-libc`, executes it in the browser, prints `89`, and shows a
semantic review verdict --- all inside the browser.**

Only after this complete loop works should the project invest in
mapping, incremental compilation and interface polish.
