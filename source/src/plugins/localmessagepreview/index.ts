import { definePlugin } from "@plugins";

import patchQuickMessage from "./quickMessage";
import settings from "./settings";
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
    },
    stop() {
        for (const fn of unpatches) fn();
        unpatches.length = 0;
        clearAllMasks();
    },
});
