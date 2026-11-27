# Compiler Specification --- Browser-Based AI Compiler

**Status:** Normative, draft 1.0\
**Applies to:** the compilation pipeline, the LLM contract, and the runtime\
**Depends on:** `decisions.md` (D-01 through D-15)

## 0. Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in
RFC 2119.

This document specifies *rules*. Mechanisms live in
`low_level_design.md`; product requirements live in
`high_level_design.md`. Where this document and a design document
disagree, this document wins.

Illustrative examples are marked **Example**. Anything not marked as an
example is normative.

### 0.1 Version identifiers

Every artifact carries explicit versions. They are independent and MUST
not be conflated.

| Identifier        | Meaning                                        | Bumped when                                  |
| ----------------- | ---------------------------------------------- | -------------------------------------------- |
| `specVersion`     | This document                                  | Any normative rule changes                   |
| `protocolVersion` | Worker message envelope                       | Message shape changes                        |
| `abiVersion`      | Runtime import surface (D-03, D-04)           | Import set, memory or entry conventions change |
| `irSubsetVersion` | Supported IR subset (D-05)                    | Allowed/forbidden IR changes                 |
| `promptVersion`   | Generation prompt and its examples             | Prompt text or examples change               |
| `reviewPromptVersion` | Review prompt                              | Review prompt changes                        |
| `schemaVersion`   | LLM response schema                            | Response fields change                       |
| `toolchainVersion`| LLVM + wasi-libc build                        | Toolchain rebuilt                            |

Version numbers are integers. A change that only adds an optional field
is a minor change and increments by one; a change that removes or
reinterprets a field is a major change and increments by one hundred.
Consumers MUST reject unknown major versions.

## 1. Compilation model

### 1.1 Stages

The pipeline has ten stages. Each has a defined input, output and
failure code. Stages marked *blocking* prevent a successful compilation;
non-blocking stages produce advisory results only.

| #  | Stage                | Input              | Output                          | Failure | Blocking |
| -- | -------------------- | ------------------ | ------------------------------- | ------- | -------- |
| S0 | Intake               | source text        | validated source, ranges        | E014    | yes      |
| S1 | Generation           | source + context   | IR text, mappings, diagnostics  | E001--E006, E014, E015, E019 | yes |
| S2 | Normalization        | IR text            | canonical IR text + warnings    | ---     | no       |
| S3 | Conformance          | canonical IR       | subset and ABI violations       | E017, E018 | yes   |
| S4 | Parse                | canonical IR       | module, IR diagnostics          | E007    | yes      |
| S5 | Structural verify    | module             | verifier result                 | E007    | yes      |
| S6 | Optimize (optional)  | module             | optimized module                | E007    | yes      |
| S7 | Codegen              | module             | object bytes                    | E008    | yes      |
| S8 | Link                 | object + sysroot   | `.wasm` bytes, link diagnostics | E009    | yes      |
| S9 | Semantic review      | source + IR        | verdict, findings               | E006, E015 | no       |
| S10| Execution            | `.wasm` + stdin    | stdout, stderr, exit status     | E010    | no       |

S9 is dispatched as soon as S2 completes and runs concurrently with
S3--S8. Its verdict gates execution (S10), not compilation. A review
result that arrives for an IR which failed S3--S8 is discarded.

**Example.** A compile that passes S0--S8 but whose review returns
`fail` is a *successful compilation* with execution disabled. A compile
that passes S0--S2 and fails S4 is a *failed compilation*; review output
for it is discarded.

### 1.2 Authority model

The application tracks four independent versions per document:

-   `sourceVersion` --- increments on every accepted editor transaction.
-   `irVersion` --- increments when a new IR is accepted past S5.
-   `moduleVersion` --- increments when a new `.wasm` is produced by S8.
-   `reviewVersion` --- increments when a verdict for that IR arrives.

Rules:

1.  The IR pane MUST display the IR of the highest `irVersion` whose
    `sourceVersion` equals the current `sourceVersion`. If none exists,
    the pane shows the last IR for an older version, clearly marked
    *stale*, or is empty on first run.
2.  Execution MUST be disabled unless `moduleVersion` corresponds to the
    current `sourceVersion`.
3.  A result whose `documentVersion` is less than the current
    `sourceVersion` MUST NOT be applied to the visible artifact. It MAY
    be retained as non-current diagnostic history.
4.  A failed compile MUST NOT clear the last successful IR. It is shown
    as stale, with diagnostics attached to the failing version.
5.  If S8 fails but S5 passed, the IR is still displayed (rule 1) and
    execution is disabled.

**Example.** IR verifies; linking fails with `E009`. The IR pane shows
the new IR; the console shows the link diagnostic; Run is disabled. The
previous executable module is not offered, because its source version is
no longer current.

## 2. Source contract

