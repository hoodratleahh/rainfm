import { waitForHydration } from "@api/storage";
import { definePlugin } from "@plugins";

import { currentChannelId, patchLocalReplay, replayMissing } from "./chats";
import patchQuickMessage from "./quickMessage";
import settings from "./settings";
import { useRootStore } from "./storage";
import { forgetMasks, loadMasks, patchUserStoreMask } from "./userMask";

const unpatches: (() => void)[] = [];
let running = false;

export default definePlugin({
    name: "LocalMessagePreview",
    description: "Locally swap profiles in chat. Never sent to Discord.",
    author: [{ name: "you", id: 0n }],
    id: "localmessagepreview",
    version: "3.6.0",
    settings,
    start() {
        running = true;
        unpatches.push(patchQuickMessage());
        // Before the swap patch: merged local messages must pass through it too.
        unpatches.push(patchLocalReplay());
        unpatches.push(patchUserStoreMask());

        // Storage is read from disk asynchronously; anything saved is still
        // empty at this point, so wait for it before restoring state.
        waitForHydration(useRootStore).then(() => {
            if (!running) return;
            loadMasks();

            // Chats that load from now on get their local messages merged in as
            // they load; this covers the one that was already open by then.
            setTimeout(() => {
                if (!running) return;
                try { replayMissing(currentChannelId()); } catch (_) {}
            }, 1500);
        });
    },
    stop() {
        running = false;
        for (const fn of unpatches) fn();
        unpatches.length = 0;
        forgetMasks();
    },
});
