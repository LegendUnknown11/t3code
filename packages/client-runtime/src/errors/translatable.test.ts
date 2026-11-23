import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { thrownErrorMessage } from "./translatable.ts";

describe("thrownErrorMessage", () => {
  it("preserves the explanation in a string RPC defect", () => {
    const detail =
      "RPC contract is registered but unavailable in the control plane: projectClone.start";
    expect(thrownErrorMessage(Cause.squash(Cause.die(detail)))).toBe(detail);
  });

  it("leaves blank strings and other unknown values to the caller's fallback", () => {
    expect(thrownErrorMessage(" \n")).toBeNull();
    expect(thrownErrorMessage({ detail: "unrecognized" })).toBeNull();
    expect(thrownErrorMessage(new Error(""))).toBe("");
  });
});