### 2.1 Valid source

Source is valid if it expresses computation, in any notation. Validity
is about content, not syntax or familiarity.

Valid:

-   A program in a known language.
-   Pseudocode with control flow, assignment, calls, or I/O.
-   Assembly-like notation.
-   A declarative expression.
-   An invented or mixed notation that encodes computation.
-   LLVM IR text (it is computation; see D-14 for the product surface).

Invalid:

-   A request to create, design, explain, or improve a program.
-   Natural-language prose with no computational content.
-   Empty or whitespace-only input.

### 2.2 Prompt-only rejection

The generator MUST return `E001` when the input is a request rather than
a program. Signals, in priority order:

1.  The text asks the system to produce code, rather than containing
    code ("make me", "write a program", "generate", "can you build").
2.  There is no operator, assignment, control-flow keyword, call,
    declaration, or literal that expresses computation.
3.  The only imperative content addresses the assistant ("please",
    "I want you to").

A single heuristic MUST NOT be decisive on its own. The generator is
instructed to prefer `E001` over guessing when both readings are
plausible, and MUST NOT invent a program to satisfy a request.

**Example.** `Make me a Fibonacci program.` → `E001`. `function fib(x):
if x < 2 return 1 else return fib(x-1)+fib(x-2)` → valid.

### 2.3 Ambiguity

If the source is incomplete, contradictory, or ambiguous in a way that
changes behaviour, the generator MUST return a diagnostic and MUST NOT
choose silently:

| Situation                                    | Code |
| -------------------------------------------- | ---- |
| Operation or type genuinely ambiguous        | E002 |
| Required information absent (e.g. no input source for a read) | E003 |
| Two statements contradict each other         | E004 |
| Construct is outside the supported subset    | E005 |

Choosing an interpretation is permitted only when one reading is
overwhelmingly conventional *and* the choice does not change observable
behaviour. The generator SHOULD record such choices as a note in
`diagnostics` with severity `info`.

**Example.** `Takes number x` is ambiguous between integer and float.
For the reference program it is resolved to `i64` because the source
performs exact integer comparisons and prints an integer; the resolution
is recorded as `info`, not as an error.

### 2.4 Input limits

| Limit        | Value  | Code |
| ------------ | ------ | ---- |
| Source bytes | 32 KiB | E014 |
| Source lines | 4,096  | E014 |

Measured on the UTF-8 encoding of the exact editor contents, before any
normalization. Exceeding a limit is a diagnostic, never a truncation.

### 2.5 Encoding and offsets

-   Source is stored and compared as the exact string the user typed.
    No trimming, no newline normalization, no BOM removal. A leading BOM
    is a character like any other: it is part of the source, offsets
    include it, and it is reported as `W005` only as a hint that the
    document may have been pasted from an editor that adds one.
-   All `sourceRanges` are half-open intervals `{ from, to }` in
    **UTF-16 code units**, indexing the exact source string, with `from`
    inclusive and `to` exclusive.
-   A range MUST NOT split a surrogate pair. The application validates
    this and rejects the mapping, not the compilation (`W001`).
-   `from` MUST be less than or equal to `to`. Both MUST be within
    `[0, source.length]`.
-   Ranges MAY overlap and MAY be empty (`from == to`), which denotes a
    point such as a missing token.
-   Display positions are derived by the application. The wire format
    carries no line/column numbers, because they are ambiguous with
    respect to tab width and newline style.

**Example.** For the source `x = 5\nprint(x)`, the range for `x = 5` is
`{from: 0, to: 5}` and the range for `print(x)` is `{from: 6, to: 14}`.

## 3. LLVM contract

### 3.1 Target

-   Triple: `wasm32-wasip1` (the spelling used by the pinned LLVM
    release; `wasm32-wasi` is the pre-19 alias).
-   Data layout: the exact string emitted by the pinned toolchain for
    that triple. It is **injected by the application** and is not taken
    from model output.
-   Pointer width 32, `size_t` and `long` are 32-bit (ILP32). Generated
    IR MUST use `i32` for sizes, indices, `argc`, and `size_t`-typed
    arguments, and `i64` only for explicitly 64-bit values.

### 3.2 Dialect

-   Textual `.ll` form only. Bitcode is not accepted from the model.
-   Opaque pointers only. `ptr` is the only pointer type. Typed pointers
    (`i32*`, `[4 x i8]*`) are an `E018` subset violation.
-   Every `alloca`, `load` and `store` MUST carry an explicit `align`.
-   Calls to variadic functions MUST use the explicit function type at
    the call site: `call i32 (ptr, ...) @printf(ptr %fmt)`.
-   Named and unnamed SSA values are both permitted. Unnamed values are
    function-local.
-   No `target datalayout` or `target triple` line is required from the
    model. If present, the application replaces it and emits `W002`.

