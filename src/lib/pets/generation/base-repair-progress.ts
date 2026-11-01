import {z} from "zod";
export const baseRepairProgressSchema=z.object({maxAttempts:z.number().int().min(1).max(51),attempts:z.number().int().min(0).max(51),phase:z.enum(["active","complete","stopped"]),retryAt:z.iso.datetime().optional()}).strict().refine(value=>value.attempts<=value.maxAttempts);
export type BaseRepairProgress=z.infer<typeof baseRepairProgressSchema>;
export function baseRepairProgressText(progress?:BaseRepairProgress):string|null {
  if(!progress || progress.phase==="complete")return null;
  if(progress.phase==="stopped")return `Base generation stopped after ${progress.attempts} of ${progress.maxAttempts} attempts.`;
  return `Base attempt ${Math.max(1,progress.attempts)} of ${progress.maxAttempts}.`+(progress.retryAt?" Waiting before the next attempt.":"");
}
