import { findByProps } from "@metro";
import { FluxDispatcher } from "@metro/common";
import { ChannelStore, PrivateChannelSortStore, SelectedChannelStore, UserStore } from "@metro/common/stores";

import { dispatchLocalMessage } from "./dispatch";
import { rootSettings } from "./storage";
import type { PortableAuthor, PortableMessage, SavedChat } from "./types";
import { getMessageStore, REFRESH_FLAG, resortChannel, storedMessages } from "./userMask";

export const DATA_FORMAT = "localmessagepreview";
const DATA_VERSION = 1;
const MAX_IMPORT = 2000;
const DISCORD_EPOCH_MS = 1420070400000;
const SNOWFLAKE = /^\d{15,25}$/;

type Raw = Record<string, any>;

// ── Small helpers ─────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function toIso(value: any): string | null {
    if (value == null || value === "") return null;
    try {
        const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    } catch (_) {
        return null;
    }
}

function idValue(id: unknown): bigint {
    const text = String(id ?? "");
    return /^\d+$/.test(text) ? BigInt(text) : 0n;
}

/** A message ID that sorts where `ms` falls in time, unique per call. */
function snowflakeAt(ms: number): string {
    const since = BigInt(Math.max(Math.floor(ms), DISCORD_EPOCH_MS + 1) - DISCORD_EPOCH_MS);
    return String((since << 22n) | BigInt(Math.floor(Math.random() * 0x3fffff)));
}

function cached(): Raw[] {
    const list = (rootSettings as any).cached;
    return Array.isArray(list) ? list : [];
}

function cachedFor(channelId: string): Raw[] {
    return cached().filter(msg => String(msg?.channel_id) === channelId);
}

// ── Chats ─────────────────────────────────────────────────────────────────────

export interface ChatChoice {
    id: string;
    name: string;
}

export function currentChannelId(): string | undefined {
    return (SelectedChannelStore as any).getChannelId?.() || undefined;
}

export function channelName(channelId: string): string {
    const channel = (ChannelStore as any).getChannel?.(channelId);
    if (!channel) return `Channel ${channelId}`;
    if (channel.type !== 1 && channel.type !== 3) return channel.name ? `#${channel.name}` : `Channel ${channelId}`;

    const names = (channel.recipients ?? [])
        .map((id: string) => (UserStore as any).getUser?.(id))
        .filter(Boolean)
        .map((user: any) => user.globalName || user.username);
    return channel.name || names.join(", ") || "Direct Message";
}

/** Every DM and group DM, most recent first. */
export function listDirectMessages(): ChatChoice[] {
    const ids: string[] = (PrivateChannelSortStore as any).getPrivateChannelIds?.() ?? [];
    return ids.flatMap(id => {
        const channel = (ChannelStore as any).getChannel?.(id);
        if (!channel || (channel.type !== 1 && channel.type !== 3)) return [];
        return [{ id, name: channelName(id) }];
    });
}

// ── Authors ───────────────────────────────────────────────────────────────────

export function toAuthor(user: any, fallbackId = ""): PortableAuthor {
    return {
        id: String(user?.id ?? fallbackId),
        username: typeof user?.username === "string" ? user.username : "Unknown",
        discriminator: typeof user?.discriminator === "string" ? user.discriminator : "0",
        global_name: user?.globalName ?? user?.global_name ?? null,
        avatar: typeof user?.avatar === "string" ? user.avatar : null,
        bot: !!user?.bot,
    };
}

/** Blank means the logged-in account. Unknown users are looked up once. */
export async function resolveAuthor(userId: string): Promise<PortableAuthor> {
    const id = userId.trim();
    if (!id) return toAuthor((UserStore as any).getCurrentUser?.());
    if (!SNOWFLAKE.test(id)) throw new Error("That user ID isn't valid.");

    let user = (UserStore as any).getUser?.(id);
    if (!user) {
        try {
            const fetching = (findByProps("getUser", "fetchProfile") as any)?.getUser?.(id);
            await Promise.race([fetching, new Promise(resolve => setTimeout(resolve, 4000))]);
        } catch (_) { /* fall through to the placeholder */ }
        user = (UserStore as any).getUser?.(id);
    }
    return toAuthor(user, id);
}

// ── Reading a chat ────────────────────────────────────────────────────────────

