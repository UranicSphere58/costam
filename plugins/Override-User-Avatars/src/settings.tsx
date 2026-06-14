import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { FormDivider, FormInput, FormRow } = Forms;

type AvatarOverride = {
  userId?: string;
  imageUrl?: string;
};

const styles = ReactNative.StyleSheet.create({
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
    justifyContent: "flex-end",
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
  removeText: {
    color: "#f04747",
  },
});

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

  const overrides = getOverrides();

  const updateOverride = (index: number, patch: AvatarOverride) => {
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
  };

  const removeOverride = (index: number) => {
    const removedOverride = overrides[index];
    storage.overrides = overrides.filter(
      (_, overrideIndex) => overrideIndex !== index,
    );
    refreshUser(removedOverride?.userId);
  };

  return (
    <ReactNative.ScrollView>
      <FormRow label="Avatar overrides" />
      {overrides.length === 0 ? (
        <ReactNative.View style={styles.emptyState}>
          <ReactNative.Text style={styles.emptyStateText}>
            No overrides yet. Add a new entry below.
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
            onChange={(value) => updateOverride(index, { imageUrl: value })}
          />
          <ReactNative.View style={styles.rowActions}>
            <ReactNative.Pressable onPress={() => removeOverride(index)}>
              <ReactNative.Text style={[styles.actionText, styles.removeText]}>
                Remove
              </ReactNative.Text>
            </ReactNative.Pressable>
          </ReactNative.View>
          <FormDivider />
        </ReactNative.View>
      ))}
      <ReactNative.View style={styles.rowActions}>
        <ReactNative.Pressable onPress={addOverride}>
          <ReactNative.Text style={[styles.actionText, styles.addText]}>
            Add override
          </ReactNative.Text>
        </ReactNative.Pressable>
      </ReactNative.View>
    </ReactNative.ScrollView>
  );
};
