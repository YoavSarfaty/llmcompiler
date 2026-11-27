# Low-Level Design --- Browser-Based AI Compiler

**Status:** Proposed engineering design\
**Architecture:** Static browser application, local inference, local
LLVM toolchain

## 1. Design principles

1.  The user's source text is the source of truth.
2.  The LLM is the language frontend and emits LLVM IR directly.
3.  No conventional language-specific parser or separate semantic IR is
    inserted between source and LLVM IR.
4.  LLVM IR is visible but read-only.
5.  All application processing occurs locally in the browser.
6.  The LLM returns machine-readable compiler results, never
    conversational responses.
7.  Incremental updates preserve unaffected IR where safe.
8.  Source mapping is a first-class compilation artifact.
9.  LLVM structural verification is mandatory before code generation.
10. No generated unit tests are used as a compilation stage.

## 2. Runtime components

### 2.1 Main application

Responsibilities: - Render the responsive UI. - Own the source
document. - Display diagnostics and compilation state. - Coordinate
workers. - Manage compilation versions and cancellation. - Display
source-to-IR mappings. - Manage the execution console.

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
  compiler/
    CompilerCoordinator.ts
    CompilationState.ts
    IncrementalPlanner.ts
    ResultValidator.ts
    Diagnostics.ts
    MappingStore.ts
  workers/
    llm.worker.ts
    llvm.worker.ts
    execution.worker.ts
  runtime/
    WasmRunner.ts
    RuntimeABI.ts
    Terminal.ts
  model/
    ModelManager.ts
    ModelCapabilities.ts
  types/
    protocol.ts
    compilation.ts
