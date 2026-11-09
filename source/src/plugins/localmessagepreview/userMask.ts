import { before } from "@api/patcher";
import { FluxDispatcher } from "@metro/common";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { findByProps } from "@metro";

import { rootSettings } from "./storage";

const masks = new Map<string, string>(); // sourceId → targetId

// messageId → the author Discord really sent. The message store rebuilds its
// records from whatever it is handed, dropping any marker left on the message,
// so the truth has to live outside the messages.
const realAuthors = new Map<string, any>();

const REFRESH_FLAG = "__lmpRefresh";
const PAGE_SIZE = 50;
const MAX_HEAL_PAGES = 5;

let bypassMask = false;
let messageStore: any;

function getMessageStore(): any {
    return messageStore ??= findByProps("getMessages", "getMessage");
}

function getRealUser(id: string): any {
    bypassMask = true;
    try {
        return (UserStore as any).getUser?.(id);
    } finally {
        bypassMask = false;
    }
}

function persist(): void {
    const out: Record<string, string> = {};
    for (const [source, target] of masks) out[source] = target;
    (rootSettings as any).masks = out;
}

export function loadMasks(): void {
    const saved = (rootSettings as any).masks;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    for (const [source, target] of Object.entries(saved)) {
        if (typeof target === "string" && target && !masks.has(source)) masks.set(source, target);
    }
    if (masks.size > 0) refreshCurrentChannel();
}

export function applyMask(sourceId: string, targetId: string) {
    masks.set(sourceId, targetId);
    persist();
    refreshCurrentChannel();
}

export function removeMask(sourceId: string) {
    masks.delete(sourceId);
    persist();
    refreshCurrentChannel();
    void healCurrentChannelFromServer();
}

export function clearAllMasks() {
    masks.clear();
    persist();
    refreshCurrentChannel();
    void healCurrentChannelFromServer();
}

/** Drops the in-memory copy only; the saved swaps survive a plugin restart. */
export function forgetMasks() {
    masks.clear();
    refreshCurrentChannel();
    realAuthors.clear();
}

export function getMaskTarget(sourceId: string): string | undefined {
    return masks.get(sourceId);
}

export function getAllMasks(): [string, string][] {
    return [...masks];
}

// A swapped profile reports the target's ID everywhere in the UI, so an ID read
// off the screen may be either side of a swap.
export function findMaskSources(userId: string): string[] {
    if (masks.has(userId)) return [userId];
    const sources: string[] = [];
    for (const [source, target] of masks) {
        if (target === userId) sources.push(source);
    }
    return sources;
}

// ── Author shapes ─────────────────────────────────────────────────────────────

// Server payloads carry plain snake_case authors; the store holds user records.
function isRecord(author: any): boolean {
    return Object.getPrototypeOf(author) !== Object.prototype;
}

function asStoreAuthor(real: any): any {
    const known = getRealUser(String(real.id));
    if (known) return known;
    return isRecord(real) ? real : { ...real, globalName: real.globalName ?? real.global_name ?? null };
}

function swapAuthor(author: any): any {
    const targetId = masks.get(String(author.id));
    if (!targetId) return author;
    const target = getRealUser(targetId);
    if (!target) {
        return { ...author, id: targetId, username: "Unknown", global_name: null, globalName: null, avatar: null };
    }
    if (isRecord(author)) return target;
    const displayName = target.globalName ?? target.global_name ?? null;
    return {
        ...author,
        id: target.id,
        username: target.username,
        discriminator: target.discriminator ?? author.discriminator,
        global_name: displayName,
        globalName: displayName,
        avatar: target.avatar ?? null,
    };
}

// ── Applying swaps ────────────────────────────────────────────────────────────

// A message already sitting in the store: swap it, or put the real author back.
function syncStoredMessage(msg: any): void {
    if (!msg?.id || !msg.author?.id) return;
    const key = String(msg.id);
    const real = realAuthors.get(key) ?? msg.author;
    if (masks.has(String(real.id))) {
        realAuthors.set(key, real);
        msg.author = swapAuthor(asStoreAuthor(real));
    } else if (realAuthors.has(key)) {
        msg.author = asStoreAuthor(real);
        realAuthors.delete(key);
    }
}

