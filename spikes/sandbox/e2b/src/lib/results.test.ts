import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mkdirMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

vi.mock("./utils/time.js", () => ({
  nowIso: () => "2026-02-21T12:34:56.789Z",
}));

const { writeResultFile } = await import("./results.js");
const { RESULTS_DIR } = await import("./paths.js");

describe("writeResultFile", () => {
  beforeEach(() => {
    mkdirMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it("writes timestamped and latest result files", async () => {
    const outputPath = await writeResultFile("i1", { ok: true });

    const expectedTimestampedPath = path.resolve(RESULTS_DIR, "2026-02-21T12-34-56-789Z-i1.json");
    const expectedLatestPath = path.resolve(RESULTS_DIR, "latest-i1.json");
    const payload = `${JSON.stringify({ ok: true }, null, 2)}\n`;

    expect(outputPath).toBe(expectedTimestampedPath);
    expect(mkdirMock).toHaveBeenCalledWith(RESULTS_DIR, { recursive: true });
    expect(writeFileMock).toHaveBeenNthCalledWith(1, expectedTimestampedPath, payload, "utf8");
    expect(writeFileMock).toHaveBeenNthCalledWith(2, expectedLatestPath, payload, "utf8");
  });
});
