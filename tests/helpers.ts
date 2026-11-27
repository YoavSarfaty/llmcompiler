import { readFileSync } from "node:fs";
import { join } from "node:path";

export function fixture(...parts: string[]): string {
  return readFileSync(join(process.cwd(), "fixtures", ...parts), "utf8").replace(/\r\n/g, "\n");
}