function mediaToRaw(media: any): Raw | undefined {
    if (!media?.url) return undefined;
    return {
        url: media.url,
        proxy_url: media.proxyURL ?? media.proxy_url ?? media.url,
        width: media.width,
        height: media.height,
    };
}

// The store keeps embeds in its own shape; turn one back into the API's.
function embedToRaw(embed: any): Raw {
    const out: Raw = { type: embed?.type ?? "rich" };
    const title = embed?.rawTitle ?? embed?.title;
    const description = embed?.rawDescription ?? embed?.description;
    if (typeof title === "string") out.title = title;
    if (typeof description === "string") out.description = description;
    if (typeof embed?.url === "string") out.url = embed.url;
    if (typeof embed?.color === "number") out.color = embed.color;
    for (const key of ["image", "thumbnail", "video"]) {
        const media = mediaToRaw(embed?.[key]);
        if (media) out[key] = media;
    }
    if (embed?.author?.name) {
        out.author = { name: embed.author.name, url: embed.author.url, icon_url: embed.author.iconURL ?? embed.author.icon_url };
    }
    if (embed?.footer?.text) {
        out.footer = { text: embed.footer.text, icon_url: embed.footer.iconURL ?? embed.footer.icon_url };
    }
    if (embed?.provider?.name) out.provider = { name: embed.provider.name, url: embed.provider.url };
    if (Array.isArray(embed?.fields)) {
        out.fields = embed.fields.map((field: any) => ({
            name: field?.rawName ?? field?.name ?? "",
            value: field?.rawValue ?? field?.value ?? "",
            inline: !!field?.inline,
        }));
    }
    return out;
}

// Ordinary messages and replies only; a reply is kept as a plain message since
// what it points at does not exist in the chat it gets imported into.
function isPortableType(type: unknown): boolean {
    return type == null || type === 0 || type === 19;
}

function normalize(input: any, fromStore: boolean): PortableMessage | null {
    if (!input || typeof input !== "object" || !isPortableType(input.type)) return null;

    const timestamp = toIso(input.timestamp);
    const author = input.author;
    if (!timestamp || !author?.id) return null;

    const embeds = Array.isArray(input.embeds) ? input.embeds : [];
    const stickers = input.sticker_items ?? input.stickerItems;

    const message: PortableMessage = {
        id: input.id != null ? String(input.id) : undefined,
        content: typeof input.content === "string" ? input.content : "",
        timestamp,
        edited_timestamp: toIso(input.edited_timestamp ?? input.editedTimestamp),
        author: toAuthor(author),
        attachments: Array.isArray(input.attachments) ? clone(input.attachments) : [],
        embeds: fromStore ? embeds.map(embedToRaw) : clone(embeds),
    };
    if (Array.isArray(stickers) && stickers.length > 0) message.sticker_items = clone(stickers);
    return message;
}

function byTime(a: PortableMessage, b: PortableMessage): number {
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
}

/**
 * The messages of a chat, oldest first. A chat that is already loaded is read
 * as it appears on screen; any other is fetched from Discord (latest 100).
 */
export async function readChat(channelId: string): Promise<PortableMessage[]> {
    const loaded = storedMessages(channelId);
    let messages = loaded.map(msg => normalize(msg, true));

    if (loaded.length === 0) {
        const api = findByProps("getAPIBaseURL", "del") as any;
        if (typeof api?.get !== "function") throw new Error("Open that chat once, then try again.");
        const res = await api.get({ url: `/channels/${channelId}/messages`, query: { limit: 100 } });
        const body = Array.isArray(res?.body) ? res.body : [];
        messages = body.map((msg: any) => normalize(msg, false));
    }

    return (messages.filter(Boolean) as PortableMessage[]).sort(byTime);
}

// ── Data codes ────────────────────────────────────────────────────────────────

export function toDataCode(name: string, messages: PortableMessage[]): string {
    return JSON.stringify({ format: DATA_FORMAT, version: DATA_VERSION, name, messages }, null, 2);
}

/** Accepts a data code, a bare list of messages, or a single message. */
export function parseDataCode(text: string): { name: string; messages: PortableMessage[] } {
    let data: any;
    try {
        data = JSON.parse(text.trim());
    } catch (_) {
        throw new Error("That isn't a data code (not valid JSON).");
    }

    let list: any[];
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.messages)) list = data.messages;
    else if (data && typeof data === "object" && data.author) list = [data];
    else throw new Error("No messages found in that data code.");

    const messages = (list.slice(0, MAX_IMPORT).map(item => normalize(item, false)).filter(Boolean) as PortableMessage[])
        .sort(byTime);
    if (messages.length === 0) throw new Error("No usable messages in that data code.");

    const name = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Imported chat";
    return { name, messages };
}

