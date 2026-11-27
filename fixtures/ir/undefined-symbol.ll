define i32 @main() {
entry:
  %result = call i32 @missing_function()
  ret i32 0
}
