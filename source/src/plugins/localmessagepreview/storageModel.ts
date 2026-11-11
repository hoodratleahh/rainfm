import type { Preset, RootStorage } from "./types";

export function defaultPreset(name = "New preset"): Preset {
    return {
        name,
        channelId: "",
        targetUserId: "",
        messages: [""],
        showEmbedPreview: false,
        embedImageUrl: "",
    };
}

export function ensurePreset(r: Preset): void {
    if (typeof r.name !== "string") r.name = "Preset";
    if (typeof r.channelId !== "string") r.channelId = "";
    if (!Array.isArray(r.messages) || r.messages.length === 0) r.messages = [""];
    if (typeof r.showEmbedPreview !== "boolean") r.showEmbedPreview = false;
    if (typeof r.embedImageUrl !== "string") r.embedImageUrl = "";
    if (typeof r.targetUserId !== "string") r.targetUserId = "";
    for (const key of ["variantCustomSentAtEnabled", "variantSentAtIso", "customSentAtEnabled", "sentAtIso"]) {
        Reflect.deleteProperty(r, key);
    }
}

export function ensureRoot(st: RootStorage): void {
    if (!Array.isArray(st.rules)) st.rules = [];
    if (!Array.isArray(st.cached)) st.cached = [];
    if (typeof st.autoReplayOnLoad !== "boolean") st.autoReplayOnLoad = true;
    if (!st.masks || typeof st.masks !== "object" || Array.isArray(st.masks)) st.masks = {};
    if (!Array.isArray(st.savedChats)) st.savedChats = [];
    for (const rule of st.rules) ensurePreset(rule);
}

export function commitPreset(st: RootStorage, index: number, next: Preset): void {
    if (!st.rules[index]) return;
    const copy = [...st.rules];
    copy[index] = { ...next };
    ensurePreset(copy[index]);
    st.rules = copy;
}

export function deletePreset(st: RootStorage, index: number): void {
    const copy = [...st.rules];
    copy.splice(index, 1);
    st.rules = copy;
}
