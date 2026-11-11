import React from "react";
import { showConfirmationAlert } from "@api/ui/alerts";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { clipboard, NavigationNative } from "@metro/common";
import { Stack, TableRowGroup } from "@metro/common/components";
import { ScrollView } from "react-native";

import { pickChat } from "./ChatPicker";
import {
    addSavedChat, currentChannelId, deleteSavedChat, injectMessages, parseDataCode,
    readChat, retimeMessages, toDataCode, updateSavedChat,
} from "./chats";
import { useRootStore } from "./storage";
import type { PortableMessage, SavedChat } from "./types";

const { Card } = findByProps("Card");
const { TableRow } = findByProps("TableRow");

const PREVIEW_ROWS = 5;

function when(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function span(messages: PortableMessage[]): string {
    if (messages.length === 0) return "Empty";
    const first = when(messages[0].timestamp);
    const last = when(messages[messages.length - 1].timestamp);
    return first === last ? first : `${first} → ${last}`;
}

function fmtLocal(iso?: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseLocal(text: string): number {
    return Date.parse(text.trim().replace(" ", "T"));
}

function describe(message: PortableMessage): string {
    if (message.content) return message.content;
    if (message.attachments.length > 0) return "[attachment]";
    if (message.embeds.length > 0) return "[embed]";
    return "[no text]";
}

// ── One saved chat ────────────────────────────────────────────────────────────

function SavedChatPage({ chatId }: { chatId: string }) {
    const store = useRootStore();
    const navigation = NavigationNative.useNavigation();
    const chat: SavedChat | undefined = ((store as any).savedChats ?? []).find((c: SavedChat) => c.id === chatId);
    const [startText, setStartText] = React.useState(() => fmtLocal(chat?.messages[0]?.timestamp));
    if (!chat) return null;

    const applyStart = () => {
        if (chat.messages.length === 0) { showToast("Nothing to retime."); return; }
        const ms = parseLocal(startText);
        if (!Number.isFinite(ms)) { showToast("Use YYYY-MM-DD HH:MM, like 2026-11-07 21:30."); return; }
        updateSavedChat(chat.id, { messages: retimeMessages(chat.messages, ms) });
        showToast("Chat retimed — everything shifted, gaps kept.");
    };

    const endNow = () => {
        if (chat.messages.length === 0) { showToast("Nothing to retime."); return; }
        const first = Date.parse(chat.messages[0].timestamp);
        const last = Date.parse(chat.messages[chat.messages.length - 1].timestamp);
        const ms = Date.now() - (last - first);
        updateSavedChat(chat.id, { messages: retimeMessages(chat.messages, ms) });
        setStartText(fmtLocal(new Date(ms).toISOString()));
        showToast("Chat retimed — the last message just happened.");
    };

    const send = () => pickChat(navigation, "Send into…", (channelId, name) => {
        try {
            const count = injectMessages(channelId, chat.messages);
            showToast(channelId === currentChannelId()
                ? `Added ${count} local message(s) to ${name}.`
                : `${count} local message(s) will be in ${name} when you open it.`);
        } catch (e) {
            showToast((e as Error).message);
        }
    });

    const copy = () => {
        const code = toDataCode(chat.name, chat.messages);
        clipboard.setString(code);
        showToast(`Data code copied (${chat.messages.length} message(s)).`);
    };

    const remove = () => showConfirmationAlert({
        title: "Delete saved chat?",
        content: "Messages already sent into chats stay where they are.",
        confirmText: "Delete",
        confirmColor: "red",
        cancelText: "Cancel",
        onConfirm: () => {
            deleteSavedChat(chat.id);
            navigation.goBack();
        },
    });

    const preview = chat.messages.slice(-PREVIEW_ROWS);

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Saved chat">
                    <Card>
                        <SettingsTextInput
                            placeholder="Name"
                            value={chat.name}
                            onChange={(v: string) => updateSavedChat(chat.id, { name: v })}
                            isClearable
                        />
                    </Card>
                    <TableRow label={`${chat.messages.length} message(s)`} subLabel={span(chat.messages)} />
                </TableRowGroup>

                <TableRowGroup title="Use it">
                    <TableRow
                        label="Send into a chat"
                        subLabel="Local only. Messages keep their saved times and authors"
                        onPress={send}
                        arrow
                    />
                    <TableRow
                        label="Copy data code"
                        subLabel="The whole chat as JSON, in Discord's message format"
                        onPress={copy}
                        arrow
                    />
                </TableRowGroup>

                <TableRowGroup title="Timestamps">
                    <Card>
                        <SettingsTextInput
                            placeholder="New start — YYYY-MM-DD HH:MM"
                            value={startText}
                            onChange={setStartText}
                            isClearable
                        />
                    </Card>
                    <TableRow
                        label="Apply new start time"
                        subLabel="The whole chat shifts to begin then; the gaps between messages stay the same"
                        onPress={applyStart}
                        arrow
                    />
                    <TableRow
                        label="End just now"
                        subLabel="Shifts the chat so the last message was a moment ago"
                        onPress={endNow}
                        arrow
                    />
                </TableRowGroup>

                <TableRowGroup title={`Last ${preview.length} message(s)`}>
                    {preview.map((message, i) => (
                        <TableRow
                            key={i}
                            label={message.author.global_name || message.author.username}
                            subLabel={`${describe(message)}\n${when(message.timestamp)}`}
                        />
                    ))}
                </TableRowGroup>

                <TableRowGroup title="Remove">
                    <TableRow label="Delete saved chat" variant="danger" onPress={remove} />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}

// ── The list ──────────────────────────────────────────────────────────────────

export default function SavedChatsPage() {
    const store = useRootStore();
    const navigation = NavigationNative.useNavigation();
    const chats: SavedChat[] = (store as any).savedChats ?? [];
    const [busy, setBusy] = React.useState(false);

    const open = (chat: SavedChat) => navigation.push("RAIN_CUSTOM_PAGE", {
        title: chat.name || "Saved chat",
        render: () => React.createElement(SavedChatPage, { chatId: chat.id }),
    });

    const save = () => pickChat(navigation, "Save which chat?", async (channelId, name) => {
        if (busy) return;
        setBusy(true);
        try {
            const messages = await readChat(channelId);
            if (messages.length === 0) { showToast("That chat has no messages to save."); return; }
            addSavedChat(name, messages);
            showToast(`Saved ${messages.length} message(s) from ${name}.`);
        } catch (e) {
            showToast(`Couldn't read that chat: ${(e as Error).message}`);
        } finally {
            setBusy(false);
        }
    });

    const importCode = async () => {
        try {
            const text = String((await clipboard.getString()) ?? "");
            if (!text.trim()) { showToast("The clipboard is empty."); return; }
            const { name, messages } = parseDataCode(text);
            addSavedChat(name, messages);
            showToast(`Imported "${name}" (${messages.length} message(s)).`);
        } catch (e) {
            showToast((e as Error).message);
        }
    };

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Add">
                    <TableRow
                        label={busy ? "Saving…" : "Save a chat"}
                        subLabel="Pick any chat. Saves its recent messages with authors and times"
                        onPress={save}
                        arrow
                    />
                    <TableRow
                        label="Import data code from clipboard"
                        subLabel="Copy a data code first, then tap this"
                        onPress={importCode}
                        arrow
                    />
                </TableRowGroup>

                <TableRowGroup title={`Saved chats (${chats.length})`}>
                    {chats.length === 0 && <TableRow label="Nothing saved yet" />}
                    {chats.map(chat => (
                        <TableRow
                            key={chat.id}
                            label={chat.name || "Unnamed"}
                            subLabel={`${chat.messages.length} message(s) · ${span(chat.messages)}`}
                            onPress={() => open(chat)}
                            arrow
                        />
                    ))}
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
