"use server";

import { redirect } from "next/navigation";
import { getOwnerUserId } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function signInWithPassword(formData: FormData) {
  const email = readFormString(formData, "email");
  const password = readFormString(formData, "password");

  if (!email || !password) {
    redirect("/login?error=missing_credentials");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=invalid_credentials");
  }

  if (user?.id !== getOwnerUserId()) {
    await supabase.auth.signOut();
    redirect("/login?error=invalid_credentials");
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
