# Implementation Roadmap --- Browser-Based AI Compiler

**Goal:** Deliver a language-agnostic, browser-only AI compiler hosted
on GitHub Pages.

## 1. Delivery strategy

Build the project in vertical slices, proving the most technically
uncertain parts early.

The highest-risk requirement is running a real LLVM toolchain entirely
in the browser. Prove that before investing heavily in the UI or
incremental AI workflow.

The second major risk is whether a small quantized local model can
reliably translate unfamiliar user-written code directly into LLVM IR.

No server, backend, database, account system, or generated test suite is
included in the plan.

## 2. Phase 0 --- Technical feasibility spikes

**Objective:** Establish that the two core technologies work within the
browser constraints.

### Work items

1.  Create a minimal Vite + TypeScript project.
2.  Create a GitHub Pages deployment workflow.
3.  Build or obtain a reproducible browser-compatible LLVM toolchain.
4.  Parse and verify a small LLVM IR module in the browser.
5.  Compile the IR to a WebAssembly module.
6.  Link the module with a minimal custom runtime ABI.
7.  Execute the module using the browser's native WebAssembly API.
8.  Load WebLLM in a dedicated worker.
9.  Run a small local instruction model on a supported WebGPU device.
10. Measure model and compiler memory use, startup time, and asset
    sizes.

### Exit criteria

-   A static GitHub Pages deployment works.
-   No application server is used.
-   A real LLVM toolchain processes LLVM IR in the browser.
-   A generated WASM module executes in the browser.
-   Local LLM inference works without a remote inference endpoint.

### Go/no-go decision

Do not proceed to the full product implementation until both the
LLVM-in-browser and local-model feasibility spikes have succeeded.

If the LLVM build is impractical, revisit the exact toolchain packaging
and build configuration before considering alternatives to real LLVM.

## 3. Phase 1 --- Minimal end-to-end compiler

**Objective:** Demonstrate the central product idea.

### Work items

1.  Build a minimal source editor using CodeMirror 6.
2.  Add a local WebLLM worker.
3.  Define a strict, versioned JSON compiler response schema.
4.  Implement prompt-only input rejection.
5.  Instruct the LLM to translate supplied code directly into LLVM IR.
6.  Include semantic verification in the LLM compilation contract.
7.  Parse and verify returned IR using LLVM.
8.  Compile verified IR to WASM.
9.  Implement the custom runtime ABI.
10. Add a basic browser console with input, output, errors, and exit
    status.

### Initial demonstration program

Use the Fibonacci example:

``` text
Make a function called fib:
Takes number x
If x is 0 or 1 return 1
Else return fib of x-1 plus fib of x-2

Ask user "what's you number dude:\n"
Take user input number
Print fib of user input
```

The compiler must interpret this as user-supplied pseudocode.

The base cases return `1`; therefore input `10` produces `89`.

### Exit criteria

A user can enter the example, obtain LLVM IR from the local model, have
LLVM verify and compile it, enter `10` in the console, and see `89`.

A request such as `Make me a Fibonacci program` must produce a
source-input error rather than generated code.

## 4. Phase 2 --- Product interface

**Objective:** Turn the prototype into a usable compiler playground.

### Work items

1.  Implement responsive desktop and mobile layouts.
2.  Add a read-only LLVM IR viewer.
3.  Add LLVM syntax highlighting.
4.  Add compiler diagnostics with source locations.
5.  Add loading and compilation states.
6.  Add execution status and runtime error display.
7.  Add resizable desktop panels.
8.  Add mobile source/IR tabs and a console drawer.
9.  Add model loading and hardware compatibility screens.
10. Ensure inference and compilation never block the UI thread.

### Exit criteria

The interface is usable on desktop and mobile, with source editing, IR
inspection, diagnostics, and execution.

The LLVM IR cannot be edited by the user.

## 5. Phase 3 --- Source-to-IR mapping

**Objective:** Implement the Compiler Explorer-style visual feature.

### Work items

1.  Define the mapping metadata schema.
2.  Require the LLM to return source ranges and corresponding IR
    references.
3.  Establish stable instruction identifiers scoped to functions and
    compilation versions.
4.  Validate mapping references against the generated IR.
5.  Implement source editor decorations.
6.  Implement IR viewer decorations.
7.  Implement source-to-IR hover synchronization.
8.  Implement IR-to-source hover synchronization.
9.  Implement click-to-pin mapping selection.
10. Visually distinguish unmapped and uncertain instructions.

### Exit criteria

A user can hover over a source statement and see its corresponding LLVM
instructions highlighted, and vice versa.

The mapping supports one-to-many and many-to-many relationships.

### Important implementation note

Start with unoptimized IR. Optimization can change instruction
identities and relationships. An optimized view can be added separately
after the primary mapping experience works.

## 6. Phase 4 --- Incremental compilation

**Objective:** Make source edits feel immediate.

### Work items

1.  Use CodeMirror transactions to detect changed ranges.
2.  Add debouncing for bursts of typing.
3.  Introduce document versions and request IDs.
4.  Store the last successful source, IR, mappings, and dependency
    information in memory.
5.  Identify affected functions or regions.
6.  Send incremental compilation requests to the LLM.
7.  Define an IR patch response schema.
8.  Apply patches transactionally.
9.  Update only affected mappings.
10. Reject stale responses.
11. Expand recompilation to dependent functions when necessary.
12. Fall back to full translation when a safe localized update cannot be
    determined.

### Demonstration

Original:

