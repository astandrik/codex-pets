import { redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm/AuthForm";
import { getCurrentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const principal = await getCurrentPrincipal();
  if (principal) {
    redirect("/my-pets");
  }

  return (
    <main className="wrap">
      <section>
        <p className="pill">Account</p>
        <h1>Sign in</h1>
        <p className="lead">
          Sign in to see your submissions and access private account pages.
        </p>
      </section>
      <AuthForm mode="login" />
    </main>
  );
}
