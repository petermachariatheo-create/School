import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "../src/config.ts";

describe("the server configuration", () => {
  test("has usable defaults when the environment is empty", () => {
    const config = loadConfig({});
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.port, 8080);
    assert.equal(config.synchronous, "NORMAL");
    assert.equal(config.syncBatchSize, 500);
    assert.equal(config.clientRetentionDays, 30);
    assert.equal(config.checkpointIntervalMs, 5_000);
    assert.equal(config.databaseFile, path.join(config.dataDir, "school.db"));
  });

  test("reads every setting from the environment", () => {
    const config = loadConfig({
      SCHOOL_HOST: "127.0.0.1",
      SCHOOL_PORT: "9090",
      SCHOOL_DATA_DIR: "/var/lib/school",
      SCHOOL_SQLITE_SYNCHRONOUS: "FULL",
      SCHOOL_SYNC_BATCH_SIZE: "100",
      SCHOOL_CLIENT_RETENTION_DAYS: "7",
      SCHOOL_CHECKPOINT_INTERVAL_MS: "1000",
    });
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 9090);
    assert.equal(config.dataDir, path.resolve("/var/lib/school"));
    assert.equal(config.synchronous, "FULL");
    assert.equal(config.syncBatchSize, 100);
    assert.equal(config.clientRetentionDays, 7);
    assert.equal(config.checkpointIntervalMs, 1_000);
  });

  test("falls back to the default when a setting is not a number", () => {
    const config = loadConfig({ SCHOOL_PORT: "eight thousand" });
    assert.equal(config.port, 8080);
  });

  test("treats an unset durability setting as NORMAL", () => {
    // Only `FULL` is accepted; anything else is a typo and must not
    // silently weaken the durability guarantee.
    assert.equal(loadConfig({ SCHOOL_SQLITE_SYNCHRONOUS: "full" }).synchronous, "NORMAL");
    assert.equal(loadConfig({ SCHOOL_SQLITE_SYNCHRONOUS: "OFF" }).synchronous, "NORMAL");
    assert.equal(loadConfig({ SCHOOL_SQLITE_SYNCHRONOUS: "FULL" }).synchronous, "FULL");
  });

  test("has no port file unless one is asked for", () => {
    const config = loadConfig({});
    assert.equal(config.portFile, null);
    assert.equal(config.securePortFile, null);
  });

  test("takes the port files from the environment", () => {
    // The launcher reads the port from the file, because the server moves
    // to the next port when the one it was given is already taken.
    const config = loadConfig({
      SCHOOL_PORT_FILE: "/var/lib/school/server.port",
      SCHOOL_SECURE_PORT_FILE: "/var/lib/school/server-secure.port",
    });
    assert.equal(config.portFile, path.resolve("/var/lib/school/server.port"));
    assert.equal(config.securePortFile, path.resolve("/var/lib/school/server-secure.port"));
  });
});