```

This is a proposed organization, not a requirement to create every file
in the first prototype.

### 2.2 LLM worker

Responsibilities: - Initialize the local model. - Check model/runtime
compatibility. - Receive source and compilation context. - Generate LLVM
IR directly. - Generate source mapping metadata. - Perform semantic
self-verification. - Return structured success or error results. -
Handle cancellation and stale requests.

The worker must not access a network service to perform inference.

### 2.3 LLVM worker

Responsibilities: - Load the browser-compatible LLVM toolchain. - Parse
textual LLVM IR. - Run LLVM's verifier. - Optionally optimize IR. -
Generate WebAssembly object code. - Link the final module. - Return
compiler diagnostics and the resulting WASM bytes.

The toolchain must be compiled for browser execution. The exact build
and supported LLVM utilities are an implementation proof-of-concept
item.

### 2.4 Execution worker

Responsibilities: - Instantiate WebAssembly modules. - Supply the custom
runtime ABI. - Capture standard output and error. - Accept program
input. - Return exit status. - Enforce resource limits and interruption.

The execution worker must not have access to the editor's internal state
or arbitrary application storage.

## 3. Data contracts

All worker messages should be versioned and validated at runtime.

### 3.1 Compilation request

``` json
{
  "protocolVersion": 1,
  "requestId": "request-unique-id",
  "documentVersion": 12,
  "mode": "full",
  "source": "user-authored program",
  "previous": null,
  "changedRanges": [],
  "dependencies": [],
  "target": {
    "triple": "wasm32-unknown-unknown"
  }
}
```

For incremental requests, `mode` is `incremental`, and `previous`
contains the current successful compilation snapshot and relevant
IR/mapping context.

The target triple is illustrative. The final target and ABI must be
selected consistently with the LLVM build and runtime design.

### 3.2 Successful LLM response

``` json
{
  "protocolVersion": 1,
  "requestId": "request-unique-id",
  "documentVersion": 12,
  "status": "success",
  "ir": "define i64 @fib(i64 %x) { ... }",
  "mappings": [
    {
      "semanticId": "fib.base-case",
      "sourceRanges": [
        { "from": 20, "to": 57 }
      ],
      "irReferences": [
        { "function": "fib", "block": "entry", "instructionId": "inst-1" },
        { "function": "fib", "block": "entry", "instructionId": "inst-2" }
      ]
    }
  ],
  "dependencies": [],
  "verification": {
    "semantic": "passed"
  },
  "diagnostics": []
}
```

The example uses illustrative identifiers. The implementation must
define stable instruction identity and source-range conventions. Textual
LLVM instruction positions alone are fragile because instructions move
when IR is regenerated.

### 3.3 Error response

``` json
{
  "protocolVersion": 1,
  "requestId": "request-unique-id",
  "documentVersion": 12,
  "status": "error",
  "diagnostics": [
    {
      "code": "E001",
      "category": "semantic",
      "severity": "error",
      "message": "Ambiguous operation",
      "details": "Cannot determine the semantics of '+'",
      "sourceRanges": [
        { "from": 42, "to": 47 }
      ]
    }
  ]
}
```

Suggested error categories:

  Code   Category       Meaning
  ------ -------------- ---------------------------------------------
  E001   Source         Input is a request rather than code
  E002   Semantic       Ambiguous operation
  E003   Semantic       Missing required information
  E004   Semantic       Contradictory semantics
  E005   Unsupported    Unsupported construct
  E006   Verification   LLM semantic verification failed
  E007   IR             LLVM IR parsing or verification failed
  E008   Compilation    Code generation failed
  E009   Linking        WASM linking failed
  E010   Runtime        Program execution failed
  E011   Environment    Insufficient browser or hardware capability
  E012   Internal       Model or compiler internal failure

Error codes and messages should be stable and independent of the UI
framework.

## 4. LLM compilation contract

### 4.1 Input interpretation

The LLM receives user-authored source code. The source may be: - A known
programming language. - Pseudocode. - Assembly. - A functional,
procedural, object-oriented, or declarative notation. - An invented
language. - Mixed syntax.

No language selector is required.

The LLM must distinguish executable program content from a
natural-language request to create a program. A prompt-only input is
rejected.

### 4.2 Direct LLVM generation

The LLM generates LLVM IR directly from the source. It may use private
reasoning internally, but the application pipeline must not introduce a
separate semantic IR or language-specific frontend.

The LLM response includes: - Complete LLVM IR for full compilation, or a
well-defined patch for incremental compilation. - Source-to-IR mapping
metadata. - Semantic verification status. - Structured diagnostics.

### 4.3 No conversational behavior

The LLM must never: - Ask the user a question. - Request
clarification. - Offer suggestions. - Generate missing program code on
behalf of the user. - Return conversational prose instead of the
response schema.

If semantics cannot be determined, it returns an error.

### 4.4 Semantic verification

The LLM must inspect its generated IR against the supplied source and
assess whether it preserved: - Control flow. - Data flow. - Function
behavior. - Types and conversions. - Side effects. - Input/output
behavior. - Error and termination behavior where specified.

This is model-based verification, not a formal proof. The UI must not
imply mathematical certainty.

### 4.5 Prompt-only input detection

A request such as:

``` text
Make me a Fibonacci program.
```

must return a source-input error.

A program such as:

``` text
function fib(x):
    if x == 0 or x == 1:
        return 1
    return fib(x-1) + fib(x-2)
