import assert from "node:assert/strict";
import test from "node:test";

import { secureResponse } from "./http-security.ts";

test("security headers protect framework and direct Worker responses", () => {
  const response = secureResponse(Response.json({ ok: true }));
  const csp = response.headers.get("content-security-policy") ?? "";

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /geolocation=\(self\)/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
