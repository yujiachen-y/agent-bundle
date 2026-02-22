import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SandboxConfig } from "../types.js";

type ClusterMock = {
  name: string;
  server: string;
};

const loadFromDefaultMock = vi.fn();
const loadFromFileMock = vi.fn();
const makeApiClientMock = vi.fn(() => ({
  createNamespacedPod: vi.fn(),
  readNamespacedPod: vi.fn(),
  deleteNamespacedPod: vi.fn(),
}));
const getCurrentContextMock = vi.fn<string, []>();
const getCurrentClusterMock = vi.fn<ClusterMock | null, []>();

vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: class {
    public loadFromDefault = loadFromDefaultMock;
    public loadFromFile = loadFromFileMock;
    public getCurrentContext = getCurrentContextMock;
    public getCurrentCluster = getCurrentClusterMock;
    public makeApiClient = makeApiClientMock;
  },
  CoreV1Api: class {},
}));

const { K8sSandbox } = await import("./kubernetes.js");

function makeSandboxConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    provider: "kubernetes",
    timeout: 10,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    ...overrides,
  };
}

beforeEach(() => {
  makeApiClientMock.mockClear();
  loadFromDefaultMock.mockClear();
  loadFromFileMock.mockClear();
  getCurrentContextMock.mockReset();
  getCurrentClusterMock.mockReset();
  getCurrentContextMock.mockReturnValue("default");
  getCurrentClusterMock.mockReturnValue({
    name: "default-cluster",
    server: "https://127.0.0.1:6443",
  });
});

describe("K8sSandbox kubeconfig normalization", () => {
  it("rewrites k3d host.docker.internal endpoint to loopback", () => {
    const cluster = {
      name: "k3d-agent-sandbox",
      server: "https://host.docker.internal:58091",
    };
    getCurrentContextMock.mockReturnValue("k3d-agent-sandbox");
    getCurrentClusterMock.mockReturnValue(cluster);

    new K8sSandbox(
      makeSandboxConfig({
        kubernetes: {
          kubeconfig: "/tmp/kubeconfig.yaml",
        },
      }),
    );

    expect(cluster.server).toBe("https://127.0.0.1:58091");
  });

  it("keeps non-k3d host.docker.internal endpoint unchanged", () => {
    const cluster = {
      name: "prod-cluster",
      server: "https://host.docker.internal:58091",
    };
    getCurrentContextMock.mockReturnValue("prod-context");
    getCurrentClusterMock.mockReturnValue(cluster);

    new K8sSandbox(
      makeSandboxConfig({
        kubernetes: {
          kubeconfig: "/tmp/kubeconfig.yaml",
        },
      }),
    );

    expect(cluster.server).toBe("https://host.docker.internal:58091");
  });
});
