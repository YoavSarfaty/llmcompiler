# Decision Log --- Browser-Based AI Compiler

**Status:** Normative record of architectural decisions\
**Scope:** Decisions that constrain implementation\
**Supersedes:** nothing; amends the three design documents by reference

## 0. Purpose and conventions

The design documents describe the product and its architecture. This
document records the decisions that the documents leave open, so that
implementation does not silently redefine the product.

Each decision has:

-   **ID** --- stable identifier, referenced from the other documents.
-   **Status** --- `Decided`, `Under evaluation`, or `Open`.
-   **Decision** --- what was chosen, in one or two sentences.
-   **Rationale** --- why.
-   **Consequences** --- what this commits us to, including costs.
-   **Revisit** --- the condition under which the decision is reopened.

Rules:

1.  A `Decided` item may only be changed by adding a superseding record.
    Records are never edited to say something different; they are marked
    `Superseded by D-xx`.
2.  An `Under evaluation` item has a named evaluation protocol and a
    decision gate. Until the gate passes, implementation must not depend
    on either outcome.
3.  If implementation needs to violate a `Decided` item, that is a
    product change, not an implementation detail. It requires a new
    record and an amendment to `high_level_design.md`.

## 1. Decision index

| ID   | Area                     | Decision                                                                 | Status           |
| ---- | ------------------------ | ------------------------------------------------------------------------ | ---------------- |
| D-01 | Compiler architecture    | Evaluate WASI CLI tools and in-process library as two working prototypes | Under evaluation |
| D-02 | Standard library         | `wasi-libc`, pinned, with a whitelisted symbol surface                   | Decided          |
| D-03 | Runtime ABI              | WASI preview1 subset, capability-restricted, versioned as ABI v1         | Decided          |
| D-04 | Entry, memory, stack     | `_start` entry, `i32 @main`, explicit stack and memory ceilings          | Decided          |
| D-05 | LLVM dialect             | Pinned LLVM release, `wasm32-wasip1`, opaque pointers, supported subset  | Decided          |
| D-06 | Model selection          | Benchmarked candidates; no selection by parameter count                  | Open (gated)     |
| D-07 | Asset distribution       | App on GitHub Pages; large immutable assets on an external static host   | Decided          |
| D-08 | Cross-origin isolation   | No COOP/COEP; single-threaded inference and single-threaded wasm         | Decided          |
| D-09 | Test strategy            | Mock LLM, golden IR fixtures, browser integration tests in CI            | Decided          |
| D-10 | Semantic verification    | Two-stage generation plus independent semantic review                   | Decided          |
| D-11 | Incremental compilation  | Retained product requirement; not a first-prototype prerequisite         | Decided          |
| D-12 | Limits                   | Explicit input, time, memory and output ceilings                         | Decided          |
| D-13 | Privacy posture          | No telemetry, no remote inference fallback, no accounts                  | Decided          |
| D-14 | IR input harness         | Read-only IR in the product; direct IR input available as a dev harness  | Decided          |
| D-15 | Document set             | Five documents with fixed names and cross-references                     | Decided          |

## 2. Decision records

### D-01 --- Compiler architecture: two prototypes, evidence-based choice

**Status:** Under evaluation

**Decision.** Phase 0 builds **two** working browser prototypes and
compares them before either becomes the product toolchain:

-   **Track A --- WASI CLI tools.** `opt`, `llc` and `wasm-ld` built for
    `wasm32-wasip1` and driven from a Web Worker through a WASI shim with
    a virtual filesystem. Diagnostics arrive as tool stderr text and are
    converted into structured records.
