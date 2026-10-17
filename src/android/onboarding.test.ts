import { describe, expect, it } from "vitest";
import { AGREEMENT_VERSION, ONBOARDING_KEY, readOnboarding, saveOnboarding } from "./onboarding";

const accepted = { agreementVersion: AGREEMENT_VERSION, acceptedAt: "2026-10-17T08:00:00.000Z" };
const storageWith = (value: string | null) => ({ getItem: () => value });

describe("Android first-run confirmation", () => {
  it("requires confirmation for a fresh install or an older agreement", () => {
    expect(readOnboarding(storageWith(null))).toBeNull();
    expect(readOnboarding(storageWith(JSON.stringify({ ...accepted, agreementVersion: "old", completedAt: accepted.acceptedAt })))).toBeNull();
  });
  it("recovers malformed records without treating them as consent", () => {
    for (const value of ["{", "null", "true", "[]", "{}", JSON.stringify({ ...accepted, acceptedAt: "invalid" })]) {
      expect(readOnboarding(storageWith(value))).toBeNull();
    }
  });
  it("resumes the source step separately from completed setup", () => {
    expect(readOnboarding(storageWith(JSON.stringify(accepted)))?.completedAt).toBeUndefined();
    const complete = { ...accepted, completedAt: "2026-10-17T08:01:00.000Z" };
    expect(readOnboarding(storageWith(JSON.stringify(complete)))).toEqual(complete);
    expect(readOnboarding(storageWith(JSON.stringify({ ...accepted, completedAt: true })))?.completedAt).toBeUndefined();
  });
  it("stores version and timestamps in a separate device-local key", () => {
    const values = new Map([["genzo-preferences", "existing preferences"]]);
    saveOnboarding({ setItem: (key, value) => { values.set(key, value); } }, accepted);
    expect(values.get("genzo-preferences")).toBe("existing preferences");
    expect(JSON.parse(values.get(ONBOARDING_KEY)!)).toEqual(accepted);
  });
  it("propagates storage failures so the UI can keep the gate closed", () => {
    expect(() => readOnboarding({ getItem: () => { throw new Error("read"); } })).toThrow("read");
    expect(() => saveOnboarding({ setItem: () => { throw new Error("write"); } }, accepted)).toThrow("write");
  });
});
