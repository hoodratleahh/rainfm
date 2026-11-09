import { before } from "@api/patcher";
import { FluxDispatcher } from "@metro/common";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { findByProps } from "@metro";

const masks = new Map<string, string>(); // sourceId → targetId

export function applyMask(sourceId: string, targetId: string) {
    masks.set(sourceId, targetId);
    // Ensure the target's profile is in cache before we try to read their avatar hash.
    // The profile card fetch already happens when the user opens a profile, but if the
    // swap is applied before that, the cache may be empty and avatar would render as default.
    try {
        const profileActions = findByProps("fetchProfile");
        (profileActions as any)?.fetchProfile?.(targetId);
    } catch (_) {}
    // 400 ms window for the fetch to populate the cache, then refresh
    setTimeout(() => refreshCurrentChannel(), 400);
}

function refreshCurrentChannel() {
    try {
        const channelId = (SelectedChannelStore as any).getChannelId?.();
        if (!channelId) return;

        // 1. Spoof USER_UPDATE for each masked source ID with the target's profile data.
        //    Discord message-item components subscribe to UserStore by author ID; this
        //    fires those subscriptions so they re-render and pick up the target's avatar
        //    via the getUser redirect that is already in place.
        for (const [sourceId, targetId] of masks) {
            const target = (UserStore as any).getUser?.(targetId);
            if (target) {
                (FluxDispatcher as any).dispatch({
                    type: "USER_UPDATE",
                    user: { ...target, id: sourceId },
                });
            }
        }

        // 2. Per-message MESSAGE_UPDATE with the author already swapped, covering
        //    any component that reads message.author directly instead of calling getUser.
        const MessageStore = findByProps("getMessages", "getMessage");
        if (!MessageStore) return;
        const collection = (MessageStore as any).getMessages(channelId);
        if (!collection) return;
        const msgs: any[] = collection._array ?? collection.toArray?.() ?? [];
        for (const msg of msgs) {
            if (msg?.author && masks.has(String(msg.author.id))) {
                (FluxDispatcher as any).dispatch({
                    type: "MESSAGE_UPDATE",
                    message: { ...msg, author: swapAuthor(msg.author), channel_id: channelId },
                    optimistic: false,
                });
            }
        }
    } catch (_) {}
}

export function removeMask(sourceId: string) {
    masks.delete(sourceId);
}

export function clearAllMasks() {
    masks.clear();
}

export function getMasks(): Map<string, string> {
    return masks;
}

function swapAuthor(author: any): any {
    if (!author?.id) return author;
    const targetId = masks.get(String(author.id));
    if (!targetId) return author;
    const target = (UserStore as any).getUser?.(targetId);
    if (!target) return { ...author, id: targetId, username: "Unknown", global_name: null, avatar: null };
    return { ...author, id: target.id, username: target.username, global_name: target.global_name ?? null, avatar: target.avatar ?? null };
}

function swapMessages(messages: any[]): void {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
        if (msg?.author && masks.has(String(msg.author.id))) {
            msg.author = swapAuthor(msg.author);
        }
    }
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
            if (e.message?.author && masks.has(String(e.message.author.id))) {
                e.message.author = swapAuthor(e.message.author);
            }
        } else if (e.type === "USER_PROFILE_FETCH_SUCCESS") {
            // Target profile just arrived in cache; re-run the refresh so avatar is now available
            const uid = String(e.user?.id ?? e.userId ?? "");
            if (uid && [...masks.values()].includes(uid)) {
                refreshCurrentChannel();
            }
        }
    };

    (FluxDispatcher as any).addInterceptor(handler);
    unpatches.push(() => (FluxDispatcher as any).removeInterceptor(handler));

    return () => { for (const fn of unpatches) fn(); };
}
