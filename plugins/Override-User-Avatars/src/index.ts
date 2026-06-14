import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { after, before, instead } from "@vendetta/patcher";

const TAG = "[custom-avatars]";
const RUNTIME_CACHE_LIMIT = 500;
const LOGGED_MESSAGES_LIMIT = 250;

type AvatarOverride = {
  userId?: string;
  imageUrl?: string;
};

type LoggedMessage = {
  id: string;
  channelId: string;
  deletedAt: number;
  message: any;
};

const ChannelMessages = findByProps("_channelMessages");
const MessageRecordUtils = findByProps(
  "updateMessageRecord",
  "createMessageRecord",
);
const MessageRecord = findByName("MessageRecord", false);
const RowManager = findByName("RowManager");
const SelectedChannelStore = findByStoreName("SelectedChannelStore");
const ChannelStore = findByStoreName("ChannelStore");

const runtimeMessageCache = new Map<string, any>();
const runtimeMessageCacheOrder: string[] = [];
const silentReplacementMap = new Map<string, string>();

let patches = [];

export { default as settings } from "./settings";

function getOverrides(): AvatarOverride[] {
  if (Array.isArray(storage.overrides)) {
    return storage.overrides;
  }

  const migratedOverrides: AvatarOverride[] = [];
  if (storage.targetUserId || storage.imageUrl) {
    migratedOverrides.push({
      userId: storage.targetUserId || "",
      imageUrl: storage.imageUrl || "",
    });
  }

  storage.overrides = migratedOverrides;
  return storage.overrides;
}

function getOverrideUrl(
  target: { id?: string } | string | undefined,
): string | null {
  const userId = typeof target === "string" ? target : target?.id;
  if (!userId) {
    return null;
  }

  for (const override of getOverrides()) {
    const overrideUserId = override?.userId?.trim();
    const overrideImageUrl = override?.imageUrl?.trim();
    if (overrideUserId === userId && overrideImageUrl) {
      return overrideImageUrl;
    }
  }

  return null;
}

function getLoggedMessages(): LoggedMessage[] {
  if (!Array.isArray(storage.loggedMessages)) {
    storage.loggedMessages = [];
  }

  return storage.loggedMessages;
}

function isMessageLoggerEnabled(): boolean {
  if (typeof storage.messageLoggerEnabled !== "boolean") {
    storage.messageLoggerEnabled = true;
  }

  return storage.messageLoggerEnabled;
}

function shouldLogCurrentChannel(): boolean {
  if (typeof storage.messageLoggerLogCurrentChannel !== "boolean") {
    storage.messageLoggerLogCurrentChannel = true;
  }

  return storage.messageLoggerLogCurrentChannel;
}

function shouldLogCurrentServer(): boolean {
  if (typeof storage.messageLoggerLogCurrentServer !== "boolean") {
    storage.messageLoggerLogCurrentServer = true;
  }

  return storage.messageLoggerLogCurrentServer;
}

