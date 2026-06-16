import { signInWithPassword } from "@/app/auth/actions";

const errorCopy: Record<string, string> = {
  missing_credentials: "Enter an email and password.",
  invalid_credentials: "The email or password was not accepted.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const message = params.error ? errorCopy[params.error] : undefined;

  return (
    <main className="login-shell">
      <form action={signInWithPassword} className="login-panel">
        <h1>Fieldy Lifelog</h1>
        <p>Sign in to your private conversation archive.</p>
        {message ? <p className="login-error">{message}</p> : null}
        <label>
          Email
          <input autoComplete="email" name="email" required type="email" />
        </label>
        <label>
          Password
          <input autoComplete="current-password" name="password" required type="password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
