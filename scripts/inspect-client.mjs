/**
 * Look at the client in a headless browser.
 *
 * This is a development aid, not part of the application: it opens the
 * client in headless Chrome, finishes the setup that a person would
 * normally do by hand, and takes a picture of the student list at three
 * widths so that the layout can be checked without a person in the loop.
 *
 *   node scripts/inspect-client.mjs [url] [outDir]
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:5173/";
// The pictures and the browser profile are scratch, and live outside the
// repository so that the linter does not read them.
const SCRATCH = resolve(tmpdir(), "school-inspect");
const OUT_DIR = resolve(process.argv[3] ?? `${SCRATCH}/shots`);
const PROFILE_DIR = `${SCRATCH}/profile`;
const PORT = 9333;

const WIDTHS = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "tablet", width: 834, height: 1112, mobile: false },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

/** Open the database the client uses and finish its setup. */
const FINISH_SETUP = `
  (async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("school", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction("meta", "readwrite");
    transaction.objectStore("meta").put({ key: "schoolName", value: "Greenwood Secondary" });
    transaction.objectStore("meta").put({ key: "setupComplete", value: true });
    await new Promise((resolve) => { transaction.oncomplete = resolve; });
    return "setup done";
  })()
`;

async function cdpTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await response.json();
}

class Session {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Page.javascriptDialogOpening") {
        // A confirmation the page is asking for: say yes, so that the run
        // can go on.
        this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
        return;
      }
      const waiter = this.#pending.get(message.id);
      if (waiter !== undefined) {
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          waiter.resolve(message.result);
        } else {
          waiter.reject(message.error);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((done, fail) => {
      this.#pending.set(id, { resolve: done, reject: fail });
    });
  }

  async evaluate(expression) {
    const result = await Promise.race([
      this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }),
      sleep(8000).then(() => ({ timedOut: true })),
    ]);
    if (result.timedOut === true) {
      return null;
    }
    if (result.exceptionDetails !== undefined) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }
}

async function openSession() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await cdpTargets();
      const page = targets.find((target) => target.type === "page");
      if (page !== undefined) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((done, fail) => {
          socket.addEventListener("open", done, { once: true });
          socket.addEventListener("error", fail, { once: true });
        });
        return new Session(socket);
      }
    } catch {
      // The browser is not up yet.
    }
    await sleep(250);
  }
  throw new Error("The browser did not start");
}

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

