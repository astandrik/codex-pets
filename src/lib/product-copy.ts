// Shared public copy. Operational limits remain owned by the generation service.
export const PRODUCT_SUMMARY = "Codex Pets helps you create your own animated pet for Codex from a description or image. You can review and refine the character, generate its animations, and download the pet pack. You can also browse and install ready-made pets from the moderated community gallery." as const;

export const HOME_COPY = {
  "eyebrow": "YOUR CHARACTER. YOUR CODING COMPANION.",
  "title": "Create your own animated pet for Codex",
  "description": "Describe a character or paste an image. Review its appearance, create nine animations, and download your pet.",
  "primary": "Create your pet",
  "primaryHref": "/generate",
  "secondary": "Explore the gallery",
  "secondaryHref": "/#gallery",
  "support": "No account needed · Experimental AI generation",
  "details": "How it works & limits",
  "detailsHref": "/guides/ai-pet-generator"
} as const;

export const HOME_STEPS = {
  "title": "From an idea to a pet of your own",
  "items": [
    {
      "title": "Describe or add an image",
      "body": "Start with a description, a picture, or both."
    },
    {
      "title": "Review your character",
      "body": "Check its appearance and refine it before animation."
    },
    {
      "title": "Animate and download",
      "body": "Confirm the character, preview all nine animations, and download your pack."
    }
  ]
} as const;

export const HOME_FAQ = {
  "title": "Before you create",
  "items": [
    {
      "question": "Can I start from an image?",
      "answer": "Yes. Paste, drag, or choose one PNG, JPEG or WebP image up to 5 MiB. Add a description if you want to change its appearance."
    },
    {
      "question": "What will I get?",
      "answer": "A downloadable Codex pet pack with nine animation states and 16 look directions. Review the result before downloading or sharing it."
    },
    {
      "question": "Will my pet appear in the gallery?",
      "answer": "Only if you submit it and it is approved. Your result starts with an unlisted link that anyone with the link can open. Download the files within 24 hours of task acceptance, including time in the queue."
    }
  ],
  "details": "Read the full guide and limits",
  "href": "/guides/ai-pet-generator"
} as const;

export const HOME_SEO = {
  "title": "AI Pet Generator for Codex | Codex Pets",
  "description": "Create your own animated Codex pet from text or an image. Review its appearance, generate nine animations, and download a ready-to-use pet pack.",
  "canonical": "https://pets.ydb-qdrant.tech/",
  "ogTitle": "Your idea. Your own Codex pet.",
  "ogDescription": "Start with a description or image. Review your character, animate it, and download your Codex pet.",
  "imageAlt": "An animated pet created with Codex Pets, shown with the creation steps."
} as const;

export const CATALOG_SEO = {
  "title": "Codex Pets Gallery | Animated pet packs",
  "description": "Explore approved animated Codex pets by name, style or tag. Preview the animations, download a pack, or use the gallery to inspire a pet of your own."
} as const;

export const ABOUT_COPY = {
  "title": "Create a pet that is yours",
  "lead": "Codex Pets helps you create your own animated pet for Codex from a description or image. You can review and refine the character, generate its animations, and download the pet pack. You can also browse and install ready-made pets from the moderated community gallery.",
  "sections": [
    {
      "title": "Start with your own idea",
      "body": "Describe a character, paste or drop a picture, or use both. Review and refine its appearance before confirming it for animation."
    },
    {
      "title": "Make it part of your workspace",
      "body": "Preview all nine animation states and 16 look directions, then download the Codex pet pack as a ZIP with pet.json and its spritesheet."
    },
    {
      "title": "Discover and share",
      "body": "The community gallery offers ready-made, approved pet packs. Your generated pet stays outside the public gallery unless you submit it and it is approved."
    }
  ]
} as const;

export const ABOUT_SEO = {
  "title": "About Codex Pets — Create and discover animated pets",
  "description": "Codex Pets helps you create custom animated pets from text or images, and discover ready-made pets in a moderated community gallery."
} as const;

export const HOME_ASK_AI = {
  "label": "Help me create or choose a Codex pet",
  "helper": "Ask your AI assistant for pet ideas or gallery recommendations.",
  "prompt": "Using current information from https://pets.ydb-qdrant.tech/ and https://pets.ydb-qdrant.tech/guides/ai-pet-generator, help me create or choose an animated Codex pet. Explain how I can start from a description or image, review the character, animate it, and download the pack. Suggest three distinct character ideas with short descriptions I can use in the generator, and offer existing gallery pets if I prefer a ready-made option. Link to /generate for self-service creation and mention the current limits and 24-hour retention. Do not submit a generation or call a paid/mutating tool without my explicit request.",
  "destinations": [
    "ChatGPT",
    "Perplexity",
    "Claude",
    "Google AI Mode",
    "Grok"
  ]
} as const;

export const AGENT_CREATION_GUIDANCE = "Send people to /generate for self-service creation. Remote MCP generation uses generate_pet and get_pet_generation; it is a service-paid, mutating operation, so require an explicit user request and preserve the requestId when retrying the same request. Do not imply that the npm CLI or browser WebMCP can generate pets, and do not infer support for image input in the remote MCP from the website image feature." as const;

export const RECOMMENDED_AGENT_TASKS = [
  "Create a custom animated Codex pet from an idea or reference image.",
  "Help write a character description for the website generator.",
  "Explain character review, animation, downloads, limits and privacy.",
  "Find and install a ready-made pet from the approved gallery."
] as const;


export const HOME_TEXT_ONLY_AI_PROMPT = "Using current information from https://pets.ydb-qdrant.tech/ and https://pets.ydb-qdrant.tech/guides/ai-pet-generator, help me create or choose an animated Codex pet. Suggest three character ideas with descriptions for the text generator, explain animation previews and downloads, and offer existing gallery pets if I prefer a ready-made option. Link to /generate for self-service creation and mention the current limits and 24-hour retention. Do not submit a generation or call a paid/mutating tool without my explicit request.";
