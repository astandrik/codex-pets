"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Dialog, Label } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { LEARN_LINKS, DOCUMENTATION_LINKS, GRAVITY_UI_URL, YDB_URL } from "@/components/SiteNavigation/navigation-links";

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
  const [menu, setMenu] = useState({ pathname, open: false });
  if (menu.pathname !== pathname) setMenu({ pathname, open: false });
  const open = menu.pathname === pathname && menu.open;
  const close = () => setMenu({ pathname, open: false });
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


  function link(href: string, label: string, badge?: number) {
    const className = `app-header__menu-item${isActive(href) ? " app-header__menu-item_active" : ""}`;
    const content = <><span>{label}</span>{badge !== undefined && <Label theme={badge > 0 ? "warning" : "unknown"} size="s">{badge}</Label>}</>;
    return href === "/my-generations" ? <a key={`${href}:${label}`} href={withBasePath(href)} className={className} aria-current={isActive(href) ? "page" : undefined} onClick={close}>{content}</a>
      : <Link key={`${href}:${label}`} href={href} prefetch={false} className={className} aria-current={isActive(href) ? "page" : undefined} onClick={close}>{content}</Link>;
  }
  return <nav aria-label="Primary" className="app-header__nav">
    <div className="app-header__primary-links">{link("/", "Gallery")}{link("/generate", "Generate")}{link("/my-generations", "My generations")}</div>
    <Button type="button" size="xl" view="outlined" className="app-header__menu-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setMenu({ pathname, open: true })}>
      Menu{isAdmin && pendingReviewCount + openRequestCount > 0 && <Label theme="warning" size="s">{pendingReviewCount + openRequestCount}</Label>}
    </Button>
    <Dialog open={open} onClose={close} returnFocus contentOverflow="auto" size="m" className="app-header__menu-dialog" aria-label="Menu" hasCloseButton={false}>
      <Dialog.Header caption="Menu" as="h1" className="app-header__menu-heading" insertAfter={<Button type="button" view="flat" size="xl" aria-label="Close menu" onClick={close}><Image src={withBasePath("/assets/s09-close.svg")} width={16} height={16} alt="" unoptimized /></Button>} />
      <Dialog.Body>
        <section><h2>Explore</h2>{link("/", "Gallery")}{link("/about", "About")}{link("/agents", "Agents")}{link("/developers", "Developers")}</section>
        <section><h2>Create</h2>{link("/generate", "Generate a pet")}{link("/request", "Request a pet")}{link("/submit", "Submit a pet")}</section>
        <section><h2>Your account</h2>
          {principal ? <>
            <p className="app-header__identity" title={principal.email ?? undefined}>{principal.name ?? principal.email ?? "Account"}</p>
            {link(principal.profileSlug ? `/users/${principal.profileSlug}` : "/profile", "Public profile")}
            {link("/profile", "Profile settings")}{link("/my-pets", "My pets")}{link("/my-requests", "My requests")}
          </> : <>{link("/login", "Login")}{link("/register", "Register")}</>}
          {link("/my-generations", "My generations")}
          {principal && <a className="app-header__menu-item" href={withBasePath("/logout")}>Logout</a>}
        </section>
        {isAdmin && <section><h2>Admin</h2>{link("/admin/submissions", "Review submissions", pendingReviewCount)}{link("/admin/requests", "Generation requests", openRequestCount)}{link("/admin/generation-limits", "Generation limits")}</section>}
        <section><h2>Learn &amp; resources</h2>{LEARN_LINKS.map(({href, label}) => link(href, label))}{DOCUMENTATION_LINKS.map(({href, label}) => link(href, label))}</section>
        <section><h2>Created with</h2><a className="app-header__menu-item" href={GRAVITY_UI_URL} target="_blank" rel="noopener noreferrer">Gravity UI</a><a className="app-header__menu-item" href={YDB_URL} target="_blank" rel="noopener noreferrer">YDB</a></section>
      </Dialog.Body>
    </Dialog>
  </nav>;
}