try {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });
  const session = await openSession();
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  // Load the client, finish its setup, and load it again so that it starts
  // on the student list rather than on the welcome screen.
  await session.send("Page.navigate", { url: URL_UNDER_TEST });
  await sleep(2500);
  console.log("setup:", await session.evaluate(FINISH_SETUP));
  await session.send("Page.reload", { ignoreCache: true });
  await sleep(3000);

  for (const size of WIDTHS) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: size.mobile,
    });
    await sleep(1200);
    const shot = await session.send("Page.captureScreenshot", { format: "png" });
    const file = `${OUT_DIR}/${size.name}.png`;
    await writeFile(file, Buffer.from(shot.data, "base64"));
    console.log(`wrote ${file}`);
  }

  // What the page says, so that the run can be checked without a picture.
  const summary = await session.evaluate(`
    JSON.stringify({
      heading: document.querySelector(".page-head__title")?.textContent ?? null,
      lede: document.querySelector(".page-head__lede")?.textContent ?? null,
      count: document.querySelector(".page-head__count")?.textContent ?? null,
      cards: document.querySelectorAll(".student-card").length,
      names: [...document.querySelectorAll(".student-card__name")].slice(0, 3).map((n) => n.textContent),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    })
  `);
  console.log("page:", summary);

  // The dense view of the same list, to check that it still works.
  await session.evaluate(`
    document.querySelector('.view-toggle__button[title="Show as a table"]')?.click()
  `);
  await sleep(1200);
  const table = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/desktop-table.png`, Buffer.from(table.data, "base64"));
  console.log(`wrote ${OUT_DIR}/desktop-table.png`);
  console.log(
    "table:",
    await session.evaluate(`
      JSON.stringify({
        rows: document.querySelectorAll(".table tbody tr").length,
        columns: [...document.querySelectorAll(".table th")].map((th) => th.textContent),
        footer: document.querySelector(".list-caption")?.textContent ?? null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // ---- the profile, and the form behind it -----------------------------

  await session.evaluate(`
    document.querySelector('.view-toggle__button[title="Show as cards"]')?.click()
  `);
  await sleep(600);
  await session.evaluate(`document.querySelector(".student-card")?.click()`);
  await sleep(1200);
  const profileShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/profile.png`, Buffer.from(profileShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/profile.png`);
  console.log(
    "profile:",
    await session.evaluate(`
      JSON.stringify({
        title: document.querySelector(".profile-header__title")?.textContent ?? null,
        identifier: document.querySelector(".profile-header__identifier")?.textContent ?? null,
        state: document.querySelector(".draft-status")?.textContent ?? null,
        sections: [...document.querySelectorAll(".profile-section__legend")].map((h) => h.textContent),
        facts: document.querySelectorAll(".profile-fact").length,
        related: [...document.querySelectorAll(".profile-related__title")].map((h) => h.textContent),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // Open the form, break a field, and check that what was typed is kept.
  await session.evaluate(`
    [...document.querySelectorAll(".profile-header__actions button")]
      .find((button) => button.textContent.includes("Edit"))?.click()
  `);
  await sleep(1200);
  const editorShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/editor.png`, Buffer.from(editorShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/editor.png`);
  console.log(
    "editor:",
    await session.evaluate(`
      JSON.stringify({
        title: document.querySelector(".editor__title")?.textContent ?? null,
        sections: [...document.querySelectorAll(".section__legend")].map((h) => h.textContent),
        fields: document.querySelectorAll(".field").length,
        labels: [...document.querySelectorAll(".field__head label")].length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // Type something that is not an email address, and try to save it.
  await session.evaluate(`
    (() => {
      const input = document.querySelector('[data-field="email"] input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "not-an-email");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
  await sleep(300);
  await session.evaluate(`
    document.querySelector('.form-actions button[type="submit"]')?.click()
  `);
  await sleep(900);
  console.log(
    "invalid:",
    await session.evaluate(`
      JSON.stringify({
        summary: document.querySelector(".editor__summary")?.textContent ?? null,
        kept: document.querySelector('[data-field="email"] input')?.value ?? null,
        focused: document.activeElement?.getAttribute("data-field") ?? document.activeElement?.tagName,
        stillEditing: document.querySelector(".editor__form") !== null,
      })
    `),
  );
  const invalidShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/editor-invalid.png`, Buffer.from(invalidShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/editor-invalid.png`);

  // The same form on a phone.
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(900);
  const mobileEditor = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/mobile-editor.png`, Buffer.from(mobileEditor.data, "base64"));
  console.log(`wrote ${OUT_DIR}/mobile-editor.png`);
  console.log(
    "mobile editor:",
    await session.evaluate(`
      JSON.stringify({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        columns: getComputedStyle(document.querySelector(".section__grid")).gridTemplateColumns,
      })
    `),
  );

  // ---- creating a record ------------------------------------------------

  // Back to the list: the editor, then the profile.
  for (let step = 0; step < 2; step += 1) {
    await session.evaluate(`
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Back"))?.click()
    `);
    await sleep(800);
  }
  await session.evaluate(`
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.includes("New student"))?.click()
  `);
  await sleep(900);
  console.log(
    "new record:",
    await session.evaluate(`
      JSON.stringify({
        title: document.querySelector(".editor__title")?.textContent ?? null,
        fields: document.querySelectorAll(".field").length,
        inEditor: document.querySelector(".editor__form") !== null,
      })
    `),
  );

  // Fill in the three required fields and save it.
  await session.evaluate(`
    (() => {
      const set = (name, value) => {
        const input = document.querySelector('[data-field="' + name + '"] input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("admissionNumber", "ADM-TEST-1");
      set("firstName", "Test");
      set("lastName", "Student");
    })()
  `);
  await sleep(400);
  await session.evaluate(`
    document.querySelector('.form-actions button[type="submit"]')?.click()
  `);
  await sleep(2000);
  console.log(
    "created:",
    await session.evaluate(`
      JSON.stringify({
        inEditor: document.querySelector(".editor__form") !== null,
        summary: document.querySelector(".editor__summary")?.textContent ?? null,
        problems: document.querySelector(".form-actions__problems")?.textContent ?? null,
        admission: document.querySelector('[data-field="admissionNumber"] input')?.value ?? null,
        firstName: document.querySelector('[data-field="firstName"] input')?.value ?? null,
        backAtList: document.querySelector(".student-grid") !== null,
        outbox: [...document.querySelectorAll(".topbar__status button")]
          .map((b) => b.textContent)
          .find((t) => t.includes("Outbox")) ?? null,
        found: [...document.querySelectorAll(".student-card__name")]
          .some((n) => n.textContent === "Test Student"),
      })
    `),
  );
  const createdShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/created.png`, Buffer.from(createdShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/created.png`);

  // ---- the same treatment for the guardians -----------------------------

  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.evaluate(`
    [...document.querySelectorAll(".navlink")]
      .find((button) => button.textContent.includes("Guardian"))?.click()
  `);
  await sleep(1500);
  const guardiansShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/guardians.png`, Buffer.from(guardiansShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/guardians.png`);
  console.log(
    "guardians:",
    await session.evaluate(`
      JSON.stringify({
        heading: document.querySelector(".page-head__title")?.textContent ?? null,
        cards: document.querySelectorAll(".student-card").length,
        hasToggle: document.querySelector(".view-toggle") !== null,
        names: [...document.querySelectorAll(".student-card__name")].slice(0, 3).map((n) => n.textContent),
        foot: [...document.querySelectorAll(".student-card__fact")].slice(0, 2).map((f) => f.textContent),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  await session.evaluate(`document.querySelector(".student-card")?.click()`);
  await sleep(1200);
  const guardianProfile = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/guardian-profile.png`, Buffer.from(guardianProfile.data, "base64"));
  console.log(`wrote ${OUT_DIR}/guardian-profile.png`);
  console.log(
    "guardian profile:",
    await session.evaluate(`
      JSON.stringify({
        title: document.querySelector(".profile-header__title")?.textContent ?? null,
        kind: document.querySelector(".profile-header__kind")?.textContent ?? null,
        sections: [...document.querySelectorAll(".profile-section__legend")].map((h) => h.textContent),
        related: [...document.querySelectorAll(".profile-related__link")].map((l) => l.textContent),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // ---- the same treatment for the classes -------------------------------

  await session.evaluate(`
    [...document.querySelectorAll(".navlink")]
      .find((button) => button.textContent.includes("Class"))?.click()
  `);
  await sleep(1500);
  const classesShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/classes.png`, Buffer.from(classesShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/classes.png`);
  console.log(
    "classes:",
    await session.evaluate(`
      JSON.stringify({
        heading: document.querySelector(".page-head__title")?.textContent ?? null,
        cards: document.querySelectorAll(".student-card").length,
        context: [...document.querySelectorAll(".student-card__admission")].slice(0, 3).map((c) => c.textContent),
        names: [...document.querySelectorAll(".student-card__name")].slice(0, 3).map((n) => n.textContent),
        foot: [...document.querySelectorAll(".student-card__fact")].slice(0, 4).map((f) => f.textContent),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  await session.evaluate(`document.querySelector(".student-card")?.click()`);
  await sleep(1500);
  const classProfile = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/class-profile.png`, Buffer.from(classProfile.data, "base64"));
  console.log(`wrote ${OUT_DIR}/class-profile.png`);
  console.log(
    "class profile:",
    await session.evaluate(`
      JSON.stringify({
        title: document.querySelector(".profile-header__title")?.textContent ?? null,
        identifier: document.querySelector(".profile-header__identifier")?.textContent ?? null,
        sections: [...document.querySelectorAll(".profile-section__legend")].map((h) => h.textContent),
        related: [...document.querySelectorAll(".profile-related__title")].map((h) => h.textContent),
        more: document.querySelector(".profile-related__more")?.textContent ?? null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // ---- the timetables ----------------------------------------------------

  await session.evaluate(`
    [...document.querySelectorAll(".navlink")]
      .find((button) => button.textContent.includes("Timetable"))?.click()
  `);
  await sleep(1800);
  const timetableShot = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/timetables.png`, Buffer.from(timetableShot.data, "base64"));
  console.log(`wrote ${OUT_DIR}/timetables.png`);
  console.log(
    "timetables:",
    await session.evaluate(`
      JSON.stringify({
        heading: document.querySelector(".page-head__title")?.textContent ?? null,
        days: [...document.querySelectorAll(".week__day-name")].map((h) => h.textContent),
        lessons: document.querySelectorAll(".lesson").length,
        first: document.querySelector(".lesson")?.textContent ?? null,
        controls: [...document.querySelectorAll(".timetable-control select")].length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })
    `),
  );

  // The week of one class, chosen from the list.
  await session.evaluate(`
    document.querySelector(".timetable-class__head")?.click()
  `);
  await sleep(900);
  const oneClass = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/timetable-class.png`, Buffer.from(oneClass.data, "base64"));
  console.log(`wrote ${OUT_DIR}/timetable-class.png`);
  console.log(
    "one class:",
    await session.evaluate(`
      JSON.stringify({
        classes: document.querySelectorAll(".timetable-class").length,
        expanded: document.querySelectorAll(".timetable-class__head[aria-expanded=true]").length,
        days: [...document.querySelectorAll(".week__day-name")].map((h) => h.textContent),
        times: [...document.querySelectorAll(".week__time")].map((h) => h.textContent),
        lessons: document.querySelectorAll(".lesson").length,
      })
    `),
  );

  // On a phone, the days stack.
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(900);
  const mobileTimetable = await session.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/mobile-timetable.png`, Buffer.from(mobileTimetable.data, "base64"));
  console.log(`wrote ${OUT_DIR}/mobile-timetable.png`);
  console.log(
    "mobile timetable:",
    await session.evaluate(`
      JSON.stringify({
        columns: getComputedStyle(document.querySelector(".week")).gridTemplateColumns,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        widest: [...document.querySelectorAll("body *")]
          .map((element) => ({
            tag: element.tagName,
            cls: element.className?.toString?.().slice(0, 40),
            right: Math.round(element.getBoundingClientRect().right),
          }))
          .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
          .slice(0, 5),
      })
    `),
  );
} finally {
  chrome.kill();
}