-   **Track B --- in-process library.** `libLLVM` plus a thin C driver
    (replacing `llc`) called directly, and `wasm-ld` linked in-process
    through a C shim (LLD's wasm linker has no C API). Diagnostics come
    from the LLVM diagnostic handler and are structured by construction.

A hybrid (library for parse/verify/codegen, CLI `wasm-ld` in a WASI
shim) is permitted as Track B', but must be reported as its own row.

**Rationale.** Track B's structured diagnostics are attractive, but the
engineering cost is not yet known and the browser build of LLD is the
least proven part of the stack. Committing to either approach without a
prototype would be a guess.

**Evaluation protocol.** Both tracks must reach the same observable
contract: textual LLVM IR in, `.wasm` bytes out, per-stage structured
diagnostics, no network, no filesystem outside the virtual one.

| Metric                  | How measured                                                    |
| ----------------------- | --------------------------------------------------------------- |
| Bundle size             | Total transferred bytes, uncompressed and brotli, per track     |
| Cold start              | Time from worker spawn to first successful parse                |
| Compile latency         | Median of 20 runs, IR of 200 lines, `-O0` and `-O2`             |
| Peak memory             | `performance.measureUserAgentSpecificMemory` where available, plus a large-module stress test |
| Diagnostic fidelity     | Percentage of induced failures (bad syntax, type error, undefined symbol, bad flag) that produce a correct structured code and location |
| Implementation effort   | Engineer-days to reach the contract, recorded honestly          |
| Maintenance risk        | Upstream build breakage risk, patch count, ability to bump LLVM |

**Decision gate.** Track selection happens at Phase 0 exit. Default
preference is Track A unless Track B is both clearly better on
diagnostics and within 1.5x of Track A on bundle size and effort.
Track B is rejected outright if it exceeds 15 engineer-days or 40 MB
brotli for the toolchain asset set.

**Consequences.** Two prototypes are built and one is discarded. The
discarded track's findings must still be recorded. Regardless of
outcome, the *user-visible* diagnostic contract is fixed by
`compiler-specification.md`; if Track A wins, stderr parsing becomes a
permanent, version-coupled component and that cost is accepted
explicitly.

**Revisit.** If the chosen track cannot be bumped to a newer LLVM
release within one engineer-week, the decision is reopened.

### D-02 --- Standard library: pinned `wasi-libc`

**Status:** Decided

**Decision.** Generated IR is linked against `wasi-libc`, pinned to a
specific commit alongside the pinned LLVM release, using a prebuilt
wasm32 sysroot distributed as a static asset. Ordinary constructs
(`printf`, `malloc`, `strlen`, `qsort`, `double` math) must work
without special-casing.

The custom-ABI-only design in the original low-level design
(`print_string`, `read_integer`) is **rejected** as the primary
interface. It forced the model to avoid `malloc` and made ordinary
programs impossible.

**Rationale.** The product is a compiler, not a toy. A model that emits
`printf` must succeed, and a model must not need to learn a bespoke
ABI to express basic I/O.

**Consequences.**

-   The target triple becomes WASI-flavoured, not
    `wasm32-unknown-unknown`.
-   The execution worker must implement a WASI subset, not five custom
    functions.
-   The runtime surface grows, so the capability restriction in D-03
    becomes the safety mechanism instead of a tiny ABI.
-   The sysroot is a versioned asset that must match the LLVM release.

**Revisit.** If sysroot size or WASI import complexity proves
unmanageable in Phase 0, a hybrid (libc plus a small `__lc_*` fast path
for I/O) is permitted, but libc must not be removed.

### D-03 --- Runtime ABI: capability-restricted WASI preview1 subset

**Status:** Decided

**Decision.** ABI v1 is the WASI preview1 import surface restricted to
a documented allowlist. Unimplemented imports are not provided at
instantiation; the module fails to instantiate with a structured
`E017` rather than silently trapping later.

Initial allowlist (normative detail in
`compiler-specification.md` §7): `fd_write`, `fd_read`, `fd_close`,
`fd_seek`, `fd_fdstat_get`, `proc_exit`, `args_sizes_get`, `args_get`,
`environ_sizes_get`, `environ_get`, `clock_time_get`,
`random_get`, `poll_oneoff` (immediate-timeout only).

Explicitly excluded: `path_open`, `path_*`, `sock_*`, `proc_raise`,
`proc_spawn`, `proc_fork`, any filesystem capability, any network
capability, `thread_spawn`.

**Rationale.** `wasi-libc` gives ordinary semantics; the capability
allowlist gives a sandbox that is still a sandbox. The two are
independent decisions and must not be conflated.

**Consequences.** A program that tries to open a file gets `ENOSYS` or a
structured runtime error, not a silent success. `stdin`, `stdout` and
`stderr` are pre-opened file descriptors 0, 1, 2 with fixed behaviour.
The ABI is versioned; `abiVersion` appears in every compilation result
and in the runtime handshake.

**Revisit.** Add capabilities only by adding a new ABI minor version.

### D-04 --- Entry, memory and stack conventions

**Status:** Decided

**Decision.**

-   Entry point is `_start`, supplied by `wasi-libc` startup objects.
    Generated IR must define `i32 @main()` or
    `i32 @main(i32, ptr)` and must not define `_start`.
-   `wasm-ld` creates and exports the linear memory. The module may not
    import memory.
-   Stack size is fixed at 1 MiB (`-z stack-size=1048576`).
-   Memory ceiling is 256 MiB (`--max-memory=268435456`), so allocation
    failure happens inside wasm as a trap rather than by killing the
    tab.
-   Undefined symbols are link errors. `--allow-undefined` is
    forbidden.

**Rationale.** The original design left `main` versus `_start`, stack
size and memory limits undefined. Recursion (the reference Fibonacci
program) and `printf` both depend on these being fixed and consistent
between the IR contract, the linker flags and the runtime.

**Consequences.** The Fibonacci reference program needs no stack
special-casing. Deep recursion beyond 1 MiB traps, which is a runtime
error, not a compiler bug. Memory-hungry programs fail predictably.

**Revisit.** Stack size may be raised if benchmarking shows legitimate
programs trapping; the ceiling must remain explicit.

### D-05 --- LLVM dialect: pinned release, `wasm32-wasip1`, opaque pointers

**Status:** Decided (patch release pending D-01 and O-04)

**Decision.** Pin a single LLVM release and use its textual IR dialect:

-   Starting candidate: LLVM 19.1.x (final patch release confirmed at
    Phase 0 exit).
-   Target triple: `wasm32-wasip1` (`wasm32-wasi` is the pre-19 alias;
    the exact spelling follows the pinned release).
-   Data layout and triple are **injected by the application**, never
    trusted from the model.
-   Opaque pointers only (`ptr`). Typed pointers (`i32*`) are rejected
    with `E018`.
-   A supported-subset allowlist is enforced before parsing
    (`compiler-specification.md` §4.4).

**Rationale.** Most instruction-tuned code models were trained on
LLVM 10--15 era IR, which uses typed pointers. Without an explicit
dialect pin and a deterministic checker, the failure mode is opaque
verifier errors that look like model incompetence and are actually a
dialect mismatch.

**Consequences.** The prompt must state the dialect and must include an
example in it. The subset checker is a required component, not an
optimization. Bumping LLVM is a deliberate, tested change.

**Revisit.** Only together with a prompt-version bump and re-run of the
model benchmark.

### D-06 --- Model selection: benchmark, do not assume

**Status:** Open (gated by Phase 5 work item 1)

**Decision.** No model is hard-coded. Selection requires a recorded
benchmark over the compiler task set. Candidate families to evaluate,
subject to license review and the availability of an MLC-compiled
WebLLM artifact:

| Candidate                     | Approx. size | License                 |
| ----------------------------- | ------------ | ----------------------- |
| Qwen2.5-Coder 1.5B / 3B / 7B  | 1.5--7B      | Apache-2.0              |
| Phi-3.5-mini-instruct         | 3.8B         | MIT                     |
| Llama 3.2 3B Instruct         | 3B           | Llama 3.2 Community     |
| Granite Code 3B / 8B          | 3--8B        | Apache-2.0              |
| CodeGemma 2B                  | 2B           | Gemma Terms             |

Preference is given to models with an existing MLC/WebLLM build, to
avoid a conversion pipeline before the product works.

**Rationale.** Model quality on this task is an empirical question; the
task (emit valid LLVM IR in a fixed dialect, in JSON, with mapping
metadata) is unusual enough that public code benchmarks are poor
predictors.

**Consequences.** Phase 0 uses one small candidate purely to prove
inference works. The product must not expose a model picker until the
benchmark is recorded. Quantization is part of the benchmark, not a
constant.

**Revisit.** Any model change re-runs the benchmark and bumps the
prompt version.

### D-07 --- Asset distribution: Pages for the app, external host for bulk

**Status:** Decided

**Decision.** The application shell ships on GitHub Pages. Large
immutable artifacts --- the LLVM toolchain wasm, the wasi sysroot, and
model weights --- are served from an external static host with
long-lived caching and content hashes. No source, IR, or execution data
is ever sent to that host; it serves bytes only.

**Rationale.** Three GitHub Pages constraints make bulk hosting there
impractical:

-   Site size limit of 1 GB and a soft bandwidth limit of about
    100 GB/month. A 20 MB toolchain fetched 5,000 times already
    consumes the monthly budget.
-   GitHub Pages serves with a short cache TTL (about 10 minutes), so
    a repeated visit re-downloads multi-megabyte assets.
-   No custom HTTP headers, so no long-lived `Cache-Control` and no
    COOP/COEP (see D-08).

**Consequences.** The application must work with a configurable asset
base URL, and must verify each fetched artifact against a pinned
SHA-256 before use. The deployment workflow publishes the shell only.
The privacy statement must name the asset host as a static file
server, not a backend.

**Revisit.** If GitHub begins supporting header configuration and
long-lived caching, bulk assets may return to Pages.

### D-08 --- No cross-origin isolation; single-threaded execution

**Status:** Decided

**Decision.** The application does not depend on `SharedArrayBuffer`,
cross-origin isolation, or wasm threads. Inference is single-threaded
on WebGPU. The LLVM toolchain is built without threads. The
`coi-serviceworker` header-injection trick is not used.

**Rationale.** GitHub Pages cannot set COOP/COEP (D-07). A
service-worker shim adds a fragile, opaque failure mode on first load
and breaks in private browsing contexts. The product does not need
parallelism badly enough to pay that cost.

**Consequences.** `wasi-threads` and `thread_spawn` are excluded from
ABI v1. Atomically-ordered operations beyond `monotonic` are not
meaningful and are excluded from the supported subset. Compile latency
is single-core latency; the Phase 0 benchmark must be honest about it.

**Revisit.** If the product moves off GitHub Pages, or if a supported
browser begins offering isolation without headers.

### D-09 --- Test strategy: mock LLM, fixtures, browser integration

**Status:** Decided

**Decision.** The repository has its own test suite. It is unrelated to
the product's "no generated test suite" rule, which governs the
compilation pipeline only.

Required layers:

1.  **Unit tests** --- protocol schema and semantic validation, offset
    arithmetic, subset checker, patch splicer, diagnostic mapping.
2.  **Golden fixtures** --- `fixtures/ir/*.ll` with expected
    parse/verify/link/run outcomes, including deliberately invalid
    inputs.
3.  **Canned model responses** --- `fixtures/model/*.json` covering
    valid output, markdown-fenced output, invalid JSON, typed pointers,
    missing `main`, undefined symbol, oversized source.
4.  **Mock LLM client** --- deterministic, keyed by source hash, used by
    all CI tests. It also exercises the prompt-only rejection path.
5.  **Browser integration tests** --- Playwright on headless Chromium
    against the real toolchain worker and the real execution worker.
    No WebGPU required.
6.  **Manual real-model smoke test** --- recorded in the roadmap, never
    in CI.

CI fetches the pinned toolchain artifact from a release; it never builds
LLVM. Building LLVM is a separate, manually triggered workflow.

**Rationale.** GitHub-hosted runners have no GPU, so the real inference
path cannot run in CI. Without a mock and fixtures, nothing in the
pipeline is verifiable, and toolchain bugs are indistinguishable from
model bugs.

**Consequences.** The mock client is a first-class module with a stable
interface, not a test hack. Every new diagnostic code ships with a
fixture.

**Revisit.** If a GPU-capable runner becomes available, add an optional
nightly job; the mock stays.

### D-10 --- Semantic verification: two stages, never self-certified

**Status:** Decided

**Decision.** Compilation has two inference stages:

1.  **Generation** --- source to LLVM IR, mappings and diagnostics.
2.  **Semantic review** --- source plus the *generated IR* to an
    independent assessment with verdict `pass`, `fail` or
    `inconclusive`, and findings.

The review runs concurrently with subset checking, verification,
codegen and linking. It gates execution, not compilation.

| Review verdict | IR pane            | Execution | UI label                  |
| -------------- | ------------------ | --------- | ------------------------- |
| `pass`         | shown, read-only   | enabled   | Semantic review passed    |
| `inconclusive` | shown, read-only   | enabled   | Semantic review inconclusive |
| `fail`         | shown, read-only   | disabled  | Semantic review failed    |
| timed out      | shown, read-only   | enabled   | Semantic review inconclusive |
| not run        | shown, read-only   | disabled  | Semantic review not run   |

The UI must never say "verified", "proven", or "correct" about the
model's assessment.

**Rationale.** A model certifying its own output in the same pass is not
evidence; the field is decorative. A separate pass with a different
prompt at least removes the trivial self-agreement path.

**Consequences.** Two inference calls per compile, so roughly double
latency. The incremental path must decide whether to re-review a
localized patch (it must, when the patch changes behaviour). The review
prompt and schema are versioned artifacts like the generation prompt.

**Revisit.** If review latency makes the product unusable on target
hardware, make review opt-in and default the label to "not run" --- but
do not merge the two stages back into one.

### D-11 --- Incremental compilation: retained requirement, deferred milestone

**Status:** Decided

**Decision.** Incremental compilation remains a product requirement
(`high_level_design.md` R11). It is **not** a prerequisite for the first
working end-to-end prototype. The first prototype compiles the whole
module on every edit, with debouncing and stale-response rejection.

The incremental protocol is specified now
(`compiler-specification.md` §5.8) but implemented at the milestone
after the end-to-end loop works.

**Rationale.** A one-line edit producing a small, localized IR change
is a defining property of the product and must not be traded away for
convenience. But the patch protocol, dependency tracking and
transactional application are substantial, and they cannot be validated
until a full-module baseline exists to compare against.

**Consequences.** Full recompilation is always the fallback and must
remain permanently available. Incremental is enabled only when the
planner can prove the affected region; otherwise the request is a full
compile. No feature may depend on incremental being available.

**Revisit.** Never for the requirement; the *implementation* order is
revisited at each milestone.

### D-12 --- Limits

**Status:** Decided

**Decision.** The following ceilings are part of the contract and are
shown to the user when exceeded.

| Limit                     | Value      | Failure code |
| ------------------------- | ---------- | ------------ |
| Source size               | 32 KiB     | E014         |
| Source lines              | 4,096      | E014         |
| Generated IR size         | 256 KiB    | E014         |
| Generation output tokens  | 4,096      | E014         |
| Generation timeout        | 180 s      | E015         |
| Review timeout            | 120 s      | E015         |
| Compile timeout           | 60 s       | E015         |
| Execution wall clock      | 5 s        | E010         |
| Execution memory          | 256 MiB    | E010         |
| Captured stdout + stderr  | 1 MiB      | E010 (truncation warning) |
| Debounce interval         | 500 ms     | ---          |

**Rationale.** "Must be defined" appeared throughout the design without
numbers. Without them, the UI cannot report honest errors and the tests
cannot assert behaviour.

**Consequences.** Limits are configuration with the stated defaults,
not magic numbers scattered in code. Exceeding a limit is a compiler
diagnostic, never a silent truncation. Truncated model output must be
detected (unbalanced JSON or unterminated IR) and reported as `E014`,
not as a parse error.

**Revisit.** Values may change with benchmark evidence; the existence of
each limit may not.

### D-13 --- Privacy posture

**Status:** Decided

**Decision.** No telemetry, no analytics, no crash reporting, no remote
inference fallback, no accounts, no cloud project state.

**Rationale.** The product's claim is that source code never leaves the
device. Any telemetry weakens that claim and requires a consent
mechanism that the product otherwise does not need.

**Consequences.** Real-world failures are invisible to the maintainers.
Compensation is explicit and local: diagnostics are copyable, a
"copy diagnostic bundle" action includes version identifiers only (no
source), and the user chooses to share it. Model download and compile
errors must be self-explanatory, because there is no back channel.

**Revisit.** Only with an explicit product decision that changes the
privacy claim; a network "opt-in" is not a neutral addition.

### D-14 --- IR is read-only; direct IR input is a dev harness

**Status:** Decided

**Decision.** In the product, the IR pane is read-only and there is no
way to edit or supply IR. A build-flag-gated developer harness accepts
LLVM IR directly and runs the toolchain and execution path without the
model.

**Rationale.** The read-only requirement (R9) is about the product
surface. The toolchain must be testable and debuggable independently of
model quality, and Phase 0 needs exactly that capability.

**Consequences.** The harness is excluded from production builds and
from the deployed site. It is the primary way to bisect a failure into
"model output" versus "toolchain".

**Revisit.** None.

### D-15 --- Document set

**Status:** Decided

**Decision.** The documentation set is:

| File                            | Role                                              |
| ------------------------------- | ------------------------------------------------- |
| `high_level_design.md`          | Product requirements, vision, UX, architecture    |
| `compiler-specification.md`     | Normative source, LLVM, LLM, review and runtime contracts |
| `low_level_design.md`           | Component and module design, protocols, state     |
| `implementation_roadmap.md`     | Phases, gates, milestones                        |
| `decisions.md`                  | This record                                       |

File names are exactly as above (the roadmap previously listed
hyphenated names). Cross-references use these names.

**Rationale.** A product review found that the compiler contract --- the
part an implementer most needs --- was the least specified. Splitting it
out keeps the normative rules in one place instead of scattered between
a product document and an engineering document.

**Consequences.** Requirements live in the high-level document, rules
live in the specification, and mechanisms live in the low-level design.
A change to a rule is a change to the specification, not to prose in a
design document.

**Revisit.** None.

## 3. Open questions

These are not decisions; they are known gaps that must be closed before
or during Phase 0.

| ID   | Question                                                                 | Needed by        |
| ---- | ------------------------------------------------------------------------ | ---------------- |
| O-01 | Product name and domain label                                            | Phase 6          |
| O-02 | Repository `LICENSE` (code) and model-license documentation              | Phase 1          |
| O-03 | Which model, quantization and prompt version pass the benchmark          | Phase 5          |
| O-04 | Exact LLVM patch release and `wasi-libc` commit                          | Phase 0 exit     |
| O-05 | Supported device matrix: browsers, WebGPU versions, minimum memory       | Phase 5          |
| O-06 | Diagnostic bundle contents and copy-to-clipboard format                  | Phase 2          |
| O-07 | Whether any UI localization is in scope                                  | Phase 6          |
| O-08 | Accessibility target (keyboard-only, screen-reader support for panels)   | Phase 2          |

## 4. Amendments to the product requirements

The requirements in `high_level_design.md` §2 are preserved. The
following amendments are recorded there in full; they are listed here so
that the change history is visible in one place.

| Amendment | Requirement | Kind          | Summary                                                  |
| --------- | ----------- | ------------- | -------------------------------------------------------- |
| A-1       | R11         | Clarification | Incremental is a release requirement, not a prototype gate |
| A-2       | R14         | Clarification | "No generated test suite" scopes the pipeline, not the repo |
| A-3       | R12, §5.4   | Change        | Single self-reported verification replaced by two-stage review |
| A-4       | R13         | Clarification | Toolchain packaging (CLI or library) is an implementation choice |
| A-5       | new R15     | Addition      | No telemetry, analytics or remote fallback                |
| A-6       | new R16     | Addition      | Explicit input, time, memory and output limits            |
| A-7       | R1, R2      | Clarification | App on Pages; bulk immutable assets may use a static CDN  |
