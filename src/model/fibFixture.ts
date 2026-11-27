/**
 * The reference program (roadmap §3.2) and the IR a conforming
 * generation must produce.
 *
 * The IR is kept in sync with fixtures/ir/fib.ll; a unit test asserts
 * they are identical, so the browser mock and the on-disk fixture cannot
 * drift.
 */

export const FIB_SOURCE = `Make a function called fib:
Takes number x
If x is 0 or 1 return 1
Else return fib of x-1 plus fib of x-2

Ask user "what's you number dude:\\n"
Take user input number
Print fib of user input
`;

export const FIB_IR = `@.prompt = private unnamed_addr constant [26 x i8] c"what's your number dude:\\0A\\00", align 1
@.infmt = private unnamed_addr constant [5 x i8] c"%lld\\00", align 1
@.outfmt = private unnamed_addr constant [6 x i8] c"%lld\\0A\\00", align 1

declare i32 @printf(ptr, ...)
declare i32 @scanf(ptr, ...)

define i64 @fib(i64 %x) {
entry:
  %is0 = icmp eq i64 %x, 0
  %is1 = icmp eq i64 %x, 1
  %base = or i1 %is0, %is1
  br i1 %base, label %ret.one, label %recurse

ret.one:
  ret i64 1

recurse:
  %a = sub i64 %x, 1
  %fa = call i64 @fib(i64 %a)
  %b = sub i64 %x, 2
  %fb = call i64 @fib(i64 %b)
  %sum = add i64 %fa, %fb
  ret i64 %sum
}

define i32 @main() {
entry:
  %buf = alloca i64, align 8
  %p = call i32 (ptr, ...) @printf(ptr @.prompt)
  %r = call i32 (ptr, ...) @scanf(ptr @.infmt, ptr %buf)
  %n = load i64, ptr %buf, align 8
  %f = call i64 @fib(i64 %n)
  %o = call i32 (ptr, ...) @printf(ptr @.outfmt, i64 %f)
  ret i32 0
}
`;

export function rangeOf(source: string, needle: string): { from: number; to: number } {
  const from = source.indexOf(needle);
  if (from === -1) {
    return { from: 0, to: 0 };
  }
  return { from, to: from + needle.length };
}