function getMessageLoggerWhitelist(): string[] {
  if (typeof storage.messageLoggerWhitelist !== "string") {
    storage.messageLoggerWhitelist = "";
  }

  return storage.messageLoggerWhitelist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldRevealSilentDeletes(): boolean {
  if (typeof storage.messageLoggerRevealSilentDeletes !== "boolean") {
    storage.messageLoggerRevealSilentDeletes = true;
  }

  return storage.messageLoggerRevealSilentDeletes;
}

function getMessageCacheKey(
  channelId?: string,
  messageId?: string,
): string | null {
  if (!channelId || !messageId) {
    return null;
  }

  return `${channelId}:${messageId}`;
}

function cloneMessage(message: any): any {
  if (!message) {
    return message;
  }

  return typeof message.toJS === "function" ? message.toJS() : { ...message };
}

function sanitizeEmbedForLogger(embed: any): any {
  if (!embed) {
    return embed;
  }

  const sanitizedEmbed = {
    ...embed,
    fields: Array.isArray(embed.fields)
      ? embed.fields.map((field: any) => ({ ...field }))
      : embed.fields,
    footer: embed.footer ? { ...embed.footer } : embed.footer,
    author: embed.author ? { ...embed.author } : embed.author,
    provider: embed.provider ? { ...embed.provider } : embed.provider,
    image: embed.image ? { ...embed.image } : embed.image,
    thumbnail: embed.thumbnail ? { ...embed.thumbnail } : embed.thumbnail,
    video: embed.video ? { ...embed.video } : embed.video,
  };

  if (typeof sanitizedEmbed.colorString === "string") {
    delete sanitizedEmbed.colorString;
  }

  if (
    typeof sanitizedEmbed.color === "string" &&
    sanitizedEmbed.color.startsWith("#")
  ) {
    const parsedColor = parseInt(sanitizedEmbed.color.slice(1), 16);
    if (!Number.isNaN(parsedColor)) {
      sanitizedEmbed.color = parsedColor;
    } else {
      delete sanitizedEmbed.color;
    }
  }

  return sanitizedEmbed;
}

function sanitizeMessageForLogger(message: any): any {
  const serializedMessage = cloneMessage(message);
  if (!serializedMessage) {
    return serializedMessage;
  }

  const sanitizedMessage = {
    ...serializedMessage,
    attachments: Array.isArray(serializedMessage.attachments)
      ? serializedMessage.attachments.map((attachment: any) => ({
          ...attachment,
        }))
      : [],
    embeds: Array.isArray(serializedMessage.embeds)
      ? serializedMessage.embeds.map((embed: any) =>
          sanitizeEmbedForLogger(embed),
        )
      : [],
    mentions: Array.isArray(serializedMessage.mentions)
      ? serializedMessage.mentions.map((mention: any) => ({ ...mention }))
      : [],
    content: serializedMessage.content ?? "",
  };

  delete sanitizedMessage.state;
  delete sanitizedMessage.error;
  delete sanitizedMessage.local;
  delete sanitizedMessage.optimistic;
  delete sanitizedMessage.pending;
  delete sanitizedMessage.failed;
  delete sanitizedMessage.responseState;
  delete sanitizedMessage.__toolkit_silent_replacement;

  return sanitizedMessage;
}

function normalizeMessageForRender(message: any): any {
  if (!message) {
    return message;
  }

  const normalizedMessage = { ...message };
  const timestampFields = ["timestamp", "editedTimestamp", "deletedTimestamp"];

  for (const field of timestampFields) {
    const value = normalizedMessage[field];
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        normalizedMessage[field] = parsed;
      }
    }
  }

  return normalizedMessage;
}

function cacheRuntimeMessage(message: any): void {
  const serializedMessage = sanitizeMessageForLogger(message);
  const key = getMessageCacheKey(
    serializedMessage?.channel_id,
    serializedMessage?.id,
  );
  if (!key) {
    return;
  }

  runtimeMessageCache.set(key, serializedMessage);

  const existingIndex = runtimeMessageCacheOrder.indexOf(key);
  if (existingIndex !== -1) {
    runtimeMessageCacheOrder.splice(existingIndex, 1);
  }
  runtimeMessageCacheOrder.push(key);

  while (runtimeMessageCacheOrder.length > RUNTIME_CACHE_LIMIT) {
    const oldestKey = runtimeMessageCacheOrder.shift();
    if (oldestKey) {
      runtimeMessageCache.delete(oldestKey);
    }
  }
}

function getCachedRuntimeMessage(
  channelId?: string,
  messageId?: string,
): any | null {
  const key = getMessageCacheKey(channelId, messageId);
  if (!key) {
    return null;
  }

  return runtimeMessageCache.get(key) || null;
}

function findLoggedMessage(
  channelId?: string,
  messageId?: string,
): LoggedMessage | null {
  if (!channelId || !messageId) {
    return null;
  }

  return (
    getLoggedMessages().find(
      (entry) => entry.channelId === channelId && entry.id === messageId,
    ) || null
  );
}

