export function buildPetRequestInfo(pageUrl: string) {
  return {
    request: {
      pageUrl,
      method: "Open the public request page and submit the form there.",
      privacy:
        "Pet generation requests are private to admins. Completed pets are linked manually after upload.",
      fields: [
        {
          name: "contactEmail",
          required: true,
          description: "Contact email for follow-up about the request.",
        },
        {
          name: "prompt",
          required: true,
          maxLength: 2000,
          description:
            "Short brief describing the character, object, mood, colors, and must-have details.",
        },
        {
          name: "kind",
          required: false,
          values: ["creature", "object", "character"],
          default: "creature",
        },
        {
          name: "requesterName",
          required: false,
          maxLength: 80,
        },
        {
          name: "displayNameHint",
          required: false,
          maxLength: 80,
        },
        {
          name: "referenceImage",
          required: false,
          contentTypes: ["image/png", "image/jpeg", "image/webp"],
          maxBytes: 5242880,
        },
      ],
    },
  };
}
