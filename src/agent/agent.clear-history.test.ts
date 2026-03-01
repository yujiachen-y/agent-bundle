import { expect, it } from "vitest";

import { createHarness } from "./agent.test-helpers.js";

it("clearHistory resets prior conversation context for subsequent responses", async () => {
  const harness = createHarness();
  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-1" },
    {
      type: "response.completed",
      output: {
        id: "resp-1",
        output: "first response",
      },
    },
  ]);
  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-2" },
    {
      type: "response.completed",
      output: {
        id: "resp-2",
        output: "second response",
      },
    },
  ]);

  await harness.agent.initialize();
  await harness.agent.respond([{ role: "user", content: "hello" }]);

  harness.agent.clearHistory();
  await harness.agent.respond([{ role: "user", content: "fresh start" }]);

  expect(harness.loop.runInputs[0]).toEqual([{ role: "user", content: "hello" }]);
  expect(harness.loop.runInputs[1]).toEqual([{ role: "user", content: "fresh start" }]);
});
