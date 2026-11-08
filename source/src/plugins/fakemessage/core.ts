import { Argument } from "@api/commands/types";
import { showToast } from "@api/ui/toasts";
import { FluxDispatcher } from "@metro/common";
import { MessageStore, UserStore } from "@metro/common/stores";

import { FakeAuthor, fakeMessageSettings, StoredFake } from "./storage";

/*
 * FakeMessage core - puts a message (or a call log entry) into a channel as if
 * another user had sent it. Everything is client-side: the message is pushed
 * into Discord's local message store with a MESSAGE_CREATE event and is never
 * sent to Discord's servers, so only you can see it.
 *
 * Idea from elioflex/fakeMessage (Vencord). This is a separate implementation
 * for Rain's mobile plugin API, not a port of that code.
 */

const MAX_FAKES_PER_CHANNEL = 50;
const DISCORD_EPOCH = 1420070400000;

let fakes: StoredFake[] = [];

// --- helpers -----------------------------------------------------------------

/** Build a snowflake id for a timestamp so the message sorts at the right place. */
function snowflakeFor(timestampMs: number): string {
    const offset = BigInt(Math.max(Math.floor(timestampMs - DISCORD_EPOCH), 0));
    const random = BigInt(Math.floor(Math.random() * 4096));
    return ((offset << BigInt(22)) | random).toString();
}

function toAuthor(user: any): FakeAuthor {
    return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator ?? "0",
        avatar: user.avatar ?? null,
        global_name: user.globalName ?? user.global_name ?? null,
        bot: !!user.bot,
        public_flags: user.publicFlags ?? user.public_flags ?? 0,
    };
}

export function getArg(args: Argument[], name: string): string | undefined {
    const found = args.find(a => a.name === name);
    return found?.value as string | undefined;
}

/** "mm:ss" or plain minutes -> seconds, capped at one hour. */
export function parseDuration(input: string | undefined): number {
    const text = (input ?? "").trim() || "5:00";
    if (text.includes(":")) {
        const [m, s] = text.split(":").map(n => parseInt(n, 10) || 0);
        return Math.min(Math.max(m, 0) * 60 + Math.max(s, 0), 3600);
    }
    return Math.min(Math.max(parseInt(text, 10) || 0, 0) * 60, 3600);
}

/** Pull `<@id>` mentions out of the content and resolve them to raw user objects. */
function resolveMentions(content: string): any[] {
    const mentions: any[] = [];
    const seen = new Set<string>();
    const re = /<@!?(\d{15,21})>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const user = UserStore.getUser?.(id);
        if (user) mentions.push(toAuthor(user));
    }
    return mentions;
}

function buildRawMessage(fake: StoredFake): Record<string, any> {
    const started = new Date(fake.timestamp).toISOString();
    const base: Record<string, any> = {
        id: fake.id,
        channel_id: fake.channelId,
        author: fake.author,
        content: fake.content,
        timestamp: started,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: resolveMentions(fake.content),
        mention_roles: [],
        attachments: [],
        embeds: [],
        reactions: [],
        components: [],
        pinned: false,
        type: 0,
        flags: 0,
        state: "SENT",
    };

    if (fake.call) {
        const me = UserStore.getCurrentUser?.()?.id;
        const ended = new Date(fake.timestamp + fake.call.durationSeconds * 1000).toISOString();
        base.type = 3; // CALL
        base.content = "";
        base.call = {
            // Discord decides "missed" by the current user not being a participant
            participants: fake.call.missed ? [fake.author.id] : [fake.author.id, me].filter(Boolean),
            ended_timestamp: ended,
        };
    }

    return base;
}

function dispatchFake(fake: StoredFake) {
    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId: fake.channelId,
        message: buildRawMessage(fake),
        optimistic: false,
        isPushNotification: false,
    });
}

function removeFromView(fake: StoredFake) {
    FluxDispatcher.dispatch({
        type: "MESSAGE_DELETE",
        id: fake.id,
        channelId: fake.channelId,
        // MessageLogger honours this flag, so the fake really disappears
        otherPluginBypass: true,
    });
}

function save() {
    fakeMessageSettings.fakes = fakeMessageSettings.persist ? fakes : [];
}

// --- lifecycle ---------------------------------------------------------------

/** Load stored fakes into memory (call once the store has hydrated). */
export function loadFakes() {
    fakes = fakeMessageSettings.persist ? [...(fakeMessageSettings.fakes ?? [])] : [];
}

/** Take every fake off screen but keep them stored for next time. */
export function unloadFakes() {
    for (const fake of fakes) removeFromView(fake);
    fakes = [];
}

/** Re-add any stored fakes for a channel that Discord's store no longer has. */
export function restoreChannel(channelId: string) {
    for (const fake of fakes) {
        if (fake.channelId !== channelId) continue;
        try {
            if (MessageStore.getMessage?.(channelId, fake.id)) continue;
            dispatchFake(fake);
        } catch (e) {
            console.error("[FakeMessage] Failed to restore message:", e);
        }
    }
}

export function onChannelLoaded(event: any) {
    const channelId = event?.channelId;
    if (!channelId || !fakes.some(f => f.channelId === channelId)) return;
    // Let Discord finish merging the fetched history first
    setTimeout(() => restoreChannel(channelId), 150);
}

// --- public API --------------------------------------------------------------

export function getFakeCount(): number {
    return fakes.length;
}

export function isFake(messageId: string | undefined): boolean {
    return !!messageId && fakes.some(f => f.id === messageId);
}

export function removeFake(messageId: string): boolean {
    const fake = fakes.find(f => f.id === messageId);
    if (!fake) return false;
    removeFromView(fake);
    fakes = fakes.filter(f => f.id !== messageId);
    save();
    return true;
}

export function clearAllFakes() {
    for (const fake of fakes) removeFromView(fake);
    fakes = [];
    save();
}

export function clearChannel(channelId: string): number {
    const mine = fakes.filter(f => f.channelId === channelId);
    for (const fake of mine) removeFromView(fake);
    fakes = fakes.filter(f => f.channelId !== channelId);
    save();
    return mine.length;
}

export function addFake(channelId: string, user: any, content: string, minutesAgo: number, call?: StoredFake["call"]): boolean {
    if (fakes.filter(f => f.channelId === channelId).length >= MAX_FAKES_PER_CHANNEL) {
        showToast(`Too many fakes in this channel (max ${MAX_FAKES_PER_CHANNEL}). Use /fakeclear.`);
        return false;
    }

    const timestamp = Date.now() - Math.max(0, minutesAgo) * 60_000;
    const fake: StoredFake = {
        id: snowflakeFor(timestamp),
        channelId,
        author: toAuthor(user),
        content,
        timestamp,
        call,
    };

    fakes.push(fake);
    save();
    dispatchFake(fake);
    return true;
}
