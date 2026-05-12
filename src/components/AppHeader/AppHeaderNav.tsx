"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Flex, Label } from "@/components/GravityUI/GravityUI";
import { Plus } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";

type HeaderNavResponse = {
  principal: {
    userId: string;
    email: string | null;
    name: string | null;
    role: "user" | "admin";
  } | null;
  pendingReviewCount: number;
};

export function AppHeaderNav() {
  const [data, setData] = useState<HeaderNavResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(withBasePath("/api/auth/nav"), {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const nextData = (await response.json()) as HeaderNavResponse;
        setData(nextData);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          return;
        }
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const principal = data?.principal ?? null;
  const pendingReviewCount = data?.pendingReviewCount ?? 0;
  const isAdmin = principal?.role === "admin";

  return (
    <Flex
      as="nav"
      alignItems="center"
      gap={3}
      wrap
      aria-label="Primary"
      className="app-header__nav"
    >
      <Link href="/about" prefetch={false} className="app-header__link">
        About
      </Link>
      {principal ? (
        <>
          <Link href="/my-pets" prefetch={false} className="app-header__link">
            My pets
          </Link>
          {isAdmin ? (
            <Link
              href="/admin/submissions"
              prefetch={false}
              className="app-header__link app-header__review-link"
            >
              <span>Review</span>
              <Label
                theme={pendingReviewCount > 0 ? "warning" : "unknown"}
                size="s"
              >
                {pendingReviewCount}
              </Label>
            </Link>
          ) : null}
          <a href={withBasePath("/logout")} className="app-header__link">
            Logout
          </a>
        </>
      ) : (
        <>
          <Link href="/login" prefetch={false} className="app-header__link">
            Login
          </Link>
          <Link href="/register" prefetch={false} className="app-header__link">
            Register
          </Link>
        </>
      )}
      <Button view="action" size="m" href={withBasePath("/submit")}>
        <Button.Icon>
          <Plus />
        </Button.Icon>
        Submit
      </Button>
    </Flex>
  );
}