/** Shifts every message so the first lands on newStartMs; the gaps between them stay as they were. */
export function retimeMessages(messages: PortableMessage[], newStartMs: number): PortableMessage[] {
    if (messages.length === 0) return messages;
    const delta = newStartMs - Date.parse(messages[0].timestamp);
    if (!delta || !Number.isFinite(delta)) return messages;
    const shift = (iso: string | null) => (iso ? new Date(Date.parse(iso) + delta).toISOString() : iso);
    return messages.map(m => ({
        ...m,
        timestamp: shift(m.timestamp) as string,
        edited_timestamp: shift(m.edited_timestamp),
    }));
}

/** The chat's authors in order of first appearance, with how many messages each sent. */
export function listAuthors(messages: PortableMessage[]): { author: PortableAuthor; count: number }[] {
    const seen = new Map<string, { author: PortableAuthor; count: number }>();
    for (const m of messages) {
        const entry = seen.get(m.author.id);
        if (entry) entry.count += 1;
        else seen.set(m.author.id, { author: m.author, count: 1 });
    }
    return [...seen.values()];
}

/** Every message `fromId` sent, shown as `author` instead. */
export function replaceAuthor(messages: PortableMessage[], fromId: string, author: PortableAuthor): PortableMessage[] {
    return messages.map(m => (m.author.id === fromId ? { ...m, author: { ...author } } : m));
}

/** resolveAuthor, but a user that can't be found is an error, not a placeholder. */
export async function resolveKnownAuthor(userId: string): Promise<PortableAuthor> {
    const author = await resolveAuthor(userId);
    if (author.username === "Unknown" && !author.global_name && !author.avatar) {
        throw new Error(`No user found for ID ${author.id} — check the ID and your connection.`);
    }
    return author;
}

// ── Saved chats ───────────────────────────────────────────────────────────────

export function addSavedChat(name: string, messages: PortableMessage[]): SavedChat {
    const chat: SavedChat = {
        id: snowflakeAt(Date.now()),
        name,
        savedAt: new Date().toISOString(),
        messages,
    };
    const st = rootSettings as any;
    st.savedChats = [...(Array.isArray(st.savedChats) ? st.savedChats : []), chat];
    return chat;
}

export function updateSavedChat(id: string, patch: Partial<SavedChat>): void {
    const st = rootSettings as any;
    st.savedChats = (st.savedChats ?? []).map((chat: SavedChat) => (chat.id === id ? { ...chat, ...patch } : chat));
}

export function deleteSavedChat(id: string): void {
    const st = rootSettings as any;
    st.savedChats = (st.savedChats ?? []).filter((chat: SavedChat) => chat.id !== id);
}

// ── Putting messages into a chat ──────────────────────────────────────────────

function toPayload(message: PortableMessage, channelId: string, guildId: string | null): Raw {
    const id = snowflakeAt(Date.parse(message.timestamp));
    return {
        id,
        nonce: id,
        type: 0,
        channel_id: channelId,
        guild_id: guildId,
        content: message.content,
        embeds: clone(message.embeds ?? []),
        attachments: clone(message.attachments ?? []),
        sticker_items: clone(message.sticker_items ?? []),
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        tts: false,
        flags: 0,
        reactions: [],
        author: { ...message.author },
        timestamp: message.timestamp,
        edited_timestamp: message.edited_timestamp ?? null,
        state: "SENT",
    };
}

/**
 * Adds messages to a chat locally, with their own timestamps.
 *
 * `announce` delivers them like incoming messages even when the chat is not
 * open (unread badge, banner). Without it a closed chat is left quiet and the
 * messages are simply there the next time it is opened.
 */
export function injectMessages(channelId: string, messages: PortableMessage[], announce = false): number {
    if (!channelId) throw new Error("Pick a chat first.");
    const guildId = (ChannelStore as any).getChannel?.(channelId)?.guild_id ?? null;
    const payloads = messages.map(message => toPayload(message, channelId, guildId));

    const st = rootSettings as any;
    st.cached = [...cached(), ...payloads];

    const open = channelId === currentChannelId();
    if (open || announce) {
        // Copies: the cache must keep the author as written, whatever a swap does to it.
        for (const payload of payloads) dispatchLocalMessage(clone(payload));
    }
    if (open) resortChannel(channelId);
    return payloads.length;
}

