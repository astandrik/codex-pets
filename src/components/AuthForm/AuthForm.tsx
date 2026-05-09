"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import "./AuthForm.scss";

type AuthFormProps = {
  mode: "login" | "register";
};

type AuthSuccess = {
  ok: true;
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      await postJson<AuthSuccess>(
        withBasePath(isRegister ? "/api/auth/register" : "/api/auth/login"),
        {
          email,
          password,
          displayName,
        },
      );
      trackGoal(isRegister ? "account_register_success" : "account_login_success");
      router.push("/my-pets");
      router.refresh();
    } catch (error) {
      trackGoal(isRegister ? "account_register_error" : "account_login_error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form panel" onSubmit={onSubmit}>
      <fieldset disabled={busy}>
        {isRegister ? (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your handle"
              autoComplete="nickname"
            />
          </label>
        ) : null}
        <label>
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete={isRegister ? "new-password" : "current-password"}
          />
        </label>
        <Button view="action" size="l" type="submit" loading={busy}>
          {isRegister ? "Create account" : "Sign in"}
        </Button>
      </fieldset>
      {message ? <p className="auth-form__message">{message}</p> : null}
    </form>
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
