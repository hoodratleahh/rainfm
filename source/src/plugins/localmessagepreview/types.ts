export interface Preset {
    name: string;
    channelId: string;
    targetUserId: string;
    messages: string[];
    showEmbedPreview: boolean;
    embedImageUrl: string;
}

export interface RootStorage {
    rules: Preset[];
    cached: Record<string, unknown>[];
    autoReplayOnLoad: boolean;
    /** sourceUserId → targetUserId, kept so swaps survive a restart. */
    masks: Record<string, string>;
}
