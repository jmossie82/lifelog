import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("admin client uses service key without cookies", () => {
  const source = readFileSync("lib/supabase/admin.ts", "utf8");

  assert.match(source, /createClient<Database>/);
  assert.match(source, /supabaseServiceRoleKey/);
  assert.doesNotMatch(source, /cookies\(/);
  assert.doesNotMatch(source, /Authorization/);
});

test("server client uses createServerClient with getAll cookies", () => {
  const source = readFileSync("lib/supabase/server.ts", "utf8");

  assert.match(source, /createServerClient<Database>/);
  assert.match(source, /getAll\(\)/);
  assert.match(source, /setAll/);
});

test("proxy refreshes auth through getUser", () => {
  const source = readFileSync("lib/supabase/proxy.ts", "utf8");

  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /setAll/);
});