// A message straight from Discord: its author is the truth, so it also corrects
// any stored copy that is still wearing an old swap.
function applyServerMessage(channelId: string | undefined, raw: any): void {
    if (!raw?.id || !raw.author?.id) return;
    const key = String(raw.id);
    const real = raw.author;
    const masked = masks.has(String(real.id));

    if (masked) realAuthors.set(key, real);
    else realAuthors.delete(key);

    const stored = channelId ? getMessageStore()?.getMessage?.(channelId, raw.id) : undefined;
    if (stored && stored !== raw && stored.author) {
        if (masked) stored.author = swapAuthor(asStoreAuthor(real));
        else if (String(stored.author.id) !== String(real.id)) stored.author = asStoreAuthor(real);
    }

    if (masked) raw.author = swapAuthor(real);
}

function storedMessages(channelId: string): any[] {
    const collection = getMessageStore()?.getMessages?.(channelId);
    return collection?._array ?? collection?.toArray?.() ?? [];
}

function refreshChannel(channelId: string): void {
    // _array is newest-first; LOAD_MESSAGES_SUCCESS wants oldest-first.
    const msgs = storedMessages(channelId).slice().reverse();
    for (const msg of msgs) syncStoredMessage(msg);
    // hasMoreBefore: true keeps the scroll anchored at the bottom (most recent messages)
    (FluxDispatcher as any).dispatch({
        type: "LOAD_MESSAGES_SUCCESS",
        channelId,
        messages: msgs,
        isBefore: false,
        isAfter: false,
        hasMoreBefore: true,
        hasMoreAfter: false,
        limit: msgs.length,
        [REFRESH_FLAG]: true,
    });
}

function refreshCurrentChannel(): void {
    try {
        const channelId = (SelectedChannelStore as any).getChannelId?.();
        if (channelId) refreshChannel(channelId);
    } catch (_) {}
}

function isOlder(id: unknown, than: unknown): boolean {
    const a = String(id), b = String(than);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    return BigInt(a) < BigInt(b);
}

// Messages that were swapped in an earlier session have no recorded real author,
// so a reset re-reads the open conversation from Discord and corrects them.
async function healCurrentChannelFromServer(): Promise<void> {
    try {
        const channelId = (SelectedChannelStore as any).getChannelId?.();
        const api = findByProps("getAPIBaseURL", "del") as any;
        if (!channelId || typeof api?.get !== "function") return;

        const stored = storedMessages(channelId);
        let before: string | undefined;
        for (let page = 0; page < MAX_HEAL_PAGES; page++) {
            const query: Record<string, unknown> = { limit: PAGE_SIZE };
            if (before) query.before = before;
            const res = await api.get({ url: `/channels/${channelId}/messages`, query });
            const body = res?.body;
            if (!Array.isArray(body) || body.length === 0) break;

            for (const raw of body) applyServerMessage(channelId, raw);

            before = String(body[body.length - 1].id);
            if (body.length < PAGE_SIZE) break;
            if (!stored.some(msg => isOlder(msg?.id, before))) break;
        }

        refreshChannel(channelId);
    } catch (_) {}
}

// ── Patches ───────────────────────────────────────────────────────────────────

export function patchUserStoreMask(): () => void {
    const unpatches: (() => void)[] = [];

    unpatches.push(before("getUser", UserStore as any, (args: any[]) => {
        if (bypassMask) return;
        const id = String(args[0] ?? "");
        if (id && masks.has(id)) args[0] = masks.get(id);
    }));

    const handler = (e: any) => {
        if (e.type === "LOAD_MESSAGES_SUCCESS") {
            if (e[REFRESH_FLAG]) return;
            for (const list of [e.messages, e.jumpTargetMessages]) {
                if (!Array.isArray(list)) continue;
                for (const raw of list) applyServerMessage(e.channelId, raw);
            }
        } else if (e.type === "MESSAGE_CREATE") {
            applyServerMessage(undefined, e.message);
        }
    };

    (FluxDispatcher as any).addInterceptor(handler);
    unpatches.push(() => (FluxDispatcher as any).removeInterceptor(handler));

    return () => { for (const fn of unpatches) fn(); };
}
