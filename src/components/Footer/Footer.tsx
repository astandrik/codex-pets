import Image from "next/image";
import Link from "next/link";
import { Container, Text } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";

import "./Footer.scss";

const GRAVITY_UI_URL = "https://github.com/gravity-ui/uikit";
const YDB_URL = "https://ydb.tech/";

export function Footer() {
  return (
    <Container as="footer" maxWidth="xl" gutters={5} className="footer">
      <div className="footer__content">
        <Text variant="caption-2" color="secondary" className="footer__note">
          Codex pet packs are community-submitted.
        </Text>
        <div className="footer__credits" aria-label="Technology credits">
          <span className="footer__credit">
            <span className="footer__credit-label">Created with</span>
            <a
              href={GRAVITY_UI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="footer__link"
            >
              <span>gravity-ui/uikit</span>
              <Image
                src={withBasePath("/assets/gravity-ui-favicon.png")}
                alt=""
                width={18}
                height={18}
                className="footer__icon"
                unoptimized
              />
            </a>
          </span>
          <span className="footer__credit">
            <span className="footer__credit-label">Powered by</span>
            <a
              href={YDB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="footer__link"
            >
              <Image
                src={withBasePath("/assets/ydb-icon.svg")}
                alt=""
                width={22}
                height={18}
                className="footer__icon footer__icon--ydb"
                unoptimized
              />
              <span>YDB</span>
            </a>
          </span>
        </div>
        <div className="footer__links" aria-label="Footer links">
          <Link href="/about" className="footer__link">
            About
          </Link>
          <Link href="/api/manifest" className="footer__link">
            Manifest
          </Link>
        </div>
      </div>
    </Container>
  );
}