### 3.3 Module structure

A module MUST satisfy:

1.  Exactly one definition of `i32 @main()` or `i32 @main(i32, ptr)`.
2.  No definition of `_start`, `__wasm_call_ctors`, or any symbol
    beginning with `__` that belongs to the startup or libc surface.
3.  No definition of a symbol that ABI v1 resolves from the sysroot
    (e.g. `malloc`, `printf`). Redeclaration with the canonical
    signature is permitted; definition is not.
4.  All called functions are either defined in the module or declared
    with a signature matching the canonical table in §3.5.
5.  At most one definition per symbol; no `comdat` beyond
    `any`/`exactmatch` on private data.

### 3.4 Supported IR subset

`irSubsetVersion` 1. The application enforces this before parsing, so
that violations produce `E018` with a precise location instead of an
opaque verifier error.

**Permitted**

-   Integer types `i1`, `i8`, `i16`, `i32`, `i64`. `i128` is forbidden:
    it requires a wasm feature the build does not enable.
-   `float` and `double`. `half` is forbidden: it requires the wasm fp16
    feature, which is not enabled.
-   `ptr`, and aggregate types `[N x T]`, `{...}` for named structs and
    literal structs, `<N x T>` vectors up to 128 bits.
-   Instructions: `alloca`, `load`, `store`, `getelementptr`, `icmp`,
    `fcmp`, `phi`, `select`, `br`, `switch`, `ret`, `unreachable`,
    `call`, `cast` family (`trunc`, `zext`, `sext`, `fptrunc`, `fpext`,
    `fptoui`, `fptosi`, `uitofp`, `sitofp`, `ptrtoint`, `inttoptr`,
    `bitcast`), integer arithmetic (`add`, `sub`, `mul`, `udiv`,
    `sdiv`, `urem`, `srem`), bitwise (`shl`, `lshr`, `ashr`, `and`,
    `or`, `xor`), floating arithmetic (`fadd`, `fsub`, `fmul`, `fdiv`,
    `frem`, `fneg`), `extractvalue`, `insertvalue`,
    `extractelement`, `insertelement`, `shufflevector`.
-   Global variables and constants, `private`/`internal` linkage for
    string data, `unnamed_addr`, `constant`.
-   `llvm.memcpy`, `llvm.memmove`, `llvm.memset`, `llvm.lifetime.*`,
    `llvm.fabs`, `llvm.sqrt`, `llvm.floor`, `llvm.ceil`,
    `llvm.trunc`, `llvm.copysign`, `llvm.minnum`, `llvm.maxnum`,
    `llvm.smax`, `llvm.smin`, `llvm.umax`, `llvm.umin`,
    `llvm.expect`.
-   `@llvm.global_ctors` / `@llvm.global_dtors`, which the startup
    objects invoke.

**Forbidden**

-   Typed pointers.
-   Inline assembly (`asm`, `callbr`).
-   Exception handling: `invoke`, `landingpad`, `resume`,
    `catchswitch`, `cleanupret`, `unwind`.
-   Atomics other than `monotonic` ordering, and any `syncscope` beyond
    `singlethread`.
-   `thread_local` globals; `wasi-threads` constructs.
-   `gc`, `prefix`, `prologue`, `personality`, `byval` beyond a single
    pointer-sized aggregate, `sret` beyond the canonical form.
-   `llvm.experimental.*`, `llvm.coro.*`, `llvm.stackrestore`,
    `llvm.returnaddress`, `llvm.frameaddress`, `llvm.eh.*`.
-   Modules, `dso_local` on undefined symbols, `dllimport`/`dllexport`.
-   Functions with more than 1,024 basic blocks or 65,536 instructions
    (resource guard, `E014`).

### 3.5 Runtime declarations

These are the canonical signatures for ABI v1. Sizes are ILP32. A
declaration that differs in any parameter or return type is `E017`.
The application supplies this block to the generator as a fixed prelude
and checks it after generation.

```llvm
declare ptr  @malloc(i32)
declare ptr  @calloc(i32, i32)
declare ptr  @realloc(ptr, i32)
declare void @free(ptr)

declare ptr  @memcpy(ptr, ptr, i32)
declare ptr  @memmove(ptr, ptr, i32)
declare ptr  @memset(ptr, i32, i32)

declare i32  @strlen(ptr)
declare i32  @strcmp(ptr, ptr)
declare i32  @strncmp(ptr, ptr, i32)
declare ptr  @strcpy(ptr, ptr)
declare ptr  @strncpy(ptr, ptr, i32)
declare ptr  @strcat(ptr, ptr)
declare ptr  @strchr(ptr, i32)

declare i32  @printf(ptr, ...)
declare i32  @fprintf(ptr, ptr, ...)
declare i32  @snprintf(ptr, i32, ptr, ...)
declare i32  @puts(ptr)
declare i32  @putchar(i32)
declare i32  @getchar()
declare i32  @scanf(ptr, ...)
declare ptr  @fgets(ptr, i32, ptr)

declare i32  @atoi(ptr)
declare i32  @strtol(ptr, ptr, i32)
declare i64  @strtoll(ptr, ptr, i32)
declare double @strtod(ptr, ptr)

declare void @exit(i32)
declare void @abort()

declare double @sqrt(double)
declare double @fabs(double)
declare double @pow(double, double)
declare double @floor(double)
declare double @ceil(double)
declare double @fmod(double, double)
declare double @sin(double)
declare double @cos(double)
declare double @exp(double)
declare double @log(double)

@stdin  = external global ptr
@stdout = external global ptr
@stderr = external global ptr
```

