import { describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: {
    list: listMock,
  },
}));

const { findSandboxById, safeKillSandbox } = await import("./sandbox_helpers.js");

function makePaginator(pages: Array<Array<{ sandboxId: string; state?: string }>>) {
  let index = 0;

  return {
    get hasNext() {
      return index < pages.length;
    },
    nextItems: vi.fn(async () => {
      const page = pages[index] ?? [];
      index += 1;
      return page;
    }),
  };
}

describe("safeKillSandbox", () => {
  it("is a no-op for null sandbox", async () => {
    await expect(safeKillSandbox(null)).resolves.toBeUndefined();
  });

  it("swallows kill failures", async () => {
    const sandbox = {
      kill: vi.fn().mockRejectedValue(new Error("already gone")),
    };

    await expect(safeKillSandbox(sandbox as never)).resolves.toBeUndefined();
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });
});

describe("findSandboxById", () => {
  it("finds matching sandbox across pages", async () => {
    listMock.mockReturnValueOnce(
      makePaginator([
        [{ sandboxId: "a" }],
        [{ sandboxId: "target", state: "running" }],
      ]),
    );

    await expect(findSandboxById("target")).resolves.toEqual({ sandboxId: "target", state: "running" });
  });

  it("returns null when sandbox is not present", async () => {
    listMock.mockReturnValueOnce(makePaginator([[{ sandboxId: "a" }], [{ sandboxId: "b" }]]));

    await expect(findSandboxById("missing")).resolves.toBeNull();
  });
});
