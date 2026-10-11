import { invoke } from "@tauri-apps/api/core";
import type { PlayerSnapshot } from "./api";

export interface RulePlugin { id: string; name: string; version: string; enabled: boolean; origin: string | null; updatedAt: string }
export interface RuleCatalogItem { name: string; version: string; author?: string; lastUpdate?: number; antiCrawlerEnabled?: boolean }
export interface RuleItem { name: string; source: string }
export interface RuleEpisode { name: string; url: string }
export interface RuleRoad { name: string; episodes: RuleEpisode[] }
export interface RuleSearch { items: RuleItem[]; stale: boolean; warning: string | null; verificationRequired: boolean; verificationUrl: string | null }
export interface RuleChapters { roads: RuleRoad[]; stale: boolean; warning: string | null; verificationRequired: boolean; verificationUrl: string | null }
export interface RuleBinding { workId: string; pluginId: string; source: string; title: string; roadIndex: number; episodeIndexes: number[]; episodeOffset: number; replaceExisting?: boolean }
export interface RuleBindingPreview { token: string; title: string; road: string; rows: { index: number; name: string; originalEpisode: number | null; officialEpisode: number | null; officialTitle: string | null; existing: boolean; conflict: boolean }[] }
export interface WorkRuleSource { pluginId: string; name: string; source: string; title: string }
export const rulesApi = {
  plugins: () => invoke<RulePlugin[]>("list_rule_plugins"),
  definition: (id: string) => invoke<unknown>("get_rule_definition", { id }),
  catalog: (fresh = false) => invoke<{ items: RuleCatalogItem[]; stale: boolean; warning?: string }>("get_rule_catalog", { fresh }),
  install: (name: string) => invoke<string>("install_catalog_rule", { name }),
  import: (definition: unknown, origin: string | null = null) => invoke<string>("import_rule_plugin", { definition, origin }),
  importUrl: (url: string) => invoke<string>("import_rule_url", { url }),
  update: (id: string) => invoke<string>("update_rule_plugin", { id }),
  enabled: (id: string, enabled: boolean, remove = false) => invoke<void>("set_rule_plugin_enabled", { id, enabled, remove }),
  search: (pluginId: string, keyword: string, fresh = false) => invoke<RuleSearch>("search_rule_source", { pluginId, keyword, fresh }),
  chapters: (pluginId: string, source: string, fresh = false) => invoke<RuleChapters>("get_rule_chapters", { pluginId, source, fresh }),
  preview: (pluginId: string, source: string, roadIndex: number, episodeIndex: number) => invoke<PlayerSnapshot>("preview_rule_episode", { pluginId, source, roadIndex, episodeIndex }),
  cancelResolve: () => invoke<void>("cancel_rule_resolve"),
  verify: (pluginId: string, keyword: string, url: string | null = null) => invoke<void>("verify_rule_source", { pluginId, keyword, url }),
  bindingPreview: (input: RuleBinding) => invoke<RuleBindingPreview>("preview_rule_binding", { input }),
  bind: (input: RuleBinding, token: string) => invoke<string[]>("bind_rule_episodes", { input, token }),
  play: (input: RuleBinding) => invoke<PlayerSnapshot>("play_rule_episode", { input }),
  workSources: (workId: string) => invoke<WorkRuleSource[]>("list_work_rule_sources", { workId }),
};