Notes:

-   `long` and `size_t` are 32-bit; `strtol` returns `i32`, `strtoll`
    returns `i64`.
-   `%d` reads/writes 32 bits; `%lld` reads/writes 64 bits. The
    generator MUST match the format specifier to the argument width.
    A mismatch is undefined behaviour and is not detected by LLVM; the
    review stage is the only check.
-   `main` MUST return `i32`; a non-zero value becomes the exit status.
    Falling off the end of `main` is `ret i32 0` semantically, but the
    generator SHOULD emit an explicit `ret`.

### 3.6 Linking

Normative flags for ABI v1:

```text
wasm-ld
  --entry=_start
  -z stack-size=1048576
  --max-memory=268435456
  --gc-sections
  --strip-debug
  --error-limit=20
  -L<sysroot>/lib/wasm32-wasip1
  <sysroot>/lib/wasm32-wasip1/crt1.o      # or crt1-command.o, per the pinned sysroot
  <object>
  -lc -lm
```

Rules:

-   `--allow-undefined` MUST NOT be used. An unresolved symbol is
    `E009`.
-   The memory MUST be created and exported by the linker; the module
    MUST NOT import memory.
-   `-O0` is the default for the mapping view. `-O2` is used only for
    the optional optimized view.
-   Linking MUST be deterministic: identical IR, identical flags and
    identical sysroot produce byte-identical output. The name section is
    retained (`--strip-debug`, not `--strip-all`) so that trap messages
    name functions; determinism is asserted by hashing the output in the
    golden fixtures.
-   Imported functions are exactly those in ABI v1 §7.1. Any other
    import is `E017`.

### 3.7 Toolchain diagnostics

The application converts toolchain output into the structured
diagnostic form in §5.7, with:

-   `code` from the failure table,
-   `details` carrying the raw tool text,
-   `irRanges` where the tool reports a line and column.

**Limitation (normative).** If the module fails to parse (S4), there are
no instruction identities and therefore no source mapping. Such
diagnostics carry `irRanges` only and MUST NOT be given a
`sourceRanges` guess. The UI shows them against the IR pane, not the
source pane.

## 4. LLM contract

### 4.1 Prompt architecture

The generation prompt is assembled from fixed, versioned sections. Each
section has an ID so that a recorded response can be traced to the
prompt that produced it.

| Section | Content                                                        |
| ------- | -------------------------------------------------------------- |
| `P-ROLE` | Compiler component framing; no conversation, no questions     |
| `P-SRC` | Source contract: valid input, prompt-only rejection, ambiguity |
| `P-IR`  | Target triple, dialect rules, supported subset, forbidden list |
| `P-ABI` | The §3.5 declaration block, verbatim                          |
| `P-OUT` | Response schema, mapping rules, error protocol                 |
| `P-EX`  | Few-shot examples (valid compile, `E001`, `E002`, `E018`)      |
| `P-REQ` | The actual request: source, ranges, context, versions          |

The assembled prompt MUST be reproducible from `promptVersion` plus the
request. No section may be edited independently of a version bump.

### 4.2 Generation output

The generator MUST return exactly one JSON object conforming to
`schemaVersion` 1. No prose, no markdown fences, no commentary before or
after.

```json
{
  "protocolVersion": 1,
  "schemaVersion": 1,
  "requestId": "req-7f3a",
  "documentVersion": 12,
  "status": "success",
  "ir": "define i64 @fib(i64 %x) { ... }",
  "mappings": [
    {
      "semanticId": "fib.base-case",
      "sourceRanges": [{ "from": 41, "to": 62 }],
      "irRefs": [
        { "function": "fib", "anchor": "ret i64 1" }
      ],
      "confidence": "high"
    }
  ],
  "dependencies": {
    "functions": ["fib", "main"],
    "globals": [".prompt", ".infmt", ".outfmt"],
    "runtime": ["printf", "scanf"]
  },
  "notes": [
    {
      "code": "N001",
      "severity": "info",
      "message": "'Takes number x' resolved to i64",
      "sourceRanges": [{ "from": 28, "to": 41 }]
    }
  ],
  "diagnostics": []
}
```

