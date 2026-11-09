import { before } from "@api/patcher";
import { FluxDispatcher } from "@metro/common";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { findByProps } from "@metro";

import { rootSettings } from "./storage";

const masks = new Map<string, string>(); // sourceId → targetId

// Swapping rewrites the author on the store's own message objects, so the real
// one is kept alongside it — without this a reset has nothing to restore to.
const ORIGINAL_AUTHOR = "__lmpOriginalAuthor";

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

export function getAllMasks(): [string, string][] {
    return [...masks];
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
}

export function clearAllMasks() {
    masks.clear();
    persist();
    refreshCurrentChannel();
}

/** Drops the in-memory copy only; the saved swaps survive a plugin restart. */
export function forgetMasks() {
    masks.clear();
}

export function getMaskTarget(sourceId: string): string | undefined {
    return masks.get(sourceId);
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

export function getMaskCount(): number {
    return masks.size;
}

function refreshCurrentChannel() {
    try {
        const channelId = (SelectedChannelStore as any).getChannelId?.();
        if (!channelId) return;
        const MessageStore = findByProps("getMessages", "getMessage");
        if (!MessageStore) return;
        const collection = MessageStore.getMessages(channelId);
        if (!collection) return;
        // MessageStore uses an OrderedMap-like structure; _array holds the messages.
        // The array is newest-first, so reverse it before passing to LOAD_MESSAGES_SUCCESS
        // so Discord renders oldest at top, newest at bottom (correct order).
        const rawMsgs: any[] = collection._array ?? collection.toArray?.() ?? [];
        const msgs = rawMsgs.slice().reverse();
        swapMessages(msgs);
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
        });
    } catch (_) {}
}

function swapAuthor(author: any): any {
    if (!author?.id) return author;
    const targetId = masks.get(String(author.id));
    if (!targetId) return author;
    const target = (UserStore as any).getUser?.(targetId);
    if (!target) return { ...author, id: targetId, username: "Unknown", global_name: null, avatar: null };
    // UserStore stores display name as camelCase globalName; message author object uses snake_case global_name
    const displayName = target.globalName ?? target.global_name ?? null;
    return { ...author, id: target.id, username: target.username, global_name: displayName, avatar: target.avatar ?? null };
}

function swapMessage(msg: any): void {
    const original = msg?.[ORIGINAL_AUTHOR] ?? msg?.author;
    if (!original?.id) return;
    if (masks.has(String(original.id))) {
        msg[ORIGINAL_AUTHOR] = original;
        msg.author = swapAuthor(original);
    } else if (msg[ORIGINAL_AUTHOR]) {
        msg.author = original;
        Reflect.deleteProperty(msg, ORIGINAL_AUTHOR);
    }
}

function swapMessages(messages: any[]): void {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) swapMessage(msg);
}

export function patchUserStoreMask(): () => void {
    const unpatches: (() => void)[] = [];

    unpatches.push(before("getUser", UserStore as any, (args: any[]) => {
        const id = String(args[0] ?? "");
        if (id && masks.has(id)) args[0] = masks.get(id);
    }));

    const handler = (e: any) => {
        if (e.type === "LOAD_MESSAGES_SUCCESS") {
            swapMessages(e.messages);
            swapMessages(e.jumpTargetMessages);
        } else if (e.type === "MESSAGE_CREATE") {
            swapMessage(e.message);
        }
    };

    (FluxDispatcher as any).addInterceptor(handler);
    unpatches.push(() => (FluxDispatcher as any).removeInterceptor(handler));

    return () => { for (const fn of unpatches) fn(); };
}
