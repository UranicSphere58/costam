import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";

// tag added to all print statements to help with debugging with logcat on adb
const TAG = "[custom-avatars]";

type AvatarOverride = {
  userId?: string;
  imageUrl?: string;
};

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

  const overrideMap = new Map<string, string>();
  for (const override of getOverrides()) {
    const overrideUserId = override?.userId?.trim();
    const overrideImageUrl = override?.imageUrl?.trim();
    if (!overrideUserId || !overrideImageUrl) {
      continue;
    }

    overrideMap.set(overrideUserId, overrideImageUrl);
  }

  return overrideMap.get(userId) || null;
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

  // patch getUserAvatarSource, overrides avatar in DMs and group chats
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

  // patch getUserAvatarURL, overrides avatar in voice calls
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

  // restore patches
  patches.forEach((unpatch) => unpatch());
  patches = [];

  try {
    refreshUsers(UserStore, affectedUserIds);
  } catch (e) {
    console.log(`${TAG} could not refresh after unload:`, e.message);
  }

  console.log(`${TAG} unloaded`);
}