function getChannelCachedMessage(
  channelId?: string,
  messageId?: string,
): any | null {
  if (!channelId || !messageId) {
    return null;
  }

  return ChannelMessages?.get?.(channelId)?.get?.(messageId) || null;
}

function getMessageForLogging(
  channelId?: string,
  messageId?: string,
): any | null {
  return (
    getChannelCachedMessage(channelId, messageId) ||
    getCachedRuntimeMessage(channelId, messageId) ||
    findLoggedMessage(channelId, messageId)?.message ||
    null
  );
}

function markMessageAsDeleted(message: any): any {
  const serializedMessage = sanitizeMessageForLogger(message);
  return normalizeMessageForRender({
    ...serializedMessage,
    deleted: true,
    __toolkit_deleted: true,
    deletedTimestamp:
      serializedMessage?.deletedTimestamp || new Date().toISOString(),
  });
}

function saveLoggedMessage(message: any): void {
  const serializedMessage = markMessageAsDeleted(message);
  const messageId = serializedMessage?.id;
  const channelId = serializedMessage?.channel_id;
  if (!messageId || !channelId) {
    return;
  }

  const entry: LoggedMessage = {
    id: messageId,
    channelId,
    deletedAt: Date.now(),
    message: serializedMessage,
  };

  storage.loggedMessages = [
    entry,
    ...getLoggedMessages().filter(
      (loggedMessage) =>
        !(
          loggedMessage.id === messageId &&
          loggedMessage.channelId === channelId
        ),
    ),
  ].slice(0, LOGGED_MESSAGES_LIMIT);

  cacheRuntimeMessage(serializedMessage);
}

function mergeMessageUpdateIntoCache(partialMessage: any): void {
  const channelId = partialMessage?.channel_id;
  const messageId = partialMessage?.id;
  if (!channelId || !messageId) {
    return;
  }

  const cachedMessage = getCachedRuntimeMessage(channelId, messageId) || {};
  cacheRuntimeMessage({
    ...cachedMessage,
    ...sanitizeMessageForLogger(partialMessage),
  });
}

function getCurrentChannelId(): string | null {
  return SelectedChannelStore?.getChannelId?.() || null;
}

function getGuildIdForChannel(channelId?: string): string | null {
  if (!channelId) {
    return null;
  }

  return ChannelStore?.getChannel?.(channelId)?.guild_id || null;
}

function shouldLogMessage(
  message?: any,
  explicitChannelId?: string,
  explicitGuildId?: string,
): boolean {
  if (!isMessageLoggerEnabled()) {
    return false;
  }

  const channelId = explicitChannelId || message?.channel_id || null;
  const guildId =
    explicitGuildId ||
    message?.guildId ||
    message?.guild_id ||
    getGuildIdForChannel(channelId);
  const currentChannelId = getCurrentChannelId();
  const currentGuildId = getGuildIdForChannel(currentChannelId);
  const whitelist = getMessageLoggerWhitelist();

  if (channelId && whitelist.includes(channelId)) {
    return true;
  }

  if (guildId && whitelist.includes(guildId)) {
    return true;
  }

  if (
    shouldLogCurrentChannel() &&
    channelId &&
    currentChannelId &&
    channelId === currentChannelId
  ) {
    return true;
  }

  if (
    shouldLogCurrentServer() &&
    guildId &&
    currentGuildId &&
    guildId === currentGuildId
  ) {
    return true;
  }

  return false;
}

function detectSilentReplacement(
  message: any,
  event?: any,
): { replacementId: string; originalId: string; originalMessage: any } | null {
  if (!shouldRevealSilentDeletes()) {
    return null;
  }

  if (
    event?.optimistic ||
    message?.optimistic ||
    message?.state === "SENDING"
  ) {
    return null;
  }

  const channelId = message?.channel_id;
  const replacementId = message?.id;
  const originalId = message?.nonce != null ? String(message.nonce) : null;
  if (
    !channelId ||
    !replacementId ||
    !originalId ||
    originalId === replacementId
  ) {
    return null;
  }

  const originalMessage = getMessageForLogging(channelId, originalId);
  if (!originalMessage || originalMessage.__toolkit_deleted) {
    return null;
  }

  if (
    message?.author?.id &&
    originalMessage?.author?.id &&
    message.author.id !== originalMessage.author.id
  ) {
    return null;
  }

  if (
    message?.webhook_id ||
    message?.message_reference ||
    message?.referenced_message
  ) {
    return null;
  }

  return {
    replacementId,
    originalId,
    originalMessage: sanitizeMessageForLogger(originalMessage),
  };
}

