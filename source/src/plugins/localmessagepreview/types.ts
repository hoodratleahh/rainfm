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
}
