export const PET_SHEET = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  width: 1536,
  height: 1872,
} as const;

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
  contactEmail: string | null;
  createdAt: string;
  approvedAt: string | null;
  downloadCount: number;
};
