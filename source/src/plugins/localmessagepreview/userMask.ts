import { before } from "@api/patcher";
import { FluxDispatcher } from "@metro/common";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { findByProps } from "@metro";

const masks = new Map<string, string>(); // sourceId → targetId

export function applyMask(sourceId: string, targetId: string) {
    masks.set(sourceId, targetId);
    refreshCurrentChannel();
}

function refreshCurrentChannel() {
    try {
        const channelId = (SelectedChannelStore as any).getChannelId?.();
        if (!channelId) return;
        const MessageStore = findByProps("getMessages", "getMessage");
        if (!MessageStore) return;
        const collection = MessageStore.getMessages(channelId);
        if (!collection) return;
        const msgs: any[] = collection._array ?? collection.toArray?.() ?? [];
        for (const msg of msgs) {
            if (msg?.author && masks.has(String(msg.author.id))) {
                // Use MESSAGE_UPDATE per message so Discord doesn't reorder the list
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
    // Keep the original avatar and id so the photo in messages matches the DM header.
    // Only swap the display name so the author card shows the target's name.
    if (!target) return { ...author, username: "Unknown", global_name: null };
    return { ...author, username: target.username, global_name: target.global_name ?? null };
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
        }
    };

    (FluxDispatcher as any).addInterceptor(handler);
    unpatches.push(() => (FluxDispatcher as any).removeInterceptor(handler));

    return () => { for (const fn of unpatches) fn(); };
}