Error form:

```json
{
  "protocolVersion": 1,
  "schemaVersion": 1,
  "requestId": "req-7f3a",
  "documentVersion": 12,
  "status": "error",
  "diagnostics": [
    {
      "code": "E002",
      "severity": "error",
      "message": "Ambiguous operation",
      "details": "Cannot determine the semantics of '+' for the operand types present",
      "sourceRanges": [{ "from": 42, "to": 47 }]
    }
  ]
}
```

Field rules:

-   `status` is `success` or `error`; there is no third value.
-   `ir` is present if and only if `status` is `success`. It MUST be a
    complete module for a full request, or a patch object for an
    incremental request (§4.6).
-   `mappings` is present when `status` is `success`; it MAY be empty,
    in which case the UI shows every instruction as unmapped. An empty
    mapping set is not an error.
-   `diagnostics` is always present, possibly empty. A `success`
    response MAY carry `warning` or `info` diagnostics.
-   `notes` is optional and never gates anything.
-   Unknown fields MUST be ignored, not rejected, so that a newer model
    behaviour does not break an older client.

### 4.3 Mapping rules

The model supplies *anchors*, not numeric instruction indices, because
ordinals are error-prone and change when the model reformats.

-   `semanticId` --- a stable, human-meaningful identifier, unique
    within the response. Recommended shape:
    `<function>.<concept>[.<n>]`.
-   `sourceRanges` --- one or more half-open UTF-16 ranges (§2.5).
-   `irRefs` --- one or more references, each `{ function, anchor }`
    where `anchor` is the instruction text as it appears in the emitted
    IR, without leading whitespace and without a label prefix.
-   `confidence` --- `high`, `medium` or `low`.

Resolution and validation:

1.  The application parses the module, then resolves each anchor by
    scanning the named function's body for an instruction whose
    normalized text equals the anchor. Normalization collapses runs of
    whitespace and ignores comments.
2.  If an anchor matches more than one instruction, the application
    resolves to the first unmatched occurrence in module order.
3.  If an anchor does not resolve, that single `irRef` is dropped and
    `W001` is emitted. The mapping is not fabricated and the
    compilation is not failed.
4.  After resolution the application assigns stable instruction
    identities of the form `fn:<function>#<ordinal>` scoped to
    `irVersion`. These identities are application-owned and are what the
    UI uses; they never appear in model output.
5.  The application computes the unmapped set itself: any instruction
    with no resolved mapping is *compiler-generated* and is styled
    distinctly. The model MUST NOT claim coverage it does not have.
6.  Mappings are many-to-many. One source range MAY map to many
    instructions and one instruction MAY be referenced by many mappings.

**Example.** The reference program's base case maps one source range to
one `ret`, while the recursive call maps one source range to `sub`,
`call`, `sub`, `call` and `add`.

### 4.4 Review output

The review stage receives the source, the exact generated IR, and the
generation's own `notes`. It MUST NOT receive the generation's
reasoning. It returns:

```json
{
  "protocolVersion": 1,
  "schemaVersion": 1,
  "requestId": "req-7f3a",
  "documentVersion": 12,
  "verdict": "pass",
  "checks": {
    "controlFlow": "pass",
    "dataFlow": "pass",
    "typesAndConversions": "pass",
    "sideEffects": "pass",
    "ioBehaviour": "pass",
    "termination": "pass"
  },
  "findings": []
}
```

Rules:

-   `verdict` is `pass`, `fail` or `inconclusive`. There is no
    `error` status for review; a review that cannot complete returns
    `inconclusive` with a finding, or times out (`E015`, treated as
    `inconclusive`).
-   Each `checks` value is `pass`, `fail` or `unknown`.
-   A `fail` verdict MUST have at least one finding with severity
    `error`.
-   Findings reuse the diagnostic shape (§5.7) with codes `E006`.
-   The review MUST NOT propose replacement IR. It judges; it does not
    generate.

### 4.5 Decoding configuration

| Parameter        | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Temperature      | 0                                                    |
| Top-p            | 1.0                                                  |
| Max output tokens| 4,096 (generation), 1,024 (review)                   |
| Stop sequences   | End of JSON object; provider end-of-turn             |
| Structured output| JSON-schema constrained decoding where the runtime and model support it |
| Seed             | Fixed where the runtime supports it                  |

If constrained decoding is unavailable, the application MUST validate
the parsed object against the schema and MUST NOT trust it merely
because it parsed.

### 4.6 Normalization and repair

Before validation, the application applies these normalizations in
order, each of which emits a warning rather than a failure:

