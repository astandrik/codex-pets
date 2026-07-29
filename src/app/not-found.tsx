import { Picture } from "@gravity-ui/icons";

import {
  Button,
  Container,
  Flex,
  PlaceholderContainer,
} from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";

export default function NotFound() {
  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" alignItems="center" gap={5} className="page-section">
        <PlaceholderContainer
          size="l"
          image={<Picture width={64} height={64} />}
          title="404 — page not found"
          description="The page you are looking for moved, was renamed, or never existed. Try the gallery or the guide below."
        />
        <Flex gap={2} wrap justifyContent="center">
          <Button view="action" size="l" href={withBasePath("/")}>
            Browse gallery
          </Button>
          <Button
            view="outlined"
            size="l"
            href={withBasePath("/guides/best-codex-pets-for-ai-coding-agents")}
          >
            Best Codex pets guide
          </Button>
        </Flex>
      </Flex>
    </Container>
  );
}
