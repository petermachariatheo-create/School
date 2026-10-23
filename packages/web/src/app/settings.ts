import { getDatabase } from "../data/db.ts";

/**
 * Settings that belong to this device rather than to the school.
 *
 * The school name and the fact that the setup has been done are not part of
 * the shared data model: they are how this device presents itself, and they
 * must be available before the first sync completes — or at all, when the
 * network is down.
 *
 * They live in the same IndexedDB database as the replica, in the `meta`
 * store, so that they are durable and never need the network.
 */

export interface SchoolSettings {
  /** The name shown in the interface, for example "Greenwood Secondary". */
  readonly schoolName: string;
  /** True once the person using this device has been through the setup. */
  readonly setupComplete: boolean;
}

export const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: "School Manager",
  setupComplete: false,
};

const SCHOOL_NAME_KEY = "schoolName";
const SETUP_COMPLETE_KEY = "setupComplete";

/** Read the settings, falling back to the defaults. */
export async function readSettings(): Promise<SchoolSettings> {
  try {
    const db = await getDatabase();
    const name = await db.get("meta", SCHOOL_NAME_KEY);
    const complete = await db.get("meta", SETUP_COMPLETE_KEY);
    return {
      schoolName:
        typeof name?.value === "string" && name.value.trim() !== ""
          ? name.value
          : DEFAULT_SETTINGS.schoolName,
      setupComplete: complete?.value === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Store a change to the settings. */
export async function writeSettings(patch: Partial<SchoolSettings>): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction("meta", "readwrite");
  if (patch.schoolName !== undefined) {
    await transaction.store.put({ key: SCHOOL_NAME_KEY, value: patch.schoolName });
  }
  if (patch.setupComplete !== undefined) {
    await transaction.store.put({ key: SETUP_COMPLETE_KEY, value: patch.setupComplete });
  }
  await transaction.done;
}
