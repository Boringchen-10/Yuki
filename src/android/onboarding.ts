export const AGREEMENT_VERSION = "2026-10-17";
export const ONBOARDING_KEY = "yuki-android-onboarding";

export interface OnboardingRecord {
  agreementVersion: string;
  acceptedAt: string;
  completedAt?: string;
}

export function readOnboarding(storage: Pick<Storage, "getItem">): OnboardingRecord | null {
  const raw = storage.getItem(ONBOARDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OnboardingRecord> | null;
    if (value?.agreementVersion !== AGREEMENT_VERSION || typeof value.acceptedAt !== "string" || !Number.isFinite(Date.parse(value.acceptedAt))) return null;
    return { agreementVersion: AGREEMENT_VERSION, acceptedAt: value.acceptedAt,
      completedAt: typeof value.completedAt === "string" && Number.isFinite(Date.parse(value.completedAt)) ? value.completedAt : undefined };
  } catch { return null; }
}

export function saveOnboarding(storage: Pick<Storage, "setItem">, record: OnboardingRecord): void {
  storage.setItem(ONBOARDING_KEY, JSON.stringify(record));
}