function getSilentReplacementOriginal(message: any): any | null {
  const silentReplacement = detectSilentReplacement(message);
  if (!silentReplacement) {
    return null;
  }

  return normalizeMessageForRender({
    ...silentReplacement.originalMessage,
    deleted: true,
    __toolkit_deleted: true,
    __toolkit_silent_deleted: true,
    __toolkit_restored_original: true,
  });
}

function applyOriginalToRenderedRow(row: any, originalMessage: any): void {
  if (!row?.message || !originalMessage) {
    return;
  }

  const normalizedOriginalMessage = normalizeMessageForRender(originalMessage);
  const preservedTimestamp = row.message.timestamp;
  const preservedEditedTimestamp = row.message.editedTimestamp;
  const preservedDeletedTimestamp = row.message.deletedTimestamp;
  const preservedId = row.message.id;

  Object.assign(row.message, normalizedOriginalMessage);

  row.message.id = preservedId;
  row.message.timestamp = preservedTimestamp;
  row.message.editedTimestamp = preservedEditedTimestamp;
  row.message.deletedTimestamp = preservedDeletedTimestamp;
}

function getMessagesFromLoadEvent(event: any): any[] | null {
  if (Array.isArray(event?.messages)) {
    return event.messages;
  }

  if (Array.isArray(event?.body)) {
    return event.body;
  }

  return null;
}

function getLoadEventChannelId(event: any, messages: any[]): string | null {
  return (
    event?.channelId || event?.channel_id || messages?.[0]?.channel_id || null
  );
}

