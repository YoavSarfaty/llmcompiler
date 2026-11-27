# High-Level Design --- Browser-Based AI Compiler

**Status:** Product and architecture baseline\
**Hosting target:** GitHub Pages\
**Execution model:** Entirely client-side; no application backend

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
11. **Incremental responsiveness.** A small source edit should trigger a
    localized update to the corresponding IR as quickly as practical,
    rather than regenerating the entire module unnecessarily.
12. **Source-to-IR mapping.** The UI visually links source lines or
    ranges to the LLVM IR instructions they produced, in a Compiler
    Explorer-style experience.
13. **Real compilation and execution.** Generated IR is processed by a
    real LLVM toolchain and compiled to WebAssembly. The browser's
    WebAssembly engine executes the resulting module.
14. **No generated test suite.** The product does not generate or run
    unit tests as part of compilation. The LLM performs semantic
    verification. LLVM's structural IR verifier remains part of the
    compiler pipeline.

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

It must not: - Ask clarifying questions. - Generate a program from a
request. - Offer alternative implementations. - Return conversational
explanations in place of compiler output.

It must return structured diagnostics when compilation cannot proceed.

Examples include: - Source input is a prompt rather than code. -
Ambiguous operation or type. - Missing required information. -
Contradictory semantics. - Unsupported construct. - Failed semantic
verification. - Invalid generated LLVM IR. - Toolchain or linking
failure.

Diagnostics should include stable error codes, source ranges where
possible, concise messages, and optional technical details.

### 5.5 Execution console

-   Runs the generated WebAssembly module in the browser.
-   Provides program stdin.
-   Displays stdout and stderr.
-   Displays exit status and runtime errors.
-   Supports execution interruption and resource limits.
-   Uses a small custom runtime interface for common I/O operations.

### 5.6 Incremental compilation

When a user edits a small part of the source: - Detect the changed
range. - Identify the affected function or compilation region. - Supply
the LLM with the changed source and the relevant existing context. -
Request a localized IR update. - Apply the update transactionally. -
Preserve unaffected IR and mappings. - Expand the affected region when
dependencies require it.

A change to a function signature, global declaration, or shared type may
require updates to callers or dependent code. "Incremental" must not
mean ignoring semantic dependencies.

Obsolete model responses must never overwrite the result of a newer
edit.

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

## 7. Technology direction

  Concern                            Preferred technology
  ---------------------------------- --------------------------------------
  Static hosting                     GitHub Pages
  Build and bundling                 Vite
  Application language               TypeScript
  UI                                 React
  Source editor                      CodeMirror 6
  Local model inference              WebLLM
  Model acceleration                 WebGPU, where available
  Compiler                           Custom browser-compatible LLVM build
  IR verification and optimization   LLVM tools
  WASM code generation               LLVM WebAssembly backend
  Linking                            LLD / `wasm-ld`
  Execution                          Native browser WebAssembly API
  Background processing              Web Workers
  Application state                  In-memory state only

The precise model and quantization must be selected through
task-specific benchmarking. Model weights must have a license compatible
with the intended distribution and use.

## 8. Security and privacy

-   Source code remains in the browser.
-   No source code, IR, model prompts, or execution output is sent to an
    application server.
-   No account or authentication system.
-   No application database.
-   The program executes in a WebAssembly sandbox, with only explicitly
    provided host imports.
-   Runtime resource limits and interruption are required.
-   Third-party asset hosting, if used for model or compiler downloads,
    must not receive source code or compilation state.
-   Model and compiler assets should be version-pinned and
    integrity-checked.

GitHub Pages is a static distribution host, not a runtime backend.

## 9. Important limitations and product honesty

The product's language-agnostic goal is ambitious. A finite local model
cannot be guaranteed to understand every invented language or arbitrary
notation.

The compiler must fail explicitly when it cannot infer semantics with
sufficient confidence. It must not claim that LLM verification is a
formal proof.

Two verification mechanisms have different responsibilities:

-   **LLM semantic verification:** assesses whether the generated IR
    represents the supplied program's intended behavior.
-   **LLVM structural verification:** checks whether the generated IR is
    valid according to LLVM's IR rules.

No generated unit-test suite is part of the product.

The browser-only requirement also creates hardware constraints. WebGPU
availability, GPU memory, RAM, model size, and browser support affect
the experience. The application needs a startup compatibility check and
clear errors for unsupported devices.

## 10. Product definition in one sentence

A fully client-side, language-agnostic AI compiler that translates
user-written code directly into LLVM IR, exposes read-only source-to-IR
mappings, compiles through real LLVM to WebAssembly, and executes
programs locally in the browser.
