import React from "react";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { clipboard, NavigationNative } from "@metro/common";
import { Stack, TableRowGroup } from "@metro/common/components";
import { ScrollView } from "react-native";

import { pickChat } from "./ChatPicker";
import { channelName, currentChannelId, injectMessages, resolveAuthor, toDataCode } from "./chats";
import type { PortableMessage } from "./types";

const { Card } = findByProps("Card");
const { TableRow } = findByProps("TableRow");

const WHEN = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-11-09 23:29" in this phone's time zone; blank means now. */
function parseWhen(text: string): Date {
    const value = text.trim();
    if (!value) return new Date();
    const match = WHEN.exec(value);
    if (!match) throw new Error("Write the time as 2026-11-09 23:29, or leave it blank for now.");
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
    if (Number.isNaN(date.getTime())) throw new Error("That date doesn't exist.");
    return date;
}

export default function SendMessagePage() {
    const navigation = NavigationNative.useNavigation();
    const [channelId, setChannelId] = React.useState(() => currentChannelId() ?? "");
    const [userId, setUserId] = React.useState("");
    const [content, setContent] = React.useState("");
    const [whenText, setWhenText] = React.useState("");
    const [busy, setBusy] = React.useState(false);

    const build = async (): Promise<PortableMessage> => {
        if (!content.trim()) throw new Error("Type a message.");
        const timestamp = parseWhen(whenText).toISOString();
        return {
            content,
            timestamp,
            edited_timestamp: null,
            author: await resolveAuthor(userId),
            attachments: [],
            embeds: [],
        };
    };

    const run = async (action: (message: PortableMessage) => void) => {
        if (busy) return;
        setBusy(true);
        try {
            action(await build());
        } catch (e) {
            showToast((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const send = () => run(message => {
        if (!channelId) throw new Error("Pick a chat first.");
        injectMessages(channelId, [message], true);
        showToast(`Local message added to ${channelName(channelId)}.`);
    });

    const copy = () => run(message => {
        clipboard.setString(toDataCode("Local message", [message]));
        showToast("Message data code copied.");
    });

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Where">
                    <TableRow
                        label={channelId ? channelName(channelId) : "Pick a chat"}
                        subLabel="Tap to choose any chat"
                        onPress={() => pickChat(navigation, "Send into…", id => setChannelId(id))}
                        arrow
                    />
                </TableRowGroup>

                <TableRowGroup title="Message">
                    <Card>
                        <SettingsTextInput
                            placeholder="User ID (blank = your account)"
                            value={userId}
                            onChange={setUserId}
                            isClearable
                        />
                    </Card>
                    <Card>
                        <SettingsTextInput
                            placeholder="Message"
                            value={content}
                            onChange={setContent}
                            autoCapitalize="sentences"
                            autoCorrect
                            isClearable
                        />
                    </Card>
                    <Card>
                        <SettingsTextInput
                            placeholder="Time, e.g. 2026-11-09 23:29 (blank = now)"
                            value={whenText}
                            onChange={setWhenText}
                            isClearable
                        />
                    </Card>
                </TableRowGroup>

                <TableRowGroup title="Actions">
                    <TableRow
                        label={busy ? "Working…" : "Send local message"}
                        subLabel="Only you see it. Arrives like a real message, even in a chat you don't have open"
                        onPress={send}
                        arrow
                    />
                    <TableRow
                        label="Copy message data code"
                        subLabel="This message as JSON, without sending it"
                        onPress={copy}
                        arrow
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
