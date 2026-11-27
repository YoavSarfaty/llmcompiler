@.msg = private unnamed_addr constant [14 x i8] c"hello, world\0A\00", align 1

declare i32 @printf(ptr, ...)

define i32 @main() {
entry:
  %r = call i32 (ptr, ...) @printf(ptr @.msg)
  ret i32 0
}
