import { expect, test } from "@playwright/test";

test("maps the reference source and IR in both directions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("IR valid", { exact: true })).toBeVisible();
  await expect(page.getByText("Mock review: pass", { exact: true })).toBeVisible();

  const instruction = page.getByRole("button", { name: /Instruction fn:fib#4/ });
  await expect(instruction).toBeVisible();
  await instruction.hover();
  await expect(page.locator(".source-map-active")).toHaveCount(1);
  await instruction.click();
  await page.mouse.move(5, 5);
  await expect(page.locator(".source-map-active")).toHaveCount(1);
});

test("keeps the previous IR marked stale after a failed compile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Generated LLVM IR, read only" })).toBeVisible();

  await page.getByRole("textbox").fill("Make me a Fibonacci program.");
  await expect(page.getByText("Compilation failed", { exact: true })).toBeVisible();
  await expect(page.getByText("stale · previous successful IR", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Generated LLVM IR, read only" })).toContainText("define i64 @fib");
  await expect(page.getByRole("button", { name: "Run" })).toBeDisabled();
});

test("uses switchable editor panels on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("region", { name: "Generated LLVM IR, read only" })).toBeHidden();
  await page.getByRole("button", { name: "LLVM IR" }).click();
  await expect(page.getByRole("textbox")).toBeHidden();
  await expect(page.getByRole("region", { name: "Generated LLVM IR, read only" })).toBeVisible();
});

test("resizes the desktop panes with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const divider = page.getByRole("separator", { name: "Resize source and LLVM IR panels" });
  await divider.focus();
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", String(before + 5));
});

test("supports keyboard interaction with console diagnostics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("Make me a Fibonacci program.");
  await expect(page.getByText("Compilation failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Console" }).click();

  const promptDiagnostic = page.getByRole("button", { name: /E001/ });
  await promptDiagnostic.focus();
  await page.keyboard.press("Enter");
  const log = page.getByRole("log");
  await expect(log).toContainText("E001");

  await page.getByRole("button", { name: "Clear console output" }).click();
  await expect(log).toBeEmpty();
});
