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

test("password sign-in clears non-owner sessions", () => {
  const source = readFileSync("app/auth/actions.ts", "utf8");

  assert.match(source, /getOwnerUserId/);
  assert.match(source, /user\?\.id !== getOwnerUserId\(\)/);
  assert.match(source, /auth\.signOut\(\)/);

  const ownerCheckIndex = source.indexOf("user?.id !== getOwnerUserId()");
  const signOutIndex = source.indexOf("auth.signOut()", ownerCheckIndex);
  const redirectIndex = source.indexOf(
    'redirect("/login?error=invalid_credentials")',
    signOutIndex,
  );

  assert.notEqual(ownerCheckIndex, -1);
  assert.notEqual(signOutIndex, -1);
  assert.notEqual(redirectIndex, -1);
});

test("password sign-in preserves raw password input", () => {
  const source = readFileSync("app/auth/actions.ts", "utf8");

  assert.match(source, /function readRawFormString/);
  assert.match(source, /const password = readRawFormString\(formData, "password"\)/);
  assert.doesNotMatch(source, /const password = readFormString\(formData, "password"\)/);
});
