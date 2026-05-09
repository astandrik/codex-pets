import { redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm/AuthForm";
import { getCurrentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const principal = await getCurrentPrincipal();
  if (principal) {
    redirect("/my-pets");
  }

  return (
    <main className="wrap">
      <section>
        <p className="pill">Account</p>
        <h1>Create account</h1>
        <p className="lead">
          Create a local account to track your own submissions and use private
          account pages.
        </p>
      </section>
      <AuthForm mode="register" />
    </main>
  );
}
