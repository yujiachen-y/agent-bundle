import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";

export type CoreApiContext = {
  coreApi: CoreV1Api;
  kubectlKubeconfigPath: string | null;
  temporaryKubeconfigPath: string | null;
};

function maybeNormalizeK3dHost(kubeConfig: KubeConfig): boolean {
  const currentCluster = kubeConfig.getCurrentCluster();
  if (!currentCluster) {
    return false;
  }

  const server = currentCluster.server ?? "";
  if (!server.includes("://host.docker.internal:")) {
    return false;
  }

  const currentContext = kubeConfig.getCurrentContext();
  const isK3dContext = currentContext.startsWith("k3d-")
    || currentCluster.name.startsWith("k3d-");
  if (!isK3dContext) {
    return false;
  }

  Reflect.set(
    currentCluster,
    "server",
    server.replace("://host.docker.internal:", "://127.0.0.1:"),
  );
  return true;
}

function writeTemporaryKubeconfig(kubeConfig: KubeConfig): string {
  const exportedConfig = kubeConfig.exportConfig();
  const serializedConfig = typeof exportedConfig === "string"
    ? exportedConfig
    : JSON.stringify(exportedConfig);
  const path = join(tmpdir(), `agent-bundle-kubeconfig-${randomUUID()}.json`);
  writeFileSync(path, serializedConfig, "utf8");
  return path;
}

export function createCoreApi(kubeconfigPath?: string): CoreApiContext {
  const kubeConfig = new KubeConfig();
  if (kubeconfigPath) {
    kubeConfig.loadFromFile(kubeconfigPath);
  } else {
    kubeConfig.loadFromDefault();
  }

  const normalized = maybeNormalizeK3dHost(kubeConfig);
  const temporaryKubeconfigPath = kubeconfigPath === undefined && normalized
    ? writeTemporaryKubeconfig(kubeConfig)
    : null;

  return {
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
    kubectlKubeconfigPath: kubeconfigPath ?? temporaryKubeconfigPath,
    temporaryKubeconfigPath,
  };
}
