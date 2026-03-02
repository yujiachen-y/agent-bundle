import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Sandbox, SandboxConfig, SandboxHooks } from "./types.js";

function createMockSandbox(id: string): Sandbox {
  return {
    id,
    status: "idle",
    async start() {
      return;
    },
    async shutdown() {
      return;
    },
    async exec() {
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    },
    file: {
      async read() {
        return "";
      },
      async write() {
        return;
      },
      async list() {
        return [];
      },
      async delete() {
        return;
      },
    },
  };
}

const e2bConstructorMock = vi.fn(() => createMockSandbox("e2b-sandbox"));
const k8sConstructorMock = vi.fn(() => createMockSandbox("k8s-sandbox"));
const dockerConstructorMock = vi.fn(() => createMockSandbox("docker-sandbox"));

vi.mock("./providers/e2b.js", () => ({
  E2BSandbox: e2bConstructorMock,
}));

vi.mock("./providers/kubernetes.js", () => ({
  K8sSandbox: k8sConstructorMock,
}));

vi.mock("./providers/docker.js", () => ({
  DockerSandbox: dockerConstructorMock,
}));

const { createSandbox } = await import("./factory.js");

function makeConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    provider: "e2b",
    timeout: 900,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    ...overrides,
  };
}

beforeEach(() => {
  e2bConstructorMock.mockClear();
  k8sConstructorMock.mockClear();
  dockerConstructorMock.mockClear();
});

describe("createSandbox", () => {
  it("creates E2B sandbox when provider is e2b", () => {
    const hooks: SandboxHooks = {};
    const sandbox = createSandbox(makeConfig({ provider: "e2b" }), hooks);

    expect(sandbox.id).toBe("e2b-sandbox");
    expect(e2bConstructorMock).toHaveBeenCalledTimes(1);
    expect(e2bConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "e2b" }),
      hooks,
    );
    expect(k8sConstructorMock).not.toHaveBeenCalled();
  });

  it("creates Kubernetes sandbox when provider is kubernetes", () => {
    const hooks: SandboxHooks = {};
    const sandbox = createSandbox(makeConfig({ provider: "kubernetes" }), hooks);

    expect(sandbox.id).toBe("k8s-sandbox");
    expect(k8sConstructorMock).toHaveBeenCalledTimes(1);
    expect(k8sConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "kubernetes" }),
      hooks,
    );
    expect(e2bConstructorMock).not.toHaveBeenCalled();
  });

  it("applies serve provider override in serve mode", () => {
    const sandbox = createSandbox(
      makeConfig({
        provider: "e2b",
        serve: {
          provider: "kubernetes",
        },
      }),
      {},
      { mode: "serve" },
    );

    expect(sandbox.id).toBe("k8s-sandbox");
    expect(k8sConstructorMock).toHaveBeenCalledTimes(1);
    expect(k8sConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "kubernetes" }),
      {},
    );
    expect(e2bConstructorMock).not.toHaveBeenCalled();
  });

  it("creates Docker sandbox when provider is docker", () => {
    const hooks: SandboxHooks = {};
    const sandbox = createSandbox(makeConfig({ provider: "docker" }), hooks);

    expect(sandbox.id).toBe("docker-sandbox");
    expect(dockerConstructorMock).toHaveBeenCalledTimes(1);
    expect(dockerConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "docker" }),
      hooks,
    );
    expect(e2bConstructorMock).not.toHaveBeenCalled();
    expect(k8sConstructorMock).not.toHaveBeenCalled();
  });

  it("keeps base provider in build mode even if serve override exists", () => {
    const sandbox = createSandbox(
      makeConfig({
        provider: "e2b",
        serve: {
          provider: "kubernetes",
        },
      }),
      {},
      { mode: "build" },
    );

    expect(sandbox.id).toBe("e2b-sandbox");
    expect(e2bConstructorMock).toHaveBeenCalledTimes(1);
    expect(e2bConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "e2b" }),
      {},
    );
    expect(k8sConstructorMock).not.toHaveBeenCalled();
  });

  it("throws actionable error for unsupported provider", () => {
    const invalidConfig = makeConfig() as SandboxConfig & {
      provider: string;
    };
    invalidConfig.provider = "podman";

    expect(() => createSandbox(invalidConfig as SandboxConfig, {})).toThrowError(
      "Unsupported sandbox provider \"podman\". Supported providers: e2b, kubernetes, docker.",
    );
    expect(e2bConstructorMock).not.toHaveBeenCalled();
    expect(k8sConstructorMock).not.toHaveBeenCalled();
    expect(dockerConstructorMock).not.toHaveBeenCalled();
  });
});
