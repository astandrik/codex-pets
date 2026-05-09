import Link from "next/link";
import { Button } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { countPendingPets } from "@/lib/pets/repository";
import "./AppHeader.scss";

export async function AppHeader() {
  const principal = await getCurrentPrincipal();
  const pendingReviewCount =
    principal && isAdminUser(principal) ? await countPendingPets() : 0;

  return (
    <header className="app-header">
      <Link href="/" className="app-header__brand">
        <span className="app-header__mark">CP</span>
        <span>Codex Pets</span>
      </Link>
      <nav className="app-header__nav" aria-label="Primary">
        {principal ? (
          <>
            <Link href="/my-pets" prefetch={false}>
              My pets
            </Link>
            {isAdminUser(principal) ? (
              <Link
                href="/admin/submissions"
                prefetch={false}
                className="app-header__review-link"
              >
                <span>Review</span>
                <span className="app-header__review-count">
                  {pendingReviewCount}
                </span>
              </Link>
            ) : null}
            <a href={withBasePath("/logout")}>
              Logout
            </a>
          </>
        ) : (
          <>
            <Link href="/login" prefetch={false}>
              Login
            </Link>
            <Link href="/register" prefetch={false}>
              Register
            </Link>
          </>
        )}
        <Button view="action" size="m" href={withBasePath("/submit")}>
          Submit
        </Button>
      </nav>
    </header>
  );
}