function getTimestampValue(timestamp: any): number {
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeDeletedMessagesIntoLoad(event: any): any {
  const messages = getMessagesFromLoadEvent(event);
  if (!messages || messages.length === 0) {
    return event;
  }

  const channelId = getLoadEventChannelId(event, messages);
  if (!channelId) {
    return event;
  }

  const existingIds = new Set(
    messages.map((message) => message?.id).filter(Boolean),
  );
  const timestamps = messages
    .map((message) => getTimestampValue(message?.timestamp))
    .filter((timestamp) => timestamp > 0);

  const minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTimestamp =
    timestamps.length > 0 ? Math.max(...timestamps) : Number.MAX_SAFE_INTEGER;

  const deletedMessagesForRange = getLoggedMessages()
    .filter((entry) => entry.channelId === channelId)
    .map((entry) => entry.message)
    .filter((message) => !existingIds.has(message?.id))
    .filter((message) => {
      const timestamp = getTimestampValue(message?.timestamp);
      if (!timestamp) {
        return false;
      }

      return timestamp >= minTimestamp && timestamp <= maxTimestamp;
    });

  if (deletedMessagesForRange.length === 0) {
    return event;
  }

  const firstTimestamp = getTimestampValue(messages[0]?.timestamp);
  const lastTimestamp = getTimestampValue(
    messages[messages.length - 1]?.timestamp,
  );
  const isAscending = firstTimestamp <= lastTimestamp;

  const mergedMessages = [...messages, ...deletedMessagesForRange].sort(
    (left, right) => {
      const leftTimestamp = getTimestampValue(left?.timestamp);
      const rightTimestamp = getTimestampValue(right?.timestamp);
      return isAscending
        ? leftTimestamp - rightTimestamp
        : rightTimestamp - leftTimestamp;
    },
  );

  return {
    ...event,
    messages: Array.isArray(event?.messages) ? mergedMessages : event?.messages,
    body: Array.isArray(event?.body) ? mergedMessages : event?.body,
  };
}

function refreshUsers(
  userStore: { getUser: (id: string) => unknown } | undefined,
  userIds: string[],
): void {
  if (!userStore) {
    return;
  }

  for (const userId of new Set(
    userIds.map((id) => id?.trim()).filter(Boolean),
  )) {
    const user = userStore.getUser(userId);
    if (!user) {
      continue;
    }

    FluxDispatcher.dispatch({
      type: "USER_UPDATE",
      user,
    });
  }
}

function getAffectedUserIds(): string[] {
  return getOverrides()
    .map((override) => override?.userId?.trim())
    .filter(Boolean);
}

function setupMessageLogger(): void {
  if (!isMessageLoggerEnabled()) {
    return;
  }

  if (
    !ChannelMessages ||
    !MessageRecordUtils ||
    !MessageRecord ||
    !RowManager
  ) {
    console.log(`${TAG} message logger modules not found`);
    return;
  }

  patches.push(
    before("dispatch", FluxDispatcher, ([event]) => {
      if (!event?.type) {
        return;
      }

      try {
        if (event.type === "MESSAGE_CREATE") {
          if (!event.optimistic && event.message?.state !== "SENDING") {
            cacheRuntimeMessage(event.message);
          }
          return;
        }

        if (event.type === "MESSAGE_UPDATE") {
          if (event.message?.state !== "SENDING") {
            mergeMessageUpdateIntoCache(event.message);
          }
          return;
        }

        if (event.type === "LOAD_MESSAGES_SUCCESS") {
          const loadedMessages = getMessagesFromLoadEvent(event) || [];
          loadedMessages.forEach(cacheRuntimeMessage);
          return;
        }

        if (event.type === "MESSAGE_DELETE_BULK") {
          for (const messageId of event.ids || []) {
            const message = getMessageForLogging(event.channelId, messageId);
            if (
              message &&
              shouldLogMessage(message, event.channelId, event.guildId)
            ) {
              saveLoggedMessage(message);
            }
          }

          return;
        }

        if (event.type !== "MESSAGE_DELETE") {
          return;
        }

        if (event.__toolkit_cleanup) {
          return;
        }

        const message = getMessageForLogging(event.channelId, event.id);
        if (!message) {
          return;
        }

        const silentDeleteOriginal = getSilentReplacementOriginal(message);
        if (silentDeleteOriginal) {
          if (
            !shouldLogMessage(
              silentDeleteOriginal,
              event.channelId,
              event.guildId,
            )
          ) {
            return;
          }

          saveLoggedMessage(silentDeleteOriginal);

          return [
            {
              ...event,
              type: "MESSAGE_UPDATE",
              message: silentDeleteOriginal,
            },
          ];
        }

        if (message.author?.id === "1") {
          return;
        }

        if (message.state === "SEND_FAILED") {
          return;
        }

        if (!shouldLogMessage(message, event.channelId, event.guildId)) {
          return;
        }

        const deletedMessage = markMessageAsDeleted(message);
        saveLoggedMessage(deletedMessage);

        return [
          {
            ...event,
            type: "MESSAGE_UPDATE",
            message: deletedMessage,
          },
        ];
      } catch (error) {
        console.log(
          `${TAG} message logger hook failed`,
          error?.message ?? error,
        );
        return;
      }
    }),
  );

  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data?.rowType !== 1) {
        return;
      }

      const silentDeleteOriginal = getSilentReplacementOriginal(data?.message);
      if (silentDeleteOriginal) {
        applyOriginalToRenderedRow(row, silentDeleteOriginal);
      }

      if (row?.message?.__toolkit_deleted) {
        row.message.edited = row.message.__toolkit_silent_deleted
          ? "silent deleted"
          : "deleted";
        row.backgroundHighlight ??= {};
        row.backgroundHighlight.backgroundColor = row.message
          .__toolkit_silent_deleted
          ? ReactNative.processColor("#5865f255")
          : ReactNative.processColor("#ff4d4f55");
        row.backgroundHighlight.gutterColor = row.message
          .__toolkit_silent_deleted
          ? ReactNative.processColor("#5865f2ff")
          : ReactNative.processColor("#ff4d4fff");
      }
    }),
  );

  patches.push(
    instead(
      "updateMessageRecord",
      MessageRecordUtils,
      function ([oldRecord, newRecord], original) {
        if (newRecord?.__toolkit_deleted) {
          return MessageRecordUtils.createMessageRecord(
            newRecord,
            oldRecord?.reactions,
          );
        }

        return original.apply(this, [oldRecord, newRecord]);
      },
    ),
  );

  patches.push(
    after(
      "createMessageRecord",
      MessageRecordUtils,
      function ([message], record) {
        record.__toolkit_deleted = !!message?.__toolkit_deleted;
      },
    ),
  );

  patches.push(
    after("default", MessageRecord, ([props], record) => {
      record.__toolkit_deleted = !!props?.__toolkit_deleted;
    }),
  );
}

