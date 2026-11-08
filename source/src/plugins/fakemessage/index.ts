import { registerCommand } from "@api/commands";
import { ApplicationCommandOptionType, RainApplicationCommand } from "@api/commands/types";
import { waitForHydration } from "@api/storage";
import { showToast } from "@api/ui/toasts";
import { FluxDispatcher } from "@metro/common";
import { SelectedChannelStore, UserStore } from "@metro/common/stores";
import { definePlugin } from "@plugins";

import { addFake, clearChannel, getArg, loadFakes, onChannelLoaded, parseDuration, restoreChannel, unloadFakes } from "./core";
import Settings from "./settings";
import { useFakeMessageSettings } from "./storage";
import longPressPatch from "./ui/longpress";

const unregisters: (() => void)[] = [];
let patches: (() => unknown)[] = [];

// --- commands ----------------------------------------------------------------

const fakeMessageCommand = (): RainApplicationCommand => ({
    name: "fakemessage",
    displayName: "fakemessage",
    description: "Add a fake message from another user. Only you can see it.",
    displayDescription: "Add a fake message from another user. Only you can see it.",
    applicationId: "-1",
    inputType: 1,
    type: 1,
    shouldHide: () => false,
    options: [
        {
            name: "user",
            displayName: "user",
            description: "Who the message should appear to be from",
            displayDescription: "Who the message should appear to be from",
            type: ApplicationCommandOptionType.USER,
            required: true,
        },
        {
            name: "content",
            displayName: "content",
            description: "The message text (markdown and mentions work)",
            displayDescription: "The message text (markdown and mentions work)",
            type: ApplicationCommandOptionType.STRING,
            required: true,
        },
        {
            name: "minutes-ago",
            displayName: "minutes-ago",
            description: "How many minutes ago it was sent (0 = now)",
            displayDescription: "How many minutes ago it was sent (0 = now)",
            type: ApplicationCommandOptionType.INTEGER,
        },
    ],
    execute: (args, ctx) => {
        try {
            const userId = getArg(args, "user");
            const content = (getArg(args, "content") ?? "").trim();
            const minutesAgo = Number(getArg(args, "minutes-ago") ?? 0) || 0;

            if (!content) return void showToast("Write some content first");
            const user = userId ? UserStore.getUser?.(userId) : undefined;
            if (!user) return void showToast("Couldn't find that user. Pick someone from this chat or server.");

            if (addFake(ctx.channel.id, user, content, minutesAgo)) {
                showToast(`Fake message added as ${user.globalName ?? user.username}`);
            }
        } catch (e) {
            console.error("[FakeMessage] /fakemessage failed:", e);
            showToast("Failed to add fake message");
        }
    },
});

const fakeCallCommand = (): RainApplicationCommand => ({
    name: "fakecall",
    displayName: "fakecall",
    description: "Add a fake call log entry. Only you can see it.",
    displayDescription: "Add a fake call log entry. Only you can see it.",
    applicationId: "-1",
    inputType: 1,
    type: 1,
    shouldHide: () => false,
    options: [
        {
            name: "user",
            displayName: "user",
            description: "The other person in the call",
            displayDescription: "The other person in the call",
            type: ApplicationCommandOptionType.USER,
            required: true,
        },
        {
            name: "duration",
            displayName: "duration",
            description: "Length as mm:ss or minutes (default 5:00)",
            displayDescription: "Length as mm:ss or minutes (default 5:00)",
            type: ApplicationCommandOptionType.STRING,
        },
        {
            name: "missed",
            displayName: "missed",
            description: "Show it as a missed call",
            displayDescription: "Show it as a missed call",
            type: ApplicationCommandOptionType.BOOLEAN,
        },
        {
            name: "minutes-ago",
            displayName: "minutes-ago",
            description: "How many minutes ago the call started (0 = now)",
            displayDescription: "How many minutes ago the call started (0 = now)",
            type: ApplicationCommandOptionType.INTEGER,
        },
    ],
    execute: (args, ctx) => {
        try {
            const userId = getArg(args, "user");
            const user = userId ? UserStore.getUser?.(userId) : undefined;
            if (!user) return void showToast("Couldn't find that user. Pick someone from this chat or server.");

            const missed = String(getArg(args, "missed")) === "true";
            const durationSeconds = missed ? 0 : parseDuration(getArg(args, "duration"));
            const minutesAgo = Number(getArg(args, "minutes-ago") ?? 0) || 0;

            if (addFake(ctx.channel.id, user, "", minutesAgo, { durationSeconds, missed })) {
                showToast(missed ? "Fake missed call added" : "Fake call added");
            }
        } catch (e) {
            console.error("[FakeMessage] /fakecall failed:", e);
            showToast("Failed to add fake call");
        }
    },
});

const fakeClearCommand = (): RainApplicationCommand => ({
    name: "fakeclear",
    displayName: "fakeclear",
    description: "Remove every fake message and call from this channel.",
    displayDescription: "Remove every fake message and call from this channel.",
    applicationId: "-1",
    inputType: 1,
    type: 1,
    shouldHide: () => false,
    execute: (_args, ctx) => {
        const removed = clearChannel(ctx.channel.id);
        showToast(removed ? `Removed ${removed} fake${removed === 1 ? "" : "s"}` : "No fakes in this channel");
    },
});

// --- plugin ------------------------------------------------------------------

export default definePlugin({
    name: "FakeMessage",
    description: "Adds fake messages and call logs from other users to your chat. Client-side only, nobody else sees them.",
    // Idea by Elioflex; id 0 is a placeholder (no profile to open)
    author: [{ name: "Elioflex", id: BigInt(0) }],
    id: "fakemessage",
    version: "1.1.0",
    settings: Settings,
    async start() {
        await waitForHydration(useFakeMessageSettings);
        loadFakes();

        unregisters.push(registerCommand(fakeMessageCommand()));
        unregisters.push(registerCommand(fakeCallCommand()));
        unregisters.push(registerCommand(fakeClearCommand()));

        // "Fake Message As ..." / "Remove Fake Message" in the message long-press menu
        try {
            patches = longPressPatch();
        } catch (e) {
            console.error("[FakeMessage] Long-press menu patch failed:", e);
        }

        FluxDispatcher.subscribe("LOAD_MESSAGES_SUCCESS", onChannelLoaded);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelLoaded);

        const current = SelectedChannelStore.getChannelId?.();
        if (current) setTimeout(() => restoreChannel(current), 300);
    },
    stop() {
        for (const unregister of unregisters) unregister();
        unregisters.length = 0;

        for (const unpatch of patches) unpatch();
        patches = [];

        FluxDispatcher.unsubscribe("LOAD_MESSAGES_SUCCESS", onChannelLoaded);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelLoaded);

        unloadFakes();
    },
});
