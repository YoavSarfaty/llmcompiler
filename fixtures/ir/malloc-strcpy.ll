@.src = private unnamed_addr constant [6 x i8] c"hello\00", align 1
@.fmt = private unnamed_addr constant [4 x i8] c"%s\0A\00", align 1

declare ptr @malloc(i32)
declare ptr @strcpy(ptr, ptr)
declare i32 @printf(ptr, ...)
declare void @free(ptr)

define i32 @main() {
entry:
  %buf = call ptr @malloc(i32 16)
  %copy = call ptr @strcpy(ptr %buf, ptr @.src)
  %r = call i32 (ptr, ...) @printf(ptr @.fmt, ptr %copy)
  call void @free(ptr %buf)
  ret i32 0
}
