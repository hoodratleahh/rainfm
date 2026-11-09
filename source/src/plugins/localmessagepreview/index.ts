import { definePlugin } from "@plugins";

import { dispatchLocalMessage } from "./dispatch";
import patchQuickMessage from "./quickMessage";
import settings from "./settings";
import { rootSettings } from "./storage";
import { clearAllMasks, patchUserStoreMask } from "./userMask";

const unpatches: (() => void)[] = [];

export default definePlugin({
    name: "LocalMessagePreview",
    description: "Locally swap profiles in chat. Never sent to Discord.",
    author: [{ name: "you", id: 0n }],
    id: "localmessagepreview",
    version: "3.0.0",
    settings,
    start() {
        unpatches.push(patchQuickMessage());
        unpatches.push(patchUserStoreMask());

        // Auto-replay cached messages on load (slight delay to let stores initialise)
        const st = rootSettings as any;
        if (st.autoReplayOnLoad && Array.isArray(st.cached) && st.cached.length > 0) {
            setTimeout(() => {
                for (const msg of st.cached as Record<string, unknown>[]) {
                    try { dispatchLocalMessage(msg); } catch (_) {}
                }
            }, 1500);
        }
    },
    stop() {
        for (const fn of unpatches) fn();
        unpatches.length = 0;
        clearAllMasks();
    },
});
