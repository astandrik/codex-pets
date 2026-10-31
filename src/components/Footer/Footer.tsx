import Image from "next/image";
import Link from "next/link";
import { Container, Text } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";

import "./Footer.scss";

import { GRAVITY_UI_URL, YDB_URL, LEARN_LINKS, DOCUMENTATION_LINKS } from "@/components/SiteNavigation/navigation-links";

export function Footer() {
  return (
    <Container as="footer" gutters={5} className="footer">
      <div className="footer__content">
        <Text variant="caption-2" color="secondary" className="footer__note">
          Create and discover animated pets for Codex.
        </Text>
        <details className="footer__resources">
          <summary>Guides, developers &amp; API</summary>
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
        <nav className="footer__learn" aria-label="Learn">
          <span className="footer__learn-title">Learn</span>
          <div className="footer__learn-links">
            {LEARN_LINKS.map(({ href, label }) => (
              <Link key={href} href={href} className="footer__link">
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="footer__links" aria-label="Footer links">
          <Link href="/about" className="footer__link">
            About
          </Link>
          <Link href="/developers" className="footer__link">
            Developers
          </Link>
          {DOCUMENTATION_LINKS.map(({href, label}) => <Link key={href} href={href} className="footer__link">{label}</Link>)}
        </div>
        </details>
      </div>
    </Container>
  );
}
