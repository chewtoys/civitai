import * as z from 'zod';

export const xguardModeSchema = z.enum(['text', 'prompt']);
export type XGuardMode = z.infer<typeof xguardModeSchema>;

const labelSchema = z.string().trim().min(1).max(100);

export const listPoliciesSchema = z.object({
  mode: xguardModeSchema,
});

export const getPolicySchema = z.object({
  mode: xguardModeSchema,
  label: labelSchema,
});

export const upsertPolicySchema = z.object({
  mode: xguardModeSchema,
  label: labelSchema,
  policy: z.string().min(1),
  threshold: z.number().min(0).max(1),
  action: z.string().min(1),
});

export const deletePolicySchema = z.object({
  mode: xguardModeSchema,
  label: labelSchema,
});

export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;
