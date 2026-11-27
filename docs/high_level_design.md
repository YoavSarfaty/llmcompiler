# High-Level Design --- Browser-Based AI Compiler

**Status:** Product and architecture baseline\
**Hosting target:** GitHub Pages\
**Execution model:** Entirely client-side; no application backend

## 0. Document set

| File                        | Role                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `high_level_design.md`      | This document: requirements, vision, UX, architecture      |
| `compiler-specification.md` | Normative compiler, LLM and runtime contracts              |
| `low_level_design.md`       | Components, modules, protocols and state                   |
| `implementation_roadmap.md` | Phases, gates and milestones                               |
| `decisions.md`              | Locked architectural decisions and open questions          |

Where this document states a requirement, `compiler-specification.md`
states the rule that satisfies it. Where the two disagree, the
specification wins on rules and this document wins on product intent.

## 1. Product vision

Build a browser-based programming environment in which a user writes a
program in any language, notation, or programming paradigm and a local
LLM compiles that program directly into LLVM IR.

The product is a compiler, not a chatbot and not a code-generation
assistant.

The user supplies the program. The system does not accept requests to
invent or author a program from a natural-language prompt. The LLM
interprets user-written code and translates it into LLVM IR.

The LLVM IR is visible to the user but is read-only. The user can
inspect how their source corresponds to generated IR, but cannot edit
the IR directly.

The resulting IR is processed by a real LLVM toolchain, compiled to
WebAssembly, and executed locally in the browser.

## 2. Non-negotiable product requirements

1.  **GitHub Pages hosting.** The application is distributed as static
    assets and deployed to GitHub Pages.
2.  **No server-side application.** No application backend, server-side
    inference, server-side compilation, or server-side execution.
3.  **No database.** No application database, accounts, cloud projects,
    or server persistence.
4.  **Browser-only operation.** Model inference, translation,
    verification, compilation, linking, and program execution take place
    on the user's device.
5.  **User-authored input.** The user must enter code. A request such as
    "make me a Fibonacci program" is not a valid program input and must
    produce a source-input error.
6.  **Language agnostic.** The input may use any real or invented
    language, pseudocode, assembly, or a mixture of notations.
7.  **Paradigm agnostic.** Procedural, functional, object-oriented,
    declarative, imperative, and other computational styles are
    acceptable.
8.  **Direct LLM translation.** The LLM translates user code directly
    into LLVM IR. There is no separate user-facing language frontend,
    parser pipeline, or intermediate semantic language between the input
    and LLVM IR.
9.  **Read-only IR.** LLVM IR is visible and inspectable but cannot be
    edited by the user.
10. **Compiler-style behavior.** The LLM does not converse, ask
    questions, or offer suggestions. If it cannot compile the input
    reliably, it returns structured compiler errors.
11. **Incremental responsiveness.** A small source edit must trigger a
    localized update to the corresponding IR rather than regenerating
    the entire module unnecessarily. This is a release requirement, not
    a first-prototype gate (see A-1 below and D-11).
12. **Source-to-IR mapping.** The UI visually links source lines or
    ranges to the LLVM IR instructions they produced, in a
    Compiler Explorer-style experience.
13. **Real compilation and execution.** Generated IR is processed by a
    real LLVM toolchain and compiled to WebAssembly. The browser's
    WebAssembly engine executes the resulting module. How the toolchain
    is packaged for the browser is an implementation choice (A-4).
14. **No generated test suite.** The product does not generate or run
    unit tests as part of the compilation pipeline. Two checks remain:
    LLVM's structural IR verifier, and a separate model-based semantic
    review. This requirement scopes the pipeline only; the project
    itself is tested normally (A-2).
15. **No telemetry.** The application sends no analytics, telemetry,
    crash reports, or diagnostic data anywhere. Source code, IR,
    prompts, and execution output never leave the device, and there is
    no remote inference fallback of any kind.
16. **Explicit limits.** Input size, generated output size, compile
    time, execution time, memory and captured output all have published
    ceilings. Exceeding a limit produces a diagnostic, never a silent
    truncation or a hang.

### 2.1 Amendment log

The original fourteen requirements are preserved. Amendments are
recorded here rather than absorbed silently into the text.

