import { describe, expect, it } from "vitest";

import { extractSandboxId } from "./i3_orchestrator_crash.js";

describe("extractSandboxId", () => {
  it("returns sandbox id from stdout chunk", () => {
    expect(extractSandboxId("foo SANDBOX_ID=sbx_123-abc bar")).toBe("sbx_123-abc");
  });

  it("returns null when chunk does not contain the marker", () => {
    expect(extractSandboxId("no marker here")).toBeNull();
  });
});
