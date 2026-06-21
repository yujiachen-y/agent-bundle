import { describe, expect, it } from "vitest";

import * as agent from "./agent/index.js";
import * as observability from "./observability/index.js";
import * as runtime from "./runtime.js";
import * as service from "./service/index.js";
import * as skills from "./skills/index.js";
import * as webui from "./webui/index.js";

describe("public exports", () => {
  it("exposes runtime entrypoints", () => {
    expect(runtime.defineAgent).toBeTypeOf("function");
    expect(runtime.withCommands).toBeTypeOf("function");
  });

  it("exposes package subpath entrypoints", () => {
    expect(agent.defineAgent).toBeTypeOf("function");
    expect(observability.createObservabilityProvider).toBeTypeOf("function");
    expect(service.createServer).toBeTypeOf("function");
    expect(skills.loadSkill).toBeTypeOf("function");
    expect(webui.createWebUIServer).toBeTypeOf("function");
  });
});
