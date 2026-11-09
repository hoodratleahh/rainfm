import { createPluginStore } from "@api/storage";
import type { RootStorage } from "./types";

export const {
    useStore: useRootStore,
    settings: rootSettings,
} = createPluginStore<RootStorage>("localmessagepreview", {
    rules: [],
    cached: [],
    autoReplayOnLoad: true,
    masks: {},
});
