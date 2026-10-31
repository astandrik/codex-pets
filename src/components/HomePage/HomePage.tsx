import {Button, Container, Text} from "@/components/GravityUI/GravityUI";
import Link from "next/link";
import type {ReactNode} from "react";
import {AskAIPanel} from "@/components/AskAI/AskAIPanel";
import {ASK_AI_HOME, ASK_AI_PRODUCT_NAME} from "@/components/AskAI/ask-ai-content";
import {BEST_CODEX_PETS_GUIDE_PATH} from "@/lib/guides/best-codex-pets";
import {withBasePath} from "@/lib/base-path";
import {HOME_COPY, HOME_STEPS, HOME_FAQ, HOME_TEXT_ONLY_AI_PROMPT} from "@/lib/product-copy";
import type {PublicPetSummary} from "@/lib/pets/types";
import {HomeHeroPetPicker, type HomeHeroPet} from "./HomeHeroPetPicker";
import {HomeGeneratedPetExample} from "./HomeGeneratedPetExample";
import {pickRandomHeroPetIndex} from "./home-hero-random";
import {buildHomeRecommendationEntryPoints} from "./recommendation-entry-points";
import "./HomePage.scss";

type HomePageProps = {
  pets: PublicPetSummary[];
  totalPets: number;
  catalogTotalPets: number;
  showLandingContent: boolean;
  catalog: ReactNode;
  generationAvailable?: boolean;
  reviewBase?: boolean;
};

const TEXT_ONLY_STEPS = [
  {title: "Describe your character", body: "Start with a description and an optional name."},
  {title: "Generate your pet", body: "Create the character and all animation states."},
  {title: "Preview and download", body: "Inspect every animation and download your pet pack."},
];

export function HomePage({
  pets, catalogTotalPets, showLandingContent, catalog,
  generationAvailable = true, reviewBase = true,
}: HomePageProps) {
  const heroPets = showLandingContent ? pets.map(toHomeHeroPet) : [];
  const recommendations = showLandingContent ? buildHomeRecommendationEntryPoints(pets) : null;
  const example = pets.find(pet => pet.slug === "trolleybus" && pet.status === "approved") ?? null;
  const steps = reviewBase ? HOME_STEPS.items : TEXT_ONLY_STEPS;
  const faq = reviewBase ? HOME_FAQ.items : [
    {question: "How do I start?", answer: "Describe your character and add an optional name. The form shows the currently available generation options."},
    ...HOME_FAQ.items.slice(1),
  ];

  return (
    <Container as="main" maxWidth="xl" gutters={0} className="page-shell home-page">
      {showLandingContent && <>
        <section className="home-create-hero home-hero-card">
          <div className="home-create-hero__copy">
            <p className="home-create-hero__eyebrow">{HOME_COPY.eyebrow}</p>
            <h1>{HOME_COPY.title}</h1>
            <p className="home-create-hero__lead">
              {reviewBase ? HOME_COPY.description : "Describe a character to create an animated pet. Preview all nine animations and download your pack."}
            </p>
            <div className="home-hero__actions">
              {generationAvailable ? (
                <Button view="action" size="xl" href={withBasePath(HOME_COPY.primaryHref)}>{HOME_COPY.primary}</Button>
              ) : (
                <Button view="action" size="xl" disabled>Generation unavailable</Button>
              )}
              <Button view="outlined" size="xl" href={withBasePath(HOME_COPY.secondaryHref)}>{HOME_COPY.secondary}</Button>
            </div>
            <p className="home-create-hero__support">{HOME_COPY.support}</p>
            <a href={withBasePath(HOME_COPY.detailsHref)}>{HOME_COPY.details} ↗</a>
          </div>
          <HomeGeneratedPetExample key={example?.spritesheetUrl ?? "missing"} pet={example}/>
        </section>
        <section className="home-steps">
          <h2>{HOME_STEPS.title}</h2>
          <ol>{steps.map((step, index) => (
            <li key={step.title}>
              <span className="home-steps__number">0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}</ol>
        </section>
      </>}
      <section id="gallery" className="home-gallery">
        {showLandingContent ? <h2>Explore the community gallery</h2> : <h1>Codex Pets gallery</h1>}
        <p className="home-gallery__lead">
          Find inspiration or choose a ready-made pet. <span>{catalogTotalPets} approved pets</span>
        </p>
        {recommendations && (
          <details className="home-recommendations">
            <summary>Explore styles and popular pets</summary>
            <h3 className="home-recommendations__title">Find by vibe, not keywords</h3>
            <p>Describe a mood, style, color, character, or coding energy — semantic search will find the closest approved pets.</p>
            <div className="home-recommendations__groups">
              {recommendations.styleTags.length > 0 && (
                <RecommendationGroup title="Styles">
                  {recommendations.styleTags.map(item => <Link key={item.tag} href={item.href} className="home-recommendations__link">#{item.tag}</Link>)}
                </RecommendationGroup>
              )}
              {recommendations.popularPets.length > 0 && (
                <RecommendationGroup title="Popular">
                  {recommendations.popularPets.map(item => <Link key={item.slug} href={item.href} className="home-recommendations__link">{item.displayName}</Link>)}
                </RecommendationGroup>
              )}
              {recommendations.recentPets.length > 0 && (
                <RecommendationGroup title="Recently added">
                  {recommendations.recentPets.map(item => <Link key={item.slug} href={item.href} className="home-recommendations__link">{item.displayName}</Link>)}
                </RecommendationGroup>
              )}
            </div>
            <Link href={BEST_CODEX_PETS_GUIDE_PATH}>Best Codex pets guide ↗</Link>
          </details>
        )}
        {showLandingContent && <HomeHeroPetPicker pets={heroPets} initialIndex={pickRandomHeroPetIndex(heroPets.length) ?? 0} layout="compact"/>}
        {catalog}
      </section>
      {showLandingContent && <>
        <section className="home-faq">
          <h2>{HOME_FAQ.title}</h2>
          <div>
            {faq.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
            <a href={withBasePath(HOME_FAQ.href)}>{HOME_FAQ.details} ↗</a>
          </div>
        </section>
        <section className="home-ask-ai">
          <AskAIPanel productName={ASK_AI_PRODUCT_NAME} label={ASK_AI_HOME.label}
            helperText={ASK_AI_HOME.helperText} prompt={reviewBase ? ASK_AI_HOME.prompt : HOME_TEXT_ONLY_AI_PROMPT}
            page={ASK_AI_HOME.page} promptVariant={ASK_AI_HOME.promptVariant} layout="home"/>
        </section>
      </>}
    </Container>
  );
}

function RecommendationGroup({title, children}: {title: string; children: ReactNode}) {
  return <div className="home-recommendations__group">
    <Text as="h3" variant="body-2">{title}</Text>
    <div className="home-recommendations__links">{children}</div>
  </div>;
}

function toHomeHeroPet(pet: PublicPetSummary): HomeHeroPet {
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    ownerName: pet.ownerName,
    ownerProfileSlug: pet.ownerProfileSlug,
    publicAuthorEmail: pet.publicAuthorEmail ?? null,
    spritesheetUrl: pet.spritesheetUrl,
  };
}