| Step                        | Warning |
| --------------------------- | ------- |
| Strip a UTF-8 BOM           | W005    |
| Strip a single markdown code fence (` ```json ... ``` `) | W006 |
| Strip trailing text after the final `}` | W006 |
| Replace a model-supplied `target triple`/`target datalayout` | W002 |
| Replace a model-supplied `declare` that differs from §3.5 | W002 |

Repair policy:

1.  If the object does not parse as JSON, or fails schema validation,
    the application MAY make **one** repair attempt: re-issue the
    request with the same prompt, the model's raw output, and an
    appended instruction to return only the JSON object.
2.  If the repair also fails, the compilation fails with `E019`.
3.  If the IR is present but fails S3--S8, the application MAY make
    **one** repair attempt per failure class, appending the structured
    diagnostic to the prompt. Two attempts total, regardless of class.
4.  Repair MUST NOT become a user-visible conversation. It is silent
    except for a `W007` note recording that it happened.
5.  No retry loop may exceed the timeouts in §8.2.

### 4.7 Error protocol

-   The generator MUST NOT ask a question, request clarification,
    suggest alternatives, or emit prose.
-   When it cannot compile, it MUST return `status: "error"` with at
    least one diagnostic.
-   It MUST prefer an error over inventing semantics.
-   It MUST NOT return a `success` with IR it believes to be
    semantically wrong; that is what the review stage is for, and the
    generator's belief is not a substitute for a diagnostic.

### 4.8 Incremental protocol

An incremental request supplies: current source, changed ranges, the
previous accepted IR, the previous mappings, the previous dependency
set, and the current versions. The response's `ir` field is then a patch
object instead of a module string:

```json
{
  "kind": "patch",
  "replaceFunctions": [
    { "name": "fib", "text": "define i64 @fib(i64 %x) { ... }" }
  ],
  "replaceGlobals": [],
  "addGlobals": [],
  "removeGlobals": [],
  "replaceDeclarations": null,
  "dependencyDelta": { "added": [], "removed": [] }
}
```

`mappings` is not part of the patch object: it stays at the top level of
the response (§4.2), where it replaces the mappings for the affected
functions only.

Rules:

1.  Allowed operations are exactly those in the object. Anything that
    does not fit MUST be expressed as `{ "kind": "full", "ir": "..." }`.
2.  Replacing a function replaces its entire definition, including the
    label set. Unnamed SSA values are function-local, so replacement is
    safe.
3.  A patch MUST NOT rename a global that appears in `removeGlobals`
    without listing the new name in `addGlobals`.
4.  The application splices textually using function and global spans
    recorded by the parser, not by brace counting. Untouched text is
    preserved byte-for-byte.
5.  After splicing, the whole module is re-parsed and re-verified. If
    any stage S3--S8 fails, the patch is discarded, `W008` is emitted,
    and a full compilation is issued. The user sees the full result, not
    the failed patch.
6.  The response's top-level `mappings` replace the mappings for the
    affected functions only. Mappings for untouched functions are
    preserved unchanged, along with their instruction identities.
7.  If the planner cannot identify the affected region with confidence,
    it MUST issue a full request. Dependency expansion is the planner's
    responsibility, not the model's.

### 4.9 Context budget

| Component                     | Budget (tokens) |
| ----------------------------- | --------------- |
| Fixed sections (`P-ROLE`..`P-EX`) | 1,800       |
| Source                        | 6,000           |
| Previous IR and mappings      | 4,000           |
| Reserved for output           | 4,096           |
| Headroom                      | 500             |

If the assembled prompt exceeds the model's context window minus the
reserved output budget, the application MUST fail with `E014` and a
message that states the measured sizes. It MUST NOT truncate source or
IR silently. Source over 32 KiB is rejected earlier (§2.4); this check
covers the case where the fixed sections plus IR do not fit.

The budget above assumes a context window of at least 16,384 tokens.
The minimum supported context is 8,192 tokens, which permits full
compilation only: the previous-IR section is dropped, the fixed sections
are shortened, and incremental mode is disabled. A model with a smaller
window is not supported and is reported as `E011` at the capability
check.

## 5. Verification contract

### 5.1 Three gates

| Gate                     | Nature        | Decides                                  |
| ------------------------ | ------------- | ---------------------------------------- |
| ABI and subset conformance | Deterministic | Whether the IR is admissible at all (E017, E018) |
| LLVM structural verification | Deterministic | Whether the IR is valid LLVM (E007)  |
| Semantic review          | Model-based   | Whether the IR plausibly means what the source says (E006) |

The first two gates are the only ones that can make a compilation
*succeed* or *fail* in the compiler sense. The third gates execution and
sets the honesty label.

### 5.2 Success definition

A compilation is **successful** when stages S0--S8 all pass. Review is
recorded but does not change success.

A compilation is **executable** when it is successful *and* the review
verdict is `pass` or `inconclusive`.

