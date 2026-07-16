export type SpriteVersionNumber = 1 | 2;

export type PetSheet = {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly width: number;
  readonly height: number;
};

const PET_CELL = {
  columns: 8,
  cellWidth: 192,
  cellHeight: 208,
} as const;

export const PET_SHEETS = {
  1: {
    ...PET_CELL,
    rows: 9,
    width: 1536,
    height: 1872,
  },
  2: {
    ...PET_CELL,
    rows: 11,
    width: 1536,
    height: 2288,
  },
} as const satisfies Record<SpriteVersionNumber, PetSheet>;

export const PET_SHEET = PET_SHEETS[1];

export function resolveSpriteVersionNumber(
  version?: SpriteVersionNumber,
): SpriteVersionNumber {
  return version ?? 1;
}

export function getPetSheet(version?: SpriteVersionNumber) {
  return PET_SHEETS[resolveSpriteVersionNumber(version)];
}

export function inferSpriteVersionNumber(
  width: number,
  height: number,
): SpriteVersionNumber | null {
  for (const version of [1, 2] as const) {
    const sheet = PET_SHEETS[version];
    if (width === sheet.width && height === sheet.height) return version;
  }
  return null;
}

const LOOK_DIRECTION_LABELS = [
  "Up",
  "Up-right",
  "Up-right",
  "Up-right",
  "Right",
  "Down-right",
  "Down-right",
  "Down-right",
  "Down",
  "Down-left",
  "Down-left",
  "Down-left",
  "Left",
  "Up-left",
  "Up-left",
  "Up-left",
] as const;

export type LookDirectionCell = {
  index: number;
  row: 9 | 10;
  column: number;
  degrees: number;
  displayDegrees: string;
  accessibleLabel: string;
  label: (typeof LOOK_DIRECTION_LABELS)[number];
};

export function getLookDirectionCell(index: number): LookDirectionCell | null {
  if (!Number.isInteger(index) || index < 0 || index >= 16) return null;

  const degrees = index * 22.5;
  const displayDegrees = formatLookDirectionDegrees(degrees);
  const label = LOOK_DIRECTION_LABELS[index];
  return {
    index,
    row: index < 8 ? 9 : 10,
    column: index % 8,
    degrees,
    displayDegrees,
    accessibleLabel: `${displayDegrees} ${label}`,
    label,
  };
}

export const PET_LOOK_DIRECTIONS = Array.from({ length: 16 }, (_, index) =>
  getLookDirectionCell(index),
).filter((direction): direction is LookDirectionCell => direction !== null);

function formatLookDirectionDegrees(degrees: number): string {
  const [whole, fraction] = String(degrees).split(".");
  return `${whole.padStart(3, "0")}${fraction ? `.${fraction}` : ""}°`;
}

export const PET_STATES = [
  {
    key: "idle",
    label: "Idle",
    row: 0,
    frames: 6,
    description: "Neutral breathing and blinking loop",
  },
  {
    key: "running-right",
    label: "Run Right",
    row: 1,
    frames: 8,
    description: "Directional locomotion to the right",
  },
  {
    key: "running-left",
    label: "Run Left",
    row: 2,
    frames: 8,
    description: "Directional locomotion to the left",
  },
  {
    key: "waving",
    label: "Waving",
    row: 3,
    frames: 4,
    description: "Friendly attention gesture",
  },
  {
    key: "jumping",
    label: "Jumping",
    row: 4,
    frames: 5,
    description: "Short vertical movement",
  },
  {
    key: "failed",
    label: "Failed",
    row: 5,
    frames: 8,
    description: "Failure or blocked state",
  },
  {
    key: "waiting",
    label: "Waiting",
    row: 6,
    frames: 6,
    description: "Waiting for user input",
  },
  {
    key: "running",
    label: "Running",
    row: 7,
    frames: 6,
    description: "Active work in progress",
  },
  {
    key: "review",
    label: "Review",
    row: 8,
    frames: 6,
    description: "Reviewing or thinking state",
  },
] as const;

export type PetKind = "creature" | "object" | "character";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "deleted";
export type GenerationRequestStatus =
  | "pending"
  | "in_progress"
  | "fulfilled"
  | "rejected"
  | "deleted";

export type PetGenerationRequestReferenceImage = {
  url: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type PublicPet = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  petJsonUrl: string;
  zipUrl: string;
  spritesheetExt: "webp" | "png";
  kind: PetKind;
  tags: string[];
  status: ApprovalStatus;
  ownerName: string | null;
  ownerProfileSlug?: string | null;
  ownerAvatarUrl?: string | null;
  contactEmail: string | null;
  createdAt: string;
  approvedAt: string | null;
  downloadCount: number;
  installCount: number;
  likeCount: number;
};

export type PublicPetSummary = Omit<PublicPet, "contactEmail">;

export type PetGenerationRequest = {
  id: string;
  status: GenerationRequestStatus;
  kind: PetKind;
  displayNameHint: string | null;
  prompt: string;
  contactEmail: string;
  requesterName: string | null;
  requesterUserId: string | null;
  requesterProfileSlug?: string | null;
  linkedPetId: string | null;
  linkedPetSlug: string | null;
  referenceImage: PetGenerationRequestReferenceImage | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  rejectedAt: string | null;
};