``` text
return fib(x-1) + fib(x-2)
```

Edited:

``` text
return fib(x-1) + fib(x-3)
```

Expected behavior: - Detect the changed source range. - Send the changed
function and relevant context to the local model. - Update the affected
LLVM instructions. - Preserve unaffected module content. - Refresh the
relevant mapping. - Avoid applying obsolete inference responses.

### Exit criteria

A local edit updates only the affected IR region when safe. Changes with
broader dependencies trigger the required expanded update or full
compilation.

## 7. Phase 5 --- Reliability and compatibility

**Objective:** Make the compiler robust across supported devices and
inputs.

### Work items

1.  Benchmark candidate quantized local models.
2.  Evaluate known-language, pseudocode, assembly, mixed-notation, and
    invented-syntax examples.
3.  Evaluate semantic preservation and structured error compliance.
4.  Add bounded internal repair for invalid generated IR.
5.  Add explicit error categories and stable error codes.
6.  Add compilation timeouts and cancellation.
7.  Add execution time and resource limits.
8.  Check browser and WebGPU compatibility.
9.  Provide smaller-model options for constrained devices.
10. Measure memory use and download size.
11. Pin compiler and model versions.
12. Validate static deployment paths and asset integrity.

### Exit criteria

The application reports unsupported or ambiguous inputs honestly, does
not silently change program semantics, and does not hang the editor or
browser when inference or execution takes too long.

No generated unit-test suite is introduced. LLVM structural verification
and LLM semantic verification remain the compilation checks.

## 8. Phase 6 --- Release preparation

**Objective:** Publish a reproducible, self-contained static
application.

### Work items

1.  Finalize the GitHub Actions deployment workflow.
2.  Configure Vite's GitHub Pages base path.
3.  Version compiler and model assets.
4.  Document model downloads and license requirements.
5.  Document browser and hardware requirements.
6.  Confirm no source or IR is uploaded.
7.  Confirm there is no application backend or database.
8.  Verify the application works from the deployed GitHub Pages URL.
9.  Provide a clear first-run model download experience.
10. Document known limitations of local inference and semantic
    verification.

### Exit criteria

The application can be deployed and used from GitHub Pages without
operating an application server.

## 9. Suggested repository structure

``` text
ai-compiler/
  public/
    assets/
      llvm/
      runtime/
  src/
    app/
    editor/
    ir/
    compiler/
    workers/
    runtime/
    model/
    types/
  scripts/
    build-llvm-wasm/
    package-assets/
  docs/
    high-level-design.md
    low-level-design.md
    implementation-roadmap.md
  .github/
    workflows/
      deploy.yml
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

Large model weights need not live in the Git repository. They can be
fetched as static assets and cached locally by the browser. This does
not require a backend, but the distribution source and model license
must be documented.

## 10. Prioritization

  -----------------------------------------------------------------------
  Priority                Work                    Why
  ----------------------- ----------------------- -----------------------
  P0                      LLVM compiled for       Fundamental feasibility
                          browser                 

  P0                      Local WebLLM inference  Fundamental privacy and
                                                  deployment requirement

  P1                      Direct source-to-IR     Core product behavior
                          translation             

  P1                      WASM linking and        Completes the compiler
                          execution               loop

  P1                      Compiler error protocol Required compiler
                                                  behavior

  P2                      Read-only IR viewer     Core user experience

  P2                      Source-to-IR mapping    Distinctive product
                                                  feature

  P3                      Incremental compilation Responsiveness and
                                                  usability

  P4                      Optimized IR view       Advanced inspection
                                                  feature

  P4                      Broader device/model    Product maturity
                          support                 
  -----------------------------------------------------------------------

## 11. Key risks and decision gates

### Risk A: LLVM toolchain size and browser compatibility

**Decision gate:** Demonstrate IR verification, WebAssembly code
generation, and linking in a browser before full implementation.

### Risk B: Local model quality

**Decision gate:** Benchmark actual compiler tasks, especially
unfamiliar syntax and incremental changes. Do not select a model solely
by parameter count.

### Risk C: Incremental translation correctness

**Decision gate:** Ensure dependency tracking and transactional updates
exist before enabling localized patches by default. Fall back to full
compilation whenever necessary.

### Risk D: Semantic verification limitations

**Decision gate:** Keep model verification distinct from LLVM structural
verification. Never label an LLM assessment as a formal proof.

### Risk E: Hardware variation

**Decision gate:** Establish supported device profiles and clear startup
compatibility checks. Never silently fall back to remote inference.

## 12. Definition of done

The product is ready for its first public release when:

-   It is hosted on GitHub Pages.
-   It requires no application backend or database.
-   The user supplies code rather than a program-generation prompt.
-   The source can use real, invented, mixed, or pseudocode syntax.
-   A local LLM translates source directly into LLVM IR.
-   The LLM returns structured compiler errors rather than asking
    questions.
-   LLVM verifies and compiles the generated IR.
-   The resulting WASM executes in the browser.
-   The LLVM IR is visible and read-only.
-   Source-to-IR highlighting works.
-   Incremental edits update affected IR safely.
-   The application is responsive.
-   Source code, IR, and execution data remain local.

## 13. First milestone

The first concrete milestone should be deliberately small:

**A static GitHub Pages application that loads a local model, accepts
the Fibonacci pseudocode example, generates LLVM IR, verifies it with
real LLVM, compiles it to WASM, and executes it in the browser.**

Only after this complete loop works should the project invest in
advanced mapping, incremental compilation, and interface polish.