| ID   | Requirement | Kind          | Amendment                                                                 |
| ---- | ----------- | ------------- | ------------------------------------------------------------------------- |
| A-1  | R11         | Clarification | Incremental compilation is required for release; the first end-to-end prototype may compile the full module on every edit. Full recompilation remains the permanent fallback. |
| A-2  | R14         | Clarification | "No generated test suite" prohibits generated tests inside the compilation pipeline. It does not prohibit a conventional test suite for the application, which is now required (D-09). |
| A-3  | R14, §5.4   | Change        | The single self-reported `verification` field is replaced by a second, independent inference stage: generation, then semantic review. The UI reports "Semantic review passed", never "verified" or "correct". |
| A-4  | R13         | Clarification | Whether the toolchain runs as WASI CLI tools or as an in-process library is decided by a Phase 0 comparison (D-01). Both satisfy R13. |
| A-5  | new R15     | Addition      | No telemetry, analytics or remote inference fallback.                     |
| A-6  | new R16     | Addition      | Explicit, published limits with defined failure codes.                    |
| A-7  | R1, R2      | Clarification | The application is distributed on GitHub Pages. Large immutable assets (toolchain, sysroot, model weights) may be served from an external static file host. This introduces no application backend and no upload path (D-07). |

A-3 is the only change to product behaviour. It makes the product
*less* claiming, not more: the earlier design had the model certify its
own output in the same pass, which is not evidence of anything.

## 3. What counts as source code?

The compiler does not require a language selector or a predefined
grammar. It attempts to interpret user-supplied computational code in
its own notation.

Examples of acceptable input styles:

  -----------------------------------------------------------------------
  Style                               Illustrative input
  ----------------------------------- -----------------------------------
  Procedural                          `x = 5; print(x)`

  Functional                          `map(square, numbers)`

  Object-oriented                     `class Dog: ...`

  Pseudocode                          `repeat until x equals 10`

  Assembly                            `MOV RAX, 5`

  Declarative                         `output = sum(numbers)`

  Invented language                   A user-defined syntax expressing
                                      computational logic

  Mixed notation                      Python-like control flow combined
                                      with assembly-like operations
  -----------------------------------------------------------------------

The examples are illustrative, not a promise that every possible
construct can be compiled by every model or target configuration.

LLVM IR text is itself computational input and is therefore valid
source. When the source is already LLVM IR, the compiler still runs the
full pipeline: subset check, structural verification, review, code
generation and linking. The read-only rule (R9) applies to the IR pane
that the compiler produces, not to what the user may type into the
source editor.

A natural-language instruction asking the AI to create a program is not
accepted. The input must itself express a program. If the input is only
a prompt, the compiler returns an error such as:

> Source input error: expected user-written code; received a
> program-generation request.

If the supplied code is ambiguous, incomplete, contradictory, or
unsupported, the compiler returns an error. It does not ask the user a
question and must not silently invent missing semantics.

## 4. Example user experience

A user might enter:

``` text
Make a function called fib:
Takes number x
If x is 0 or 1 return 1
Else return fib of x-1 plus fib of x-2

Ask user "what's you number dude:\n"
Take user input number
Print fib of user input
```

This is treated as a program written in informal pseudocode, not as a
request to generate a program.

The LLM infers the intended function and I/O operations, then emits LLVM
IR. The example's base cases return `1`, so the resulting sequence is
`1, 1, 2, 3, 5, 8, ...`, not the conventional `0, 1, 1, 2, 3, ...`.

The generated IR is displayed read-only. The user can inspect the
correspondence between source statements and IR instructions, compile
the program, provide input in the browser console, and see its output.

## 5. User experience and major features

### 5.1 Source editor

-   Free-form source editor; no required language mode.
-   No language selector.
-   Supports arbitrary text, mixed notation, and invented syntax.
-   Responsive layout for desktop, tablet, and mobile.
-   Source edits are detected and submitted for incremental compilation.
-   Compilation errors are associated with source locations where
    possible.

### 5.2 LLVM IR explorer

-   Displays generated LLVM IR in a read-only view.
-   Provides LLVM syntax highlighting.
-   Supports selection and hover interactions.
-   Highlights corresponding source and IR locations.
-   Shows unmapped compiler-generated instructions distinctly.
-   Offers unoptimized IR as the primary source-mapping view.
-   May offer optimized IR as a separate view, with its own mapping
    limitations.

### 5.3 Semantic source mapping

The interface uses colored highlights to show which source lines or
ranges correspond to which LLVM IR instructions.

Mappings must support:

-   One source statement mapping to multiple IR instructions.
-   Multiple source statements contributing to one IR instruction.
-   Instructions with no direct source counterpart.
-   Instructions that are combined, removed, or transformed during
    optimization.

