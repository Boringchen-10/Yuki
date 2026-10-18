import { invoke } from "@tauri-apps/api/core";

export type RulesNetworkMode = "auto" | "direct";
export interface RulesNetwork { mode: RulesNetworkMode }
export interface RulesNetworkProbe { source: "mirror" | "official"; milliseconds: number; error: string | null }
export const RULES_NETWORK_CHANGED = "yuki-rules-network-changed";
export const rulesNetworkApi = {
  get: () => invoke<RulesNetwork>("get_rules_network"),
  save: (config: RulesNetwork) => invoke<RulesNetwork>("save_rules_network", { config }),
  probe: () => invoke<RulesNetworkProbe[]>("probe_rules_network"),
};
