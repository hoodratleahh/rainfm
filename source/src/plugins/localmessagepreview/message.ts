import { ChannelStore, SelectedChannelStore, UserStore } from "@metro/common/stores";
import { ensurePreset } from "./storageModel";
import type { Preset } from "./types";

const DISCORD_EPOCH_MS = 1420070400000n;

function genSnowflake(): string {
    const ts = BigInt(Date.now()) - DISCORD_EPOCH_MS;
    return String((ts << 22n) | BigInt(Math.floor(Math.random() * 0xfff)));
}

export function buildPayload(preset: Preset, variantIndex = 0, preloadedUser?: any): Record<string, unknown> {
    ensurePreset(preset);
    const channelId = preset.channelId.trim() || (SelectedChannelStore.getChannelId() as string);
    if (!channelId) throw new Error("Open a channel or set a Channel ID.");

    const me = (UserStore as any).getCurrentUser?.();
    if (!me) throw new Error("Not logged in.");

    const targetId = preset.targetUserId?.trim();
    let authorUser: any;
    if (targetId) {
        const cached = (UserStore as any).getUser?.(targetId) ?? null;
        authorUser = cached
            ? { ...cached }
            : { id: targetId, username: "Unknown", discriminator: "0", avatar: null, bot: false, global_name: null };
    } else if (preloadedUser) {
        authorUser = { ...preloadedUser };
    } else {
        authorUser = { ...me };
    }

    const guildId = (ChannelStore as any).getChannel?.(channelId)?.guild_id ?? null;
    const idx = Math.max(0, Math.min(variantIndex, preset.messages.length - 1));
    const text = preset.messages[idx] ?? "";
    const id = genSnowflake();
    const image = preset.embedImageUrl.trim();

    return {
        id,
        nonce: id,
        type: 0,
        channel_id: channelId,
        guild_id: guildId,
        content: preset.showEmbedPreview ? "" : text,
        embeds: preset.showEmbedPreview
            ? [{
                type: "rich",
                description: text,
                ...(image ? { image: { url: image, proxy_url: image, width: 400, height: 300 } } : {}),
            }]
            : [],
        attachments: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        tts: false,
        flags: 0,
        reactions: [],
        author: { ...authorUser },
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        state: "SENT",
    };
}
