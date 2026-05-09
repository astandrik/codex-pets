"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Flex, Text, TextInput } from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import "./AuthForm.scss";

type AuthFormProps = {
  mode: "login" | "register";
};

type AuthSuccess = { ok: true };

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await postJson<AuthSuccess>(
        withBasePath(isRegister ? "/api/auth/register" : "/api/auth/login"),
        {
          email,
          password,
          displayName,
        },
      );
      trackGoal(
        isRegister ? "account_register_success" : "account_login_success",
      );
      router.push("/my-pets");
      router.refresh();
    } catch (err) {
      trackGoal(
        isRegister ? "account_register_error" : "account_login_error",
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card view="raised" className="auth-form">
      <form onSubmit={onSubmit}>
        <fieldset className="auth-form__fieldset" disabled={busy}>
          {error ? (
            <Alert
              theme="danger"
              title={isRegister ? "Registration failed" : "Sign in failed"}
              message={error}
              onClose={() => setError(null)}
            />
          ) : null}

          {isRegister ? (
            <Field label="Display name" htmlFor="auth-display-name">
              <TextInput
                id="auth-display-name"
                value={displayName}
                onUpdate={setDisplayName}
                placeholder="Your handle"
                autoComplete="nickname"
                size="l"
                hasClear
              />
            </Field>
          ) : null}
          <Field label="Email" htmlFor="auth-email">
            <TextInput
              id="auth-email"
              value={email}
              onUpdate={setEmail}
              placeholder="name@example.com"
              autoComplete="email"
              size="l"
              hasClear
            />
          </Field>
          <Field label="Password" htmlFor="auth-password">
            <TextInput
              id="auth-password"
              type="password"
              value={password}
              onUpdate={setPassword}
              placeholder="At least 8 characters"
              autoComplete={isRegister ? "new-password" : "current-password"}
              size="l"
            />
          </Field>

          <Button view="action" size="l" type="submit" loading={busy} width="max">
            {isRegister ? "Create account" : "Sign in"}
          </Button>

          <Flex justifyContent="center">
            <Text variant="body-2" color="secondary">
              {isRegister ? (
                <>
                  Already have an account?{" "}
                  <Link href="/login" className="auth-form__link">
                    Sign in
                  </Link>
                </>
              ) : (
                <>
                  No account?{" "}
                  <Link href="/register" className="auth-form__link">
                    Create one
                  </Link>
                </>
              )}
            </Text>
          </Flex>
        </fieldset>
      </form>
    </Card>
  );
}

type FieldProps = {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
};

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <Flex direction="column" gap={1}>
      <label className="auth-form__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </Flex>
  );
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? `Request failed ${response.status}`);
  }
  return data as T;
}
