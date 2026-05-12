import {
  deletePolicySchema,
  getPolicySchema,
  listPoliciesSchema,
  upsertPolicySchema,
} from '~/server/schema/xguard-policy.schema';
import {
  deletePolicy,
  getPolicy,
  listPolicies,
  upsertPolicy,
} from '~/server/services/xguard-policy.service';
import { moderatorProcedure, router } from '~/server/trpc';

export const xguardPolicyRouter = router({
  list: moderatorProcedure
    .input(listPoliciesSchema)
    .query(({ input }) => listPolicies(input.mode)),

  get: moderatorProcedure
    .input(getPolicySchema)
    .query(({ input }) => getPolicy(input.mode, input.label)),

  upsert: moderatorProcedure.input(upsertPolicySchema).mutation(({ input, ctx }) => {
    const { mode, ...rest } = input;
    return upsertPolicy(mode, rest, ctx.user.id);
  }),

  delete: moderatorProcedure
    .input(deletePolicySchema)
    .mutation(({ input }) => deletePolicy(input.mode, input.label)),
});
