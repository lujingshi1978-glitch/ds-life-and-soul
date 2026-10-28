import test from "node:test";
import assert from "node:assert/strict";
import { ownDshLaunchToken } from "../scripts/deploy.mjs";
const url = (port, token) =>
  "http://127.0.0.1:" + port + "/?" + "token=" + token;
test("model login uses only the last valid URL for this exact owned port", () => {
  const first = "fixture-launch-first-token",
    second = "fixture-launch-second-token";
  assert.equal(
    ownDshLaunchToken(
      url(41230, first) +
        "\n" +
        url(41231, "fixture-foreign-token") +
        "\n" +
        url(41230, second),
      41230,
    ),
    second,
  );
});
test("model login refuses foreign ports and missing credentials", () => {
  assert.equal(
    ownDshLaunchToken(url(41231, "fixture-foreign-token"), 41230),
    null,
  );
  assert.equal(ownDshLaunchToken("no launch url", 41230), null);
});
