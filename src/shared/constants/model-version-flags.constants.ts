/**
 * Model Version Flags — Bitwise opt-out / behavior flags stored on `ModelVersion.flags`.
 *
 * Each flag is a power of 2 so they can be combined with bitwise OR.
 * Use `Flags.hasFlag(modelVersion.flags, ModelVersionFlag.DisableTips)` to check.
 */
export const ModelVersionFlag = {
  None: 0,

  /** This version opts out of creator tips (e.g. licensed models). */
  DisableTips: 1 << 0, // 1
} as const;

export type ModelVersionFlagValue = (typeof ModelVersionFlag)[keyof typeof ModelVersionFlag];

export const modelVersionFlagLabels: Record<number, string> = {
  [ModelVersionFlag.DisableTips]: 'Disable creator tips',
};
