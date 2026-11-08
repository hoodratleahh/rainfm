import { FluxDispatcher } from "@metro/common";

export function dispatchLocalMessage(message: Record<string, unknown>): void {
    const channelId = String(message.channel_id ?? "");
    if (!channelId) return;
    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId,
        guildId: message.guild_id ?? null,
        message,
        optimistic: false,
        isPushNotification: false,
    } as never);
}