### 5.3 Review semantics

The review checks, and reports per item:

-   **Control flow** --- branches, loops, recursion and returns
    correspond to the source's structure.
-   **Data flow** --- values computed match the source's expressions,
    including operator precedence and evaluation order where observable.
-   **Types and conversions** --- widths, signedness and format
    specifiers are consistent.
-   **Side effects** --- I/O happens in the same order and multiplicity.
-   **I/O behaviour** --- prompts, formats and input consumption match.
-   **Termination** --- the program can terminate, and the exit status
    reflects the source's intent.

The review MUST NOT claim to prove anything. It is a second model's
assessment with a different prompt and no access to the first model's
reasoning.

### 5.4 UI language

Permitted labels:

-   `IR valid` --- structural verification passed.
-   `Semantic review passed` / `failed` / `inconclusive` / `not run`.
-   `Links and runs` / `Link failed` / `Not executable`.

Forbidden labels: `verified`, `correct`, `proven`, `guaranteed`,
`semantically verified`.

### 5.5 Non-guarantees

The application MUST state, in its documentation and in an
about/limitations view, that:

-   The review is a model assessment, not a proof.
-   A passing review does not establish that the IR matches the source
    for inputs outside the reviewed reasoning.
-   Undefined behaviour in the generated IR (for example a format
    specifier that does not match its argument width) is not detected by
    LLVM.

## 6. Runtime contract

### 6.1 Instantiation

1.  The execution worker receives `.wasm` bytes and an ABI version.
2.  It constructs the import object for exactly the ABI v1 allowlist.
3.  If the module imports anything outside the allowlist, instantiation
    is refused with `E017` naming the offending import. The worker MUST
    NOT supply a catch-all stub.
4.  The module's exported `_start` is called exactly once.
5.  `proc_exit` is implemented by throwing a sentinel that carries the
    status; the worker catches it, reports the status, and releases the
    instance.

### 6.2 Import behaviour

| Import              | Behaviour                                                     |
| ------------------- | ------------------------------------------------------------- |
| `fd_write`          | fd 1 appends to stdout, fd 2 to stderr; other fds return `EBADF`; returns bytes written |
| `fd_read`           | fd 0 only, from the line-buffered stdin queue; returns 0 at EOF; other fds return `EBADF` |
| `fd_close`          | `EBADF` for 0/1/2; otherwise `ENOSYS`                         |
| `fd_seek`           | `ESPIPE` for 0/1/2; otherwise `ENOSYS`                        |
| `fd_fdstat_get`     | character-device flags for 0/1/2; otherwise `ENOSYS`          |
| `proc_exit`         | throws the exit sentinel                                      |
| `args_sizes_get` / `args_get` | argv is `["program"]`                               |
| `environ_sizes_get` / `environ_get` | environment is empty                        |
| `clock_time_get`    | realtime and monotonic, milliseconds/nanoseconds as asked     |
| `random_get`        | `crypto.getRandomValues`                                      |
| `poll_oneoff`       | immediate timeout only; `ENOSYS` otherwise                    |

Errors are returned as WASI errno values. The worker MUST NOT throw
across the wasm boundary except for the exit sentinel.

### 6.3 Output and encoding

-   stdout and stderr are decoded as UTF-8 with replacement on invalid
    sequences, and shown with the replacement character visible.
-   Combined capture is capped at 1 MiB. On overflow, capture stops, a
    truncation notice is shown, and the program continues to run until
    it exits or times out. Truncation is reported as `W009`.

### 6.4 Limits and interruption

| Limit                | Value   |
| -------------------- | ------- |
| Wall clock           | 5 s     |
| Linear memory        | 256 MiB (module ceiling) |
| Captured output      | 1 MiB   |
| Instances per run    | 1       |

Because `_start` runs synchronously inside the worker, wall-clock
enforcement is by terminating the worker from the main thread at the
deadline, then creating a fresh worker for the next run. The worker MUST
be treated as disposable; no state survives a run.

### 6.5 Failure mapping

| Condition                          | Code  |
| ---------------------------------- | ----- |
| Trap (`unreachable`, OOB, div by 0)| E010  |
| Non-zero exit                      | not an error; shown as exit status |
| Timeout (worker terminated)        | E010  |
| Memory ceiling exceeded            | E010  |
| Import not in allowlist            | E017  |
| Instantiation failure              | E017  |

## 7. Diagnostic codes

Codes E001--E012 are unchanged from the original low-level design.
E013--E020 are added by this specification. W-codes are non-fatal.