/** Takes every local message back out of the chats and forgets them. */
export function removeLocalMessages(): number {
    const all = cached();
    for (const msg of all) {
        try {
            (FluxDispatcher as any).dispatch({
                type: "MESSAGE_DELETE",
                channelId: String(msg.channel_id),
                id: String(msg.id),
                otherPluginBypass: true,
            });
        } catch (_) { /* that chat is not loaded; nothing to take out */ }
    }
    (rootSettings as any).cached = [];
    return all.length;
}

// ── Keeping local messages in place ───────────────────────────────────────────

function autoReplay(): boolean {
    return (rootSettings as any).autoReplayOnLoad !== false;
}

// Discord replaces a chat's messages with the server's whenever it loads, which
// would drop the local ones. Slot them into the page being loaded instead, each
// where its timestamp belongs, so they come back as part of the chat.
function mergeIntoLoad(e: any): void {
    if (e[REFRESH_FLAG] || !autoReplay()) return;
    const page: Raw[] = e.messages;
    const channelId = String(e.channelId ?? "");
    if (!channelId || !Array.isArray(page)) return;

    const inPage = new Set(page.map(msg => String(msg?.id)));
    let local = cachedFor(channelId).filter(msg => !inPage.has(String(msg.id)));
    if (local.length === 0) return;

    const paging = !!e.isBefore || !!e.isAfter;
    if (page.length === 0) {
        if (paging) return;
    } else {
        const ids = page.map(msg => idValue(msg?.id));
        let oldest = ids[0], newest = ids[0];
        for (const id of ids) {
            if (id < oldest) oldest = id;
            if (id > newest) newest = id;
        }
        // Past either end of the page only when the chat itself ends there.
        const openBelow = !e.isAfter && e.hasMoreBefore === false;
        const openAbove = !e.isBefore && !e.hasMoreAfter;
        local = local.filter(msg => {
            const id = idValue(msg.id);
            return (openBelow || id > oldest) && (openAbove || id < newest);
        });
        // A page of older or newer history must not repeat what is already shown.
        if (paging) {
            const store = getMessageStore();
            local = local.filter(msg => !store?.getMessage?.(channelId, msg.id));
        }
        if (local.length === 0) return;
    }

    // Keep whichever order the page came in.
    const first = idValue(page[0]?.id), last = idValue(page[page.length - 1]?.id);
    const direction = page.length > 1 && first < last ? 1 : -1;
    e.messages = [...page, ...local.map(clone)].sort((a, b) => {
        const x = idValue(a?.id), y = idValue(b?.id);
        return x === y ? 0 : (x < y ? -direction : direction);
    });
}

/**
 * For a chat that was already loaded and so will not load again: add whatever
 * local messages it is missing. Only ever acts on the open chat.
 */
export function replayMissing(channelId: string | undefined): number {
    if (!channelId || !autoReplay() || channelId !== currentChannelId()) return 0;
    if (storedMessages(channelId).length === 0) return 0; // not loaded yet; the load merges them

    const store = getMessageStore();
    const missing = cachedFor(channelId).filter(msg => !store?.getMessage?.(channelId, msg.id));
    for (const msg of missing) dispatchLocalMessage(clone(msg));
    if (missing.length > 0) resortChannel(channelId);
    return missing.length;
}

export function patchLocalReplay(): () => void {
    const dispatcher = FluxDispatcher as any;

    const interceptor = (e: any) => {
        try {
            if (e?.type === "LOAD_MESSAGES_SUCCESS") mergeIntoLoad(e);
        } catch (_) { /* load the chat as Discord sent it */ }
    };
    dispatcher.addInterceptor(interceptor);

    const onSelect = (e: any) => {
        const channelId = e?.channelId;
        if (!channelId) return;
        setTimeout(() => {
            try { replayMissing(String(channelId)); } catch (_) {}
        }, 500);
    };
    dispatcher.subscribe("CHANNEL_SELECT", onSelect);

    return () => {
        const list: unknown[] | undefined = dispatcher._interceptors;
        const index = Array.isArray(list) ? list.indexOf(interceptor) : -1;
        if (index >= 0) list!.splice(index, 1);
        dispatcher.unsubscribe("CHANNEL_SELECT", onSelect);
    };
}