```

is valid input, even though it is pseudocode.

The distinction is whether the user's input itself expresses
computational logic, not whether it follows a known grammar.

## 5. Incremental compilation

### 5.1 Goals

A small source edit should cause a localized LLM operation and localized
IR update.

The application should not request a full-module translation for every
keystroke.

### 5.2 Change detection

CodeMirror transactions provide document changes. The application: 1.
Records changed ranges. 2. Debounces bursts of typing. 3. Assigns a
monotonically increasing document version. 4. Identifies the containing
function or relevant source region when possible. 5. Uses known
dependencies to expand the affected region. 6. Sends an incremental
request to the LLM worker.

### 5.3 Incremental request context

Provide: - Current source snapshot. - Changed ranges and new source
text. - Previous successful LLVM IR. - Relevant function or module
context. - Existing mapping metadata. - Known dependencies. - Current
document version.

Do not send only the changed line if its semantics depend on
declarations, types, callers, or other code.

### 5.4 Patch response

An incremental response should identify: - The IR functions or regions
to replace. - The new instructions or blocks. - Mappings to add, update,
or remove. - Dependencies changed by the edit. - Whether the change
requires a larger recompilation region.

The application applies patches transactionally. It must never leave a
half-updated module visible as a successful compilation.

### 5.5 Stale response handling

Every request has a request ID and document version.

If a response belongs to an older document version: - Do not apply it to
the current document. - Discard it or retain it only as non-current
diagnostic information. - Ensure the newest requested compilation
remains authoritative.

Cancellation should be attempted when a new edit supersedes an in-flight
request.

### 5.6 Dependency expansion

Examples of edits that can affect more than one function: - Function
signature changes. - Global variable or constant changes. - Shared type
changes. - Calling convention changes. - Changes to shared runtime
declarations.

The incremental planner must expand the affected compilation region when
required. If it cannot safely determine the affected region, it should
request a full translation rather than apply an unsafe patch.

## 6. Source-to-IR mapping

### 6.1 Mapping model

Mapping metadata is returned alongside IR.

A mapping contains: - Stable semantic ID. - Source document ranges. -
LLVM function identity. - Basic block identity. - Stable instruction
identity. - Optional mapping confidence or provenance.

Mappings are many-to-many.

### 6.2 UI behavior

-   Hover source: highlight corresponding IR.
-   Hover IR: highlight corresponding source.
-   Click source: pin corresponding IR highlights.
-   Click IR: pin corresponding source highlights.
-   Unmapped instructions: show a distinct neutral style.
-   Missing or uncertain mappings: do not fabricate a relationship.

### 6.3 Instruction identity

Do not rely exclusively on line numbers in textual IR. Line numbers
change when IR is regenerated.

Use stable IDs supplied by the LLM and validated by the application,
with references scoped to the relevant function and compilation version.

If the LLVM toolchain transforms instructions, mapping data must be
updated or marked unavailable. It is preferable to show unoptimized IR
as the primary mapping view.

### 6.4 Optimized IR

Optimization may: - Remove instructions. - Combine operations. - Inline
functions. - Reorder instructions. - Transform control flow.

The optimized view should be separate from the primary source-mapping
view. Do not imply that original one-to-one mappings survive
optimization.

## 7. LLVM toolchain design

### 7.1 Required capabilities

The browser-compatible toolchain needs: - LLVM IR parsing. - LLVM
structural verification. - Optional LLVM optimization. - WebAssembly
code generation. - WebAssembly linking.

Potential utilities include LLVM IR parsing/verifier libraries, `opt`,
`llc`, and `wasm-ld`.

### 7.2 Build strategy

Build a pinned LLVM version from the official `llvm-project` source.
Enable the WebAssembly target and only the utilities needed by the
product.

Compile the required tools and dependencies for execution in the
browser, using an appropriate WebAssembly toolchain and compatible
system interfaces.

Do not assume that an ordinary native LLVM binary can run in a browser.
This is a dedicated toolchain port.

The archived YoWASP Clang project should not be adopted as a
foundational dependency for a new product.

### 7.3 Compiler pipeline

``` text
LLM-generated LLVM IR
        |
        v
LLVM IR parser
        |
        v
LLVM verifier
        |
        +---- invalid ----> structured compiler error
        |
        v
Optional optimization
        |
        v
LLVM WebAssembly backend
        |
        v
Object file
        |
        v
wasm-ld
        |
        v
