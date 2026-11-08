import { createPluginStore } from "@api/storage";

/** Snapshot of the user a fake message is attributed to (raw API shape). */
export interface FakeAuthor {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    global_name: string | null;
    bot: boolean;
    public_flags: number;
}

export interface StoredFake {
    id: string;
    channelId: string;
    author: FakeAuthor;
    content: string;
    /** Start time in ms since epoch (for calls: when the call started) */
    timestamp: number;
    /** When present the fake is a call log entry (system message) instead of text */
    call?: { durationSeconds: number; missed: boolean };
}

interface FakeMessageSettings {
    persist: boolean;
    fakes: StoredFake[];
}

export const {
    useStore: useFakeMessageSettings,
    settings: fakeMessageSettings,
} = createPluginStore<FakeMessageSettings>("fakemessage", {
    persist: true,
    fakes: [],
});
