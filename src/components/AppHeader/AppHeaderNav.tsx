"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
    profileSlug: string | null;
    role: "user" | "admin";
  } | null;
  pendingReviewCount: number;
  openRequestCount: number;
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
  const openRequestCount = data?.openRequestCount ?? 0;
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

  const menuItemProps = (href: string) => {
    const active = isActive(href);
    return {
      className: `app-header__menu-item${active ? " app-header__menu-item_active" : ""}`,
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
          <Link href="/" prefetch={false} {...linkProps("/")}>
            Gallery
          </Link>
        </li>
        <li>
          <Link href="/about" prefetch={false} {...linkProps("/about")}>
            About
          </Link>
        </li>
        <li>
          <Link href="/agents" prefetch={false} {...linkProps("/agents")}>
            Agents
          </Link>
        </li>
        <li>
          <Link href="/developers" prefetch={false} {...linkProps("/developers")}>
            Developers
          </Link>
        </li>
        {principal ? (
          <li>
            <HeaderMenu
              label="My"
              isActive={
                isActive("/profile") ||
                isActive("/my-pets") ||
                isActive("/my-requests")
              }
            >
              <Link
                href="/profile"
                prefetch={false}
                {...menuItemProps("/profile")}
              >
                Profile
              </Link>
              <Link
                href="/my-pets"
                prefetch={false}
                {...menuItemProps("/my-pets")}
              >
                My pets
              </Link>
              <Link
                href="/my-requests"
                prefetch={false}
                {...menuItemProps("/my-requests")}
              >
                My requests
              </Link>
            </HeaderMenu>
          </li>
        ) : null}
        {principal && isAdmin ? (
          <li>
            <HeaderMenu
              label="Admin"
              isActive={
                isActive("/admin/submissions") || isActive("/admin/requests")
              }
              badge={
                pendingReviewCount + openRequestCount > 0
                  ? pendingReviewCount + openRequestCount
                  : null
              }
            >
              <Link
                href="/admin/submissions"
                prefetch={false}
                {...menuItemProps("/admin/submissions")}
              >
                <span>Review</span>
                <Label
                  theme={pendingReviewCount > 0 ? "warning" : "unknown"}
                  size="s"
                >
                  {pendingReviewCount}
                </Label>
              </Link>
              <Link
                href="/admin/requests"
                prefetch={false}
                {...menuItemProps("/admin/requests")}
              >
                <span>Requests</span>
                <Label
                  theme={openRequestCount > 0 ? "warning" : "unknown"}
                  size="s"
                >
                  {openRequestCount}
                </Label>
              </Link>
            </HeaderMenu>
          </li>
        ) : null}
      </ul>

      <span className="app-header__divider" aria-hidden="true" />

      <div className="app-header__actions">
        {principal ? (
          <>
            <Link
              href={principal.profileSlug ? `/users/${principal.profileSlug}` : "/profile"}
              prefetch={false}
              className="app-header__user"
              title={principal.email ?? undefined}
            >
              <span className="app-header__user-avatar" aria-hidden="true">
                {(principal.name ?? principal.email ?? "?")
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </span>
              <span className="app-header__user-name">
                {principal.name ?? principal.email ?? "Account"}
              </span>
            </Link>
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
        <Button view="outlined" size="m" href={withBasePath("/request")}>
          Request
        </Button>
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

type HeaderMenuProps = {
  label: string;
  isActive: boolean;
  badge?: number | null;
  children: ReactNode;
};

function HeaderMenu({ label, isActive, badge, children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const triggerClass = `app-header__link app-header__menu-trigger${
    isActive ? " app-header__link_active" : ""
  }${open ? " app-header__menu-trigger_open" : ""}`;

  return (
    <div className="app-header__menu" ref={wrapperRef}>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        {badge != null ? (
          <Label theme="warning" size="s">
            {badge}
          </Label>
        ) : null}
        <span className="app-header__menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="app-header__menu-popover"
          role="menu"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