WASM module
```

The LLVM verifier is not a generated test suite. It validates IR
structure and consistency.

### 7.4 Target and ABI

The initial target should be a clearly defined WebAssembly target, such
as `wasm32-unknown-unknown`, paired with a custom runtime ABI.

The exact target triple, data layout, calling conventions, stack setup,
memory model, and linker flags must be validated together.

Avoid assuming that ordinary desktop libc functions are available.
Runtime functions must be explicitly provided or linked from a
browser-compatible library.

## 8. Runtime ABI and execution

### 8.1 Initial runtime functions

A small custom ABI can expose operations such as:

``` text
print_string(pointer, length)
print_integer(value)
read_string(buffer, capacity)
read_integer()
exit(status)
```

The exact signatures must be defined in a shared ABI specification and
implemented consistently in LLVM declarations and JavaScript imports.

### 8.2 Execution lifecycle

1.  Receive a successfully linked WASM module.
2.  Create an execution instance in a dedicated worker.
3.  Supply approved runtime imports.
4.  Connect stdin to the UI.
5.  Capture stdout and stderr.
6.  Report exit code and runtime errors.
7.  Release execution resources.

### 8.3 Safety limits

-   Execution time limit.
-   User-triggered interruption.
-   Memory limit where enforceable.
-   Controlled imports only.
-   No arbitrary network access from the compiled program.
-   No access to application source state.
-   No unrestricted browser storage access.

WebAssembly provides a sandbox, but host imports determine what a
program can actually do. Keep the import surface minimal.

## 9. Local model management

### 9.1 WebLLM

Use WebLLM as the first local inference engine to evaluate because it
supports browser inference, WebGPU acceleration, and worker-based
execution.

### 9.2 Model selection

Do not hard-code a model based only on parameter count or benchmark
marketing.

Benchmark candidate quantized instruction/code models on: - Known
language translation. - Pseudocode translation. - Assembly
interpretation. - Mixed notation. - Invented syntax. - LLVM IR
validity. - Semantic preservation. - Incremental patch quality. -
Structured error compliance. - Latency and memory usage.

Model weights and model licenses must be evaluated separately from the
inference engine license.

### 9.3 Device capability

At startup: - Detect WebGPU availability. - Check model compatibility. -
Check available memory where practical. - Select an appropriate model
variant. - Report unsupported configurations clearly.

Do not silently send source code to a remote inference endpoint as a
fallback.

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
-   Model loading.
-   Ready.
-   Compiling.
-   Compilation error.
-   IR verified.
-   Linking.
-   Ready to execute.
-   Running.
-   Execution completed.
-   Runtime error.
-   Device unsupported.

## 11. Storage and network boundaries

No application database or backend is present.

In-memory state includes: - Current source. - Current successful IR. -
Mapping metadata. - Dependency information. - Compilation versions. -
Diagnostics. - Current WASM module and execution state.

Browser-managed caching may be used for model and compiler assets. This
is not an application database. If the product requirement is
interpreted as prohibiting all persistent browser storage, disable
caching and accept repeated downloads.

Permitted network activity is limited to downloading static application,
model, and compiler assets. No source code, generated IR, or runtime
data may be uploaded.

## 12. Error handling

Errors must be structured, versioned, and tied to the relevant source or
compilation stage.

The UI should distinguish: - Source interpretation errors. - Semantic
verification errors. - LLVM IR errors. - Toolchain errors. - Linker
errors. - Runtime errors. - Hardware and browser compatibility errors.

Automatic repair of malformed generated IR may be attempted internally
with bounded retries. It must not become a user-facing conversation. If
repair fails, return a compiler error.

Do not retry indefinitely.

## 13. Key technical risks

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Model cannot understand arbitrary   Explicit errors; benchmark diverse
  syntax                              inputs

  Model invents semantics             Require semantic verification; fail
                                      on uncertainty

  LLM produces invalid IR             LLVM verifier; bounded internal
                                      repair

  Browser LLVM build is too large     Minimal build; measure download and
                                      memory

  GPU memory insufficient             Model compatibility checks and
                                      smaller variants

  Incremental patch is incomplete     Dependency expansion and
                                      transactional updates

  Mapping becomes stale               Versioned stable IDs and mapping
                                      validation

  Runtime hangs                       Dedicated worker, timeout,
                                      interruption

  Mobile performance is poor          Responsive UI and hardware-aware
                                      model selection
  -----------------------------------------------------------------------

## 14. Acceptance criteria for the first complete implementation

-   The application is deployed successfully on GitHub Pages.
-   No application backend is required.
-   A local model can be loaded and run in a supported browser.
-   User-authored pseudocode can be translated directly to LLVM IR.
-   Prompt-only input returns a compiler error.
-   The LLVM IR is read-only.
-   LLVM structurally verifies generated IR.
-   The browser-compatible LLVM toolchain produces a WASM module.
-   The browser executes the module with working stdin/stdout.
-   Source and IR highlights are synchronized.
-   A local source edit can update only the affected IR region when
    dependencies permit.
-   Stale compilation responses cannot overwrite newer source versions.
-   Unsupported hardware produces a clear compatibility error.
