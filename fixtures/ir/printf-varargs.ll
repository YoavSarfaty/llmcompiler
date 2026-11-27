@.fmt = private unnamed_addr constant [4 x i8] c"%d\0A\00", align 1

declare i32 @printf(ptr, ...)

define i32 @main() {
entry:
  %result = call i32 (ptr, ...) @printf(ptr @.fmt, i32 7)
  ret i32 0
}
