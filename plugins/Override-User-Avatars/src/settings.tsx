import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { FormDivider, FormInput, FormRow, FormSwitchRow } = Forms;

type UserOverride = {
  userId?: string;
  imageUrl?: string;
};

type LoggedMessage = {
  id: string;
  channelId: string;
  deletedAt: number;
  message: any;
};

type SettingsPage = "home" | "overrides" | "messageLogger";

const styles = ReactNative.StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 360,
  },
  emptyState: {
    opacity: 0.7,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyStateText: {
    fontSize: 14,
  },
  rowActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
  },
  addText: {
    color: "#43b581",
  },
  backText: {
    color: "#5865f2",
  },
  removeText: {
    color: "#f04747",
  },
  sectionText: {
    opacity: 0.7,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  sectionTextValue: {
    fontSize: 13,
  },
});

function getOverrides(): UserOverride[] {
  if (Array.isArray(storage.overrides)) {
    return storage.overrides;
  }

  const migratedOverrides: UserOverride[] = [];
  if (storage.targetUserId || storage.imageUrl) {
    migratedOverrides.push({
      userId: storage.targetUserId || "",
      imageUrl: storage.imageUrl || "",
    });
  }

  storage.overrides = migratedOverrides;
  return storage.overrides;
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

function refreshUser(userId?: string): void {
  const trimmedUserId = userId?.trim();
  if (!trimmedUserId) {
    return;
  }

  const userStore = findByStoreName("UserStore");
  const user = userStore?.getUser(trimmedUserId);
  if (!user) {
    return;
  }

  FluxDispatcher.dispatch({
    type: "USER_UPDATE",
    user,
  });
}

export default () => {
  useProxy(storage);

  const scrollRef = React.useRef<any>(null);
  const [page, setPage] = React.useState<SettingsPage>("home");
  const overrides = getOverrides();
  const loggedMessages = getLoggedMessages();

  const openPage = (nextPage: SettingsPage) => {
    setPage(nextPage);
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false }),
    );
  };

  const updateOverride = (index: number, patch: UserOverride) => {
    const currentOverride = overrides[index] || {};
    const previousUserId = currentOverride.userId;
    const nextOverride = {
      ...currentOverride,
      ...patch,
    };

    storage.overrides = overrides.map((override, overrideIndex) =>
      overrideIndex === index ? nextOverride : override,
    );

    refreshUser(previousUserId);
    refreshUser(nextOverride.userId);
  };

  const addOverride = () => {
    storage.overrides = [...overrides, { userId: "", imageUrl: "" }];

    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd?.({ animated: true }),
    );
  };

  const removeOverride = (index: number) => {
    const removedOverride = overrides[index];
    storage.overrides = overrides.filter(
      (_, overrideIndex) => overrideIndex !== index,
    );
    refreshUser(removedOverride?.userId);
  };

  return (
    <ReactNative.KeyboardAvoidingView
      style={styles.container}
      behavior={ReactNative.Platform.OS === "ios" ? "padding" : undefined}
    >
      <ReactNative.ScrollView
        ref={scrollRef}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={true}
        contentContainerStyle={styles.content}
      >
        {page === "home" ? (
          <>
            <FormRow label="Uranic Toolkit" />
            <ReactNative.View style={styles.sectionText}>
              <ReactNative.Text style={styles.sectionTextValue}>
                Personal Revenge tweaks made by Uranic.
              </ReactNative.Text>
            </ReactNative.View>
            <FormDivider />
            <FormRow
              label="Avatar overrides"
              subLabel="Open the overrides settings"
              onPress={() => openPage("overrides")}
            />
            <FormDivider />
            <FormRow
              label="Message logger"
              subLabel={`Saved deleted messages: ${loggedMessages.length}`}
              onPress={() => openPage("messageLogger")}
            />
            <ReactNative.View style={styles.sectionText}>
              <ReactNative.Text style={styles.sectionTextValue}>
                Tries to keep deleted messages visible and restore them after
                reload.
              </ReactNative.Text>
            </ReactNative.View>
          </>
        ) : page === "overrides" ? (
          <>
            <FormRow
              label="Avatar overrides"
              subLabel="Override avatars for selected users"
            />
            <ReactNative.View style={styles.rowActions}>
              <ReactNative.Pressable onPress={() => openPage("home")}>
                <ReactNative.Text style={[styles.actionText, styles.backText]}>
                  Back
                </ReactNative.Text>
              </ReactNative.Pressable>
              <ReactNative.Pressable onPress={addOverride}>
                <ReactNative.Text style={[styles.actionText, styles.addText]}>
                  Add override
                </ReactNative.Text>
              </ReactNative.Pressable>
            </ReactNative.View>
            <FormDivider />
            {overrides.length === 0 ? (
              <ReactNative.View style={styles.emptyState}>
                <ReactNative.Text style={styles.emptyStateText}>
                  No overrides yet. Tap "Add override" to create one.
                </ReactNative.Text>
              </ReactNative.View>
            ) : null}
            {overrides.map((override, index) => (
              <ReactNative.View key={`override-${index}`}>
                <FormRow label={`User ${index + 1}`} />
                <FormInput
                  placeholder="Enter target user ID"
                  value={override.userId || ""}
                  onChange={(value) => updateOverride(index, { userId: value })}
                />
                <FormInput
                  placeholder="Enter image URL"
                  value={override.imageUrl || ""}
                  onChange={(value) =>
                    updateOverride(index, { imageUrl: value })
                  }
                />

                <ReactNative.View style={styles.rowActions}>
                  <ReactNative.View />
                  <ReactNative.Pressable onPress={() => removeOverride(index)}>
                    <ReactNative.Text
                      style={[styles.actionText, styles.removeText]}
                    >
                      Remove
                    </ReactNative.Text>
                  </ReactNative.Pressable>
                </ReactNative.View>
                <FormDivider />
              </ReactNative.View>
            ))}
          </>
        ) : (
          <>
            <FormRow
              label="Message logger"
              subLabel="Keep deleted messages saved inside the plugin and restore them after reload"
            />
            <FormSwitchRow
              label="Enable message logger"
              value={isMessageLoggerEnabled()}
              onValueChange={(value) =>
                void (storage.messageLoggerEnabled = value)
              }
            />
            <FormDivider />
            <ReactNative.View style={styles.rowActions}>
              <ReactNative.Pressable onPress={() => openPage("home")}>
                <ReactNative.Text style={[styles.actionText, styles.backText]}>
                  Back
                </ReactNative.Text>
              </ReactNative.Pressable>
              <ReactNative.Pressable
                onPress={() => void (storage.loggedMessages = [])}
              >
                <ReactNative.Text
                  style={[styles.actionText, styles.removeText]}
                >
                  Clear log
                </ReactNative.Text>
              </ReactNative.Pressable>
            </ReactNative.View>
            <FormDivider />
            {loggedMessages.length === 0 ? (
              <ReactNative.View style={styles.emptyState}>
                <ReactNative.Text style={styles.emptyStateText}>
                  No deleted messages saved yet.
                </ReactNative.Text>
              </ReactNative.View>
            ) : (
              loggedMessages.map((entry, index) => (
                <ReactNative.View key={`logged-message-${entry.id}-${index}`}>
                  <FormRow
                    label={entry.message?.author?.username || "Unknown author"}
                    subLabel={entry.message?.content || "[No text content]"}
                  />
                  <ReactNative.View style={styles.sectionText}>
                    <ReactNative.Text style={styles.sectionTextValue}>
                      Channel: {entry.channelId}
                    </ReactNative.Text>
                    <ReactNative.Text style={styles.sectionTextValue}>
                      Deleted: {new Date(entry.deletedAt).toLocaleString()}
                    </ReactNative.Text>
                  </ReactNative.View>
                  <FormDivider />
                </ReactNative.View>
              ))
            )}
          </>
        )}
      </ReactNative.ScrollView>
    </ReactNative.KeyboardAvoidingView>
  );
};