function cleanupMessageLogger(): void {
  if (!ChannelMessages?._channelMessages) {
    return;
  }

  try {
    for (const channelId in ChannelMessages._channelMessages) {
      const channel = ChannelMessages._channelMessages[channelId];
      for (const message of channel?._array ?? []) {
        if (!message?.__toolkit_deleted) {
          continue;
        }

        FluxDispatcher.dispatch({
          type: "MESSAGE_DELETE",
          id: message.id,
          channelId: message.channel_id,
          __toolkit_cleanup: true,
        });
      }
    }
  } catch (error) {
    console.log(
      `${TAG} message logger cleanup failed`,
      error?.message ?? error,
    );
  }

  runtimeMessageCache.clear();
  runtimeMessageCacheOrder.length = 0;
  silentReplacementMap.clear();
}

export function onLoad(): void {
  console.log(`${TAG} loaded`);

  const UserStore = findByStoreName("UserStore");
  if (!UserStore) {
    console.log(`${TAG} userStore not found`);
    return;
  }

  const avatarModule = findByProps("getUserAvatarURL");
  if (!avatarModule) {
    console.log(`${TAG} avatar module not found`);
    return;
  }

  setupMessageLogger();

  if (avatarModule.getUserAvatarSource) {
    const originalGetUserAvatarSource = avatarModule.getUserAvatarSource;
    avatarModule.getUserAvatarSource = function (...args) {
      const original = originalGetUserAvatarSource.apply(this, args);
      const overrideUrl = getOverrideUrl(args[0]);

      if (overrideUrl && original) {
        return {
          ...original,
          uri: overrideUrl,
        };
      }

      return original;
    };
    patches.push(() => {
      avatarModule.getUserAvatarSource = originalGetUserAvatarSource;
    });
  }

  const originalGetUserAvatarURL = avatarModule.getUserAvatarURL;
  avatarModule.getUserAvatarURL = function (...args) {
    const overrideUrl = getOverrideUrl(args[0]);
    if (overrideUrl) {
      return overrideUrl;
    }

    return originalGetUserAvatarURL.apply(this, args);
  };
  patches.push(() => {
    avatarModule.getUserAvatarURL = originalGetUserAvatarURL;
  });

  console.log(`${TAG} patches applied`);

  try {
    refreshUsers(UserStore, getAffectedUserIds());
    console.log(`${TAG} ui refreshed`);
  } catch (e) {
    console.log(`${TAG} could not trigger refresh:`, e.message);
  }
}

export function onUnload(): void {
  console.log(`${TAG} unloading...`);

  const UserStore = findByStoreName("UserStore");
  const affectedUserIds = getAffectedUserIds();

  patches.forEach((unpatch) => unpatch());
  patches = [];

  cleanupMessageLogger();

  try {
    refreshUsers(UserStore, affectedUserIds);
  } catch (e) {
    console.log(`${TAG} could not refresh after unload:`, e.message);
  }

  console.log(`${TAG} unloaded`);
}
