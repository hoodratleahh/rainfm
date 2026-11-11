export interface Preset {
    name: string;
    channelId: string;
    targetUserId: string;
    messages: string[];
    showEmbedPreview: boolean;
    embedImageUrl: string;
}

export interface PortableAuthor {
    id: string;
    username: string;
    discriminator: string;
    global_name: string | null;
    avatar: string | null;
    bot: boolean;
}

/**
 * One message in Discord's own API shape, minus anything tied to a channel.
 * This is what a saved chat holds and what a data code carries.
 */
export interface PortableMessage {
    /** ID the message had where it was saved; a fresh one is made on import. */
    id?: string;
    content: string;
    timestamp: string;
    edited_timestamp: string | null;
    author: PortableAuthor;
    attachments: unknown[];
    embeds: unknown[];
    sticker_items?: unknown[];
}

export interface SavedChat {
    id: string;
    name: string;
    savedAt: string;
    messages: PortableMessage[];
}

export interface RootStorage {
    rules: Preset[];
    cached: Record<string, unknown>[];
    autoReplayOnLoad: boolean;
    /** sourceUserId → targetUserId, kept so swaps survive a restart. */
    masks: Record<string, string>;
    savedChats: SavedChat[];
}