| Code | Severity | Meaning                                                     |
| ---- | -------- | ----------------------------------------------------------- |
| E001 | error    | Input is a request rather than code                         |
| E002 | error    | Ambiguous operation                                         |
| E003 | error    | Missing required information                                |
| E004 | error    | Contradictory semantics                                     |
| E005 | error    | Unsupported construct                                       |
| E006 | error    | Semantic review failed                                      |
| E007 | error    | LLVM IR parsing or structural verification failed           |
| E008 | error    | Code generation failed                                      |
| E009 | error    | Linking failed                                              |
| E010 | error    | Program execution failed                                    |
| E011 | error    | Insufficient browser or hardware capability                 |
| E012 | error    | Model or compiler internal failure                          |
| E013 | error    | Incremental patch rejected (reserved; use W008 in ABI v1)   |
| E014 | error    | Input or output exceeds a documented limit                  |
| E015 | error    | Stage timed out                                             |
| E016 | info     | Cancelled before completion (internal log only; never shown) |
| E017 | error    | ABI or runtime contract violation                           |
| E018 | error    | IR outside the supported subset                             |
| E019 | error    | Model output did not conform to the schema                  |
| E020 | error    | Model unavailable (download failure, device loss)           |
| W001 | warning  | A mapping anchor did not resolve and was dropped            |
| W002 | warning  | Model-supplied target or declaration replaced by canonical  |
| W003 | warning  | Semantic review inconclusive                                |
| W004 | warning  | Compilation used a reduced region (incremental fallback)    |
| W005 | warning  | Leading BOM removed                                         |
| W006 | warning  | Output normalized (fence, trailing text)                    |
| W007 | warning  | A bounded repair attempt was made                           |
| W008 | warning  | Incremental patch discarded; full compilation issued        |
| W009 | warning  | Captured output truncated                                   |
| W010 | warning  | Compilation is stale relative to the current source         |

`E013` is reserved so that a future ABI can distinguish a rejected
patch from a warning. ABI v1 reports patch rejection as `W008` because
the fallback succeeds and the user sees a valid result.

## 8. Timeouts and cancellation

### 8.1 Cancellation

-   A new edit supersedes an in-flight request. The application MUST
    attempt to cancel it (abort the decode loop where the runtime
    supports it, otherwise ignore the result).
-   A cancelled request MUST NOT produce a visible diagnostic. It is
    recorded as `E016` in the internal request log only.
-   Cancellation MUST NOT leave a partially applied patch. Patches are
    applied only after S5.

### 8.2 Timeout values

| Stage            | Timeout |
| ---------------- | ------- |
| Generation       | 180 s   |
| Review           | 120 s   |
| Compile (S3--S8) | 60 s    |
| Execution        | 5 s     |

A generation or review timeout is `E015`; for review it is downgraded to
`inconclusive` (`W003`) because review is non-blocking.

## 9. Normative test vectors

Every vector is a fixture with an expected outcome. A build that
disagrees with any of these is non-conforming.

| ID   | Fixture                          | Expectation                        |
| ---- | -------------------------------- | ---------------------------------- |
| T01  | `ir/hello.ll`                    | verifies, links, prints `hello`    |
| T02  | `ir/fib.ll`                      | verifies, links, stdin `10` → `89` |
| T03  | `ir/malloc-strcpy.ll`            | verifies, links, prints a copy     |
| T04  | `ir/printf-varargs.ll`           | verifies, links, correct output    |
| T05  | `ir/typed-pointer.ll`            | `E018` at the pointer type         |
| T06  | `ir/no-main.ll`                  | `E018` (module structure)          |
| T07  | `ir/undefined-symbol.ll`         | `E009` naming the symbol           |
| T08  | `ir/bad-syntax.ll`               | `E007` with an IR range            |
| T09  | `ir/bad-declaration.ll`          | `E017` naming the symbol           |
| T10  | `model/valid.json`               | parses, maps resolve, review runs  |
| T11  | `model/fenced.json`              | `W006`, then valid                 |
| T12  | `model/not-json.json`            | one repair attempt, then `E019`    |
| T13  | `model/prompt-only.json`         | `E001`                             |
| T14  | `model/bad-anchor.json`          | `W001`, compilation still succeeds |
| T15  | `model/oversized.json`           | `E014`                             |
| T16  | `source/too-large.txt`           | `E014` before generation           |
| T17  | `source/prompt.txt`              | `E001`                             |
| T18  | `exec/infinite-loop.wasm`        | `E010` after 5 s, worker replaced  |
| T19  | `exec/unknown-import.wasm`       | `E017` naming the import           |
| T20  | `exec/flood-output.wasm`         | `W009`, run continues to exit      |

## 10. Change control

1.  A normative change requires a `decisions.md` record and a
    `specVersion` increment.
2.  A change to the ABI, the subset, the schema or either prompt
    requires re-running the model benchmark and the full test-vector
    set.
3.  The specification MUST NOT be amended to describe whatever the
    implementation happens to do. Divergence is a bug in one of the two.
