import Link from "next/link";
import { Button, Container, Flex, Label } from "@/components/GravityUI/GravityUI";
import { Plus } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { countPendingPets } from "@/lib/pets/repository";
import "./AppHeader.scss";

export async function AppHeader() {
  const principal = await getCurrentPrincipal();
  const pendingReviewCount =
    principal && isAdminUser(principal) ? await countPendingPets() : 0;

  return (
    <Container as="header" maxWidth="xl" gutters={5} className="app-header">
      <Flex alignItems="center" justifyContent="space-between" gap={4} wrap>
        <Link href="/" className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true">
            <svg
              className="app-header__mark-icon"
              viewBox="0 0 16 16"
              focusable="false"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2 14V3h1v1h1v1h1v1h1v1h4V6h1V5h1V4h1V3h1v11H2ZM5 8h1v2H5V8Zm5 0h1v2h-1V8Zm-2 3h1v1H8v-1Z"
              />
            </svg>
          </span>
          <span className="app-header__brand-text">Codex Pets</span>
        </Link>
        <Flex
          as="nav"
          alignItems="center"
          gap={3}
          wrap
          aria-label="Primary"
          className="app-header__nav"
        >
          {principal ? (
            <>
              <Link href="/my-pets" prefetch={false} className="app-header__link">
                My pets
              </Link>
              {isAdminUser(principal) ? (
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
            <Plus />
            Submit
          </Button>
        </Flex>
      </Flex>
    </Container>
  );
}
