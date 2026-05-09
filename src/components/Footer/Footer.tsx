import Link from "next/link";
import "./Footer.scss";

export function Footer() {
  return (
    <footer className="footer">
      <span>Codex pet packs are community-submitted.</span>
      <Link href="/api/manifest">Manifest</Link>
    </footer>
  );
}
