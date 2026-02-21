import type { AllResult } from "../types.js";
import { runI1 } from "./i1.js";
import { runI2 } from "./i2.js";
import { runI3 } from "./i3.js";

export async function runAll(): Promise<AllResult> {
  const i1 = await runI1();
  const i2 = await runI2(10);
  const i3 = await runI3();
  return { i1, i2, i3 };
}
