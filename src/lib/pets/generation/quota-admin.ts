import { createQuotaAdminService } from "./quota-grants";
import { generationStore } from "./store";
import { readGenerationSecret } from "./model";
export const quotaAdmin = createQuotaAdminService(generationStore, { secret: readGenerationSecret });