Hovering over a source range highlights the corresponding IR
instructions. Hovering over an IR instruction highlights its source
range. Clicking can pin a mapping selection.

### 5.4 Compiler diagnostics

The LLM behaves as a compiler component, not a conversational assistant.

It must not:

-   Ask clarifying questions.
-   Generate a program from a request.
-   Offer alternative implementations.
-   Return conversational explanations in place of compiler output.

It must return structured diagnostics when compilation cannot proceed.
Examples include:

-   Source input is a prompt rather than code.
-   Ambiguous operation or type.
-   Missing required information.
-   Contradictory semantics.
-   Unsupported construct.
-   Failed semantic review.
-   Invalid generated LLVM IR.
-   Toolchain or linking failure.

Diagnostics should include stable error codes, source ranges where
possible, concise messages, and optional technical details.

The code set, severity rules and offset conventions are defined
normatively in `compiler-specification.md` §7 and §2.5. One consequence
is worth stating in the product document: when generated IR fails to
parse, there is no reliable source correspondence, so those diagnostics
are shown against the IR pane and are never given a guessed source
range.

### 5.4.1 Semantic review

Compilation has two inference stages. The first translates source to IR.
The second reviews that IR against the source in a separate pass, with
no access to the first stage's reasoning, and returns `pass`, `fail` or
`inconclusive`.

The review does not decide whether the compilation succeeded; LLVM's
structural verifier does that. It decides whether the result may be
executed, and it supplies the label the UI shows.

| Verdict        | Execution | Label                          |
| -------------- | --------- | ------------------------------ |
| `pass`         | enabled   | Semantic review passed         |
| `inconclusive` | enabled   | Semantic review inconclusive   |
| `fail`         | disabled  | Semantic review failed         |
| not run        | disabled  | Semantic review not run        |

The interface must never describe the result as verified, proven or
correct. The review is a model assessment, and the product says so.

### 5.5 Execution console

-   Runs the generated WebAssembly module in the browser.
-   Provides program stdin.
-   Displays stdout and stderr.
-   Displays exit status and runtime errors.
-   Supports execution interruption and resource limits.
-   Implements a capability-restricted WASI subset, so ordinary
    programs using standard I/O and allocation run unmodified.

Execution is bounded: 5 seconds of wall clock, a 256 MiB module memory
ceiling, and 1 MiB of captured output. Interruption terminates the
execution worker, because a running module cannot be pre-empted from
inside.

### 5.6 Incremental compilation

When a user edits a small part of the source:

-   Detect the changed range.
-   Identify the affected function or compilation region.
-   Supply the LLM with the changed source and the relevant existing
    context.
-   Request a localized IR update.
-   Apply the update transactionally.
-   Preserve unaffected IR and mappings.
-   Expand the affected region when dependencies require it.

A change to a function signature, global declaration, or shared type may
require updates to callers or dependent code. "Incremental" must not
mean ignoring semantic dependencies.

Obsolete model responses must never overwrite the result of a newer
edit.

The first end-to-end prototype may compile the full module on every
edit. That is a scheduling decision, not a reduction in scope: a
localized update that preserves unaffected IR is still required before
release, and full recompilation remains the permanent fallback whenever
the affected region cannot be proven. The patch format, splice rules and
fallback behaviour are specified in `compiler-specification.md` §4.8.

## 6. High-level architecture

``` text
                  GitHub Pages
                       |
             Static application assets
                       |
                Browser application
                       |
       +---------------+----------------+
       |               |                |
   Source editor   IR explorer      Console/UI
       |               |                |
       +---------------+----------------+
                       |
              Local compilation state
                       |
                Local LLM worker
                       |
          User source -> LLVM IR directly
                       |
          IR + mapping + diagnostics
                       |
             LLVM toolchain worker
                       |
       Parse -> Verify -> Optimize (optional)
                       |
                 WASM backend
                       |
                    LLD
                       |
              WebAssembly module
                       |
             Browser WASM runtime
```

The LLM output includes LLVM IR and mapping metadata. There is no
separate semantic intermediate representation or conventional
language-specific frontend.

Semantic review is a second, independent inference call on the same IR.
It runs concurrently with verification, code generation and linking, and
gates execution rather than compilation. It does not feed back into the
IR; it produces a verdict and findings.

The runtime supplies a capability-restricted WASI import set to the
linked module. That is what makes ordinary standard-library calls work
without exposing a filesystem, a network or a thread surface.

