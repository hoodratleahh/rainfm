import { waitForHydration } from "@api/storage";
import { definePlugin } from "@plugins";

import { dispatchLocalMessage } from "./dispatch";
import patchQuickMessage from "./quickMessage";
import settings from "./settings";
import { rootSettings, useRootStore } from "./storage";
import { forgetMasks, loadMasks, patchUserStoreMask } from "./userMask";

const unpatches: (() => void)[] = [];
let running = false;

export default definePlugin({
    name: "LocalMessagePreview",
    description: "Locally swap profiles in chat. Never sent to Discord.",
    author: [{ name: "you", id: 0n }],
    id: "localmessagepreview",
    version: "3.3.0",
    settings,
    start() {
        running = true;
        unpatches.push(patchQuickMessage());
        unpatches.push(patchUserStoreMask());

        // Storage is read from disk asynchronously; anything saved is still
        // empty at this point, so wait for it before restoring state.
        waitForHydration(useRootStore).then(() => {
            if (!running) return;
            loadMasks();

            const st = rootSettings as any;
            if (st.autoReplayOnLoad && Array.isArray(st.cached) && st.cached.length > 0) {
                setTimeout(() => {
                    if (!running) return;
                    for (const msg of st.cached as Record<string, unknown>[]) {
                        try { dispatchLocalMessage(msg); } catch (_) {}
                    }
                }, 1500);
            }
        });
    },
    stop() {
        running = false;
        for (const fn of unpatches) fn();
        unpatches.length = 0;
        forgetMasks();
    },
});
