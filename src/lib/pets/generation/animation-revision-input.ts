import {z} from "zod";
import {PET_STATES} from "@/lib/pets/types";

export const ANIMATION_STATES = PET_STATES.map(state => state.key);
export type AnimationState = typeof ANIMATION_STATES[number];
export const animationStatesSchema = z.array(z.enum(ANIMATION_STATES)).min(1).max(9)
  .refine(states => new Set(states).size === states.length)
  .transform(states => ANIMATION_STATES.filter(state => states.includes(state)));
export const animationRevisionInputSchema = z.object({
  requestId: z.uuid(),
  states: animationStatesSchema,
  prompt: z.string().transform(value => value.replace(/\r\n?/g, "\n").trim()).pipe(z.string().max(2000)).optional(),
  sourceMetadataRevision: z.number().int().nonnegative(),
}).strict();
export type AnimationRevisionInput = z.infer<typeof animationRevisionInputSchema>;
export const animationCorrectionsSchema = z.partialRecord(z.enum(ANIMATION_STATES), z.array(z.string().min(1).max(2000))
  .max(4000).refine(lines => lines.join("\n\n").length <= 8000));