## 7. Technology direction

| Concern                            | Preferred technology                                              |
| ---------------------------------- | ---------------------------------------------------------------- |
| Static hosting                     | GitHub Pages (application shell)                                  |
| Bulk asset hosting                 | External static host with long-lived caching and SHA-256 pinning  |
| Build and bundling                 | Vite                                                              |
| Application language               | TypeScript                                                        |
| UI                                 | React                                                             |
| Source editor                      | CodeMirror 6                                                      |
| Local model inference              | WebLLM                                                            |
| Model acceleration                 | WebGPU, where available; single-threaded (no COOP/COEP)           |
| Compiler packaging                 | Two candidates under evaluation: WASI CLI tools, or LLVM as a library (D-01) |
| IR dialect                         | Pinned LLVM release, `wasm32-wasip1`, opaque pointers             |
| Standard library                   | `wasi-libc`, pinned, linked from a versioned sysroot              |
| IR verification and optimization   | LLVM verifier and optimizer                                       |
| WASM code generation               | LLVM WebAssembly backend                                          |
| Linking                            | `wasm-ld` (CLI or in-process LLD), no undefined symbols           |
| Runtime                            | Native browser WebAssembly API plus a capability-restricted WASI subset |
| Background processing              | Web Workers; disposable execution worker                          |
| Application state                  | In-memory state only; no persistent compilation state             |
| Telemetry                          | None                                                              |

The precise model and quantization must be selected through
task-specific benchmarking. Model weights must have a license compatible
with the intended distribution and use.

## 8. Security and privacy

-   Source code remains in the browser.
-   No source code, IR, model prompts, or execution output is sent to an
    application server.
-   No telemetry, analytics, crash reporting or remote inference
    fallback exists. There is no back channel of any kind.
-   No account or authentication system.
-   No application database.
-   The program executes in a WebAssembly sandbox, with only the
    explicitly provided WASI import allowlist. There is no filesystem,
    no network and no thread capability.
-   Runtime resource limits and interruption are required.
-   Large immutable assets (toolchain, sysroot, model weights) may be
    fetched from an external static host. That host serves bytes and
    receives no source code or compilation state.
-   Model and compiler assets are version-pinned and verified against
    published SHA-256 hashes before use. A mismatch is fatal.

GitHub Pages is a static distribution host, not a runtime backend. The
same is true of the asset host: it is a file server, not a service.

The absence of telemetry has a deliberate cost. Failures in the field
are invisible to the maintainers, so diagnostics must be complete enough
to act on when a user chooses to share them, and the product must never
depend on remote observation to be debuggable.

## 9. Important limitations and product honesty

The product's language-agnostic goal is ambitious. A finite local model
cannot be guaranteed to understand every invented language or arbitrary
notation.

The compiler must fail explicitly when it cannot infer semantics with
sufficient confidence. It must not claim that model review is a formal
proof.

Three mechanisms with different responsibilities:

-   **Deterministic conformance checks:** confirm that the IR uses the
    pinned dialect and that every runtime call matches the published
    signature.
-   **LLVM structural verification:** confirms that the generated IR is
    valid according to LLVM's rules.
-   **Semantic review:** a separate model pass that assesses whether the
    generated IR plausibly represents the supplied program's intended
    behaviour. It is an assessment, not a proof, and the interface says
    so.

No generated unit-test suite is part of the product. The application
itself has a conventional test suite.

Honest limits that the product must state:

-   Source over 32 KiB, or a program whose IR does not fit the model's
    context, is rejected with a diagnostic. It is never silently
    truncated.
-   Programs are bounded at 5 seconds of execution, 256 MiB of memory
    and 1 MiB of captured output.
-   The supported IR subset excludes exceptions, threads, inline
    assembly and most experimental intrinsics.
-   Undefined behaviour that LLVM does not detect, such as a format
    specifier that does not match its argument width, is not caught by
    any automatic gate.

The browser-only requirement also creates hardware constraints. WebGPU
availability, GPU memory, RAM, model size, and browser support affect
the experience. The application needs a startup compatibility check and
clear errors for unsupported devices. Without cross-origin isolation,
memory measurement is approximate, and the interface must not pretend
otherwise.

## 10. Product definition in one sentence

A fully client-side, language-agnostic AI compiler that translates
user-written code directly into LLVM IR, exposes read-only source-to-IR
mappings, compiles through real LLVM to WebAssembly, and executes
programs locally in the browser.
