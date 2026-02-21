import { beforeEach, describe, expect, it, vi } from "vitest";

const sandboxCreateMock = vi.fn();
const findSandboxByIdMock = vi.fn();
const safeKillSandboxMock = vi.fn();
const templateFromBaseImageMock = vi.fn();
const templateRunCmdMock = vi.fn();
const templateBuildMock = vi.fn();

vi.mock("e2b", () => {
  const templateFactory = Object.assign(
    vi.fn(() => ({
      fromBaseImage: templateFromBaseImageMock,
    })),
    {
      build: templateBuildMock,
    },
  );

  return {
    Sandbox: {
      create: sandboxCreateMock,
    },
    Template: templateFactory,
  };
});

vi.mock("../sandbox_helpers.js", () => ({
  findSandboxById: findSandboxByIdMock,
  safeKillSandbox: safeKillSandboxMock,
}));

const { runI2 } = await import("./i2.js");

function makeSandbox(sandboxId: string) {
  return {
    sandboxId,
    commands: {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    },
  };
}

describe("runI2", () => {
  beforeEach(() => {
    sandboxCreateMock.mockReset();
    findSandboxByIdMock.mockReset();
    safeKillSandboxMock.mockReset();
    templateFromBaseImageMock.mockReset();
    templateRunCmdMock.mockReset();
    templateBuildMock.mockReset();

    templateFromBaseImageMock.mockReturnValue({
      runCmd: templateRunCmdMock,
    });
    templateRunCmdMock.mockReturnValue({ id: "template-object" });

    findSandboxByIdMock.mockResolvedValue({ cpuCount: 2, memoryMB: 4096 });
    safeKillSandboxMock.mockResolvedValue(undefined);
  });

  it("runs both default and custom benchmarks when custom template build succeeds", async () => {
    sandboxCreateMock
      .mockResolvedValueOnce(makeSandbox("default-sbx"))
      .mockResolvedValueOnce(makeSandbox("custom-sbx"));

    templateBuildMock.mockResolvedValue({
      name: "org/template",
      tags: ["v1"],
    });

    const result = await runI2(1);

    expect(result.defaultTemplate.cycles).toHaveLength(1);
    expect(result.customTemplateError).toBeNull();
    expect(result.customTemplate?.build.templateRef).toBe("org/template:v1");
    expect(result.customTemplate?.benchmark.cycles).toHaveLength(1);

    expect(templateBuildMock).toHaveBeenCalledTimes(1);
    expect(safeKillSandboxMock).toHaveBeenCalledTimes(2);
    expect(findSandboxByIdMock).toHaveBeenCalledTimes(2);
  });

  it("returns customTemplateError when custom template build fails", async () => {
    sandboxCreateMock.mockResolvedValueOnce(makeSandbox("default-only"));
    templateBuildMock.mockRejectedValue(new Error("build failed"));

    const result = await runI2(1);

    expect(result.defaultTemplate.cycles).toHaveLength(1);
    expect(result.customTemplate).toBeNull();
    expect(result.customTemplateError).toBe("Error: build failed");
    expect(safeKillSandboxMock).toHaveBeenCalledTimes(1);
  });
});
