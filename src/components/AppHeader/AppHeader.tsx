import Link from "next/link";
import { Container, Flex } from "@/components/GravityUI/GravityUI";

import { AppHeaderNav } from "@/components/AppHeader/AppHeaderNav";
import "./AppHeader.scss";

export async function AppHeader() {
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
        <AppHeaderNav />
      </Flex>
    </Container>
  );
}
