import Image from "next/image";
import { withBasePath } from "@/lib/base-path";
import Link from "next/link";
import { Container, Flex } from "@/components/GravityUI/GravityUI";

import { AppHeaderNav } from "@/components/AppHeader/AppHeaderNav";
import "./AppHeader.scss";

export function AppHeader() {
  return (
    <Container as="header" gutters={5} className="app-header">
      <Flex alignItems="center" justifyContent="space-between" gap={4}>
        <Link href="/" className="app-header__brand">
          <Image src={withBasePath("/assets/s09-logo.svg")} alt="" width={28} height={28} unoptimized />
          <span className="app-header__brand-text">Codex Pets</span>
        </Link>
        <AppHeaderNav />
      </Flex>
    </Container>
  );
}
