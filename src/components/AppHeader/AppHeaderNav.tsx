"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

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
  }, [pathname]);

  const principal = data?.principal ?? null;
  const pendingReviewCount = data?.pendingReviewCount ?? 0;
  const isAdmin = principal?.role === "admin";

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const linkProps = (href: string, extraClassName?: string) => {
    const active = isActive(href);
    const activeClassName = active ? " app-header__link_active" : "";
    const extraClass = extraClassName ? ` ${extraClassName}` : "";

    return {
      className: `app-header__link${activeClassName}${extraClass}`,
      "aria-current": active ? "page" : undefined,
    } as const;
  };

  return (
    <Flex
      as="nav"
      alignItems="center"
      gap={2}
      wrap
      aria-label="Primary"
      className="app-header__nav"
    >
      <ul className="app-header__links">
        <li>
          <Link href="/about" prefetch={false} {...linkProps("/about")}>
            About
          </Link>
        </li>
        {principal ? (
          <li>
            <Link
              href="/my-pets"
              prefetch={false}
              {...linkProps("/my-pets")}
            >
              My pets
            </Link>
          </li>
        ) : null}
        {principal && isAdmin ? (
          <li>
            <Link
              href="/admin/submissions"
              prefetch={false}
              {...linkProps("/admin/submissions", "app-header__review-link")}
            >
              <span>Review</span>
              <Label
                theme={pendingReviewCount > 0 ? "warning" : "unknown"}
                size="s"
              >
                {pendingReviewCount}
              </Label>
            </Link>
          </li>
        ) : null}
      </ul>

      <span className="app-header__divider" aria-hidden="true" />

      <div className="app-header__actions">
        {principal ? (
          <>
            <span className="app-header__user" title={principal.email ?? undefined}>
              <span className="app-header__user-avatar" aria-hidden="true">
                {(principal.name ?? principal.email ?? "?")
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </span>
              <span className="app-header__user-name">
                {principal.name ?? principal.email ?? "Account"}
              </span>
            </span>
            <a href={withBasePath("/logout")} className="app-header__link">
              Logout
            </a>
          </>
        ) : (
          <>
            <Link
              href="/login"
              prefetch={false}
              {...linkProps("/login")}
            >
              Login
            </Link>
            <Link
              href="/register"
              prefetch={false}
              {...linkProps("/register")}
            >
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
      </div>
    </Flex>
  );
}
