import { expect, test } from "@playwright/test";

type DeleteTraceEntry = {
  defaultPrevented: boolean;
  inputType?: string;
  key?: string;
  type: string;
};

test("Delete removes one inserted character at an original-to-insertion boundary", async ({
  page,
}, testInfo) => {
  await page.goto(".");

  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();

  await editor.evaluate((root) => {
    const original = Array.from(root.querySelectorAll("p span")).find(
      (span) => span.textContent === "Lorem ipsum dolor sit amet, ",
    );
    const textNode = original?.firstChild;
    const selection = root.ownerDocument.defaultView?.getSelection();

    if (!(textNode instanceof Text) || selection == null) {
      throw new Error("Could not find the original text boundary.");
    }

    const range = root.ownerDocument.createRange();
    range.setStart(textNode, textNode.data.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    (root as HTMLElement).focus();
  });

  await page.evaluate(() => {
    const trace: DeleteTraceEntry[] = [];

    for (const type of ["keydown", "beforeinput", "input"]) {
      document.addEventListener(
        type,
        (event) => {
          const keyboardEvent = event as KeyboardEvent;
          const inputEvent = event as InputEvent;
          trace.push({
            type,
            defaultPrevented: event.defaultPrevented,
            key: keyboardEvent.key,
            inputType: inputEvent.inputType,
          });
        },
        false,
      );
    }

    (window as Window & { __deleteTrace?: DeleteTraceEntry[] }).__deleteTrace =
      trace;
  });

  await page.waitForTimeout(50);
  await page.keyboard.press("Delete");

  const insertedText = await editor.locator("ins").first().textContent();
  expect(insertedText).toBe("onsectetur adipiscing elit, ");

  const trace = await page.evaluate(
    () =>
      (window as Window & { __deleteTrace?: DeleteTraceEntry[] })
        .__deleteTrace ?? [],
  );
  await testInfo.attach("delete-event-trace", {
    body: JSON.stringify({ browser: testInfo.project.name, trace }, null, 2),
    contentType: "application/json",
  });
  expect(
    trace.some((event) => event.type === "keydown" && event.key === "Delete"),
  ).toBe(true);
});

test("consecutive Delete presses mark consecutive original characters", async ({
  page,
}, testInfo) => {
  test.fail(
    testInfo.project.name === "firefox",
    "Known Firefox selection-boundary issue: see #1.",
  );

  await page.goto(".");

  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();

  await editor.evaluate((root) => {
    const original = Array.from(root.querySelectorAll("p span")).find(
      (span) => span.textContent === "Lorem Ipsum Generator",
    );
    const textNode = original?.firstChild;
    const selection = root.ownerDocument.defaultView?.getSelection();

    if (!(textNode instanceof Text) || selection == null) {
      throw new Error("Could not find the original text start.");
    }

    const range = root.ownerDocument.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    (root as HTMLElement).focus();
  });

  const snapshots: Array<Array<{ tag: string; text: string }>> = [];

  for (let press = 0; press < 2; press += 1) {
    await page.keyboard.press("Delete");
    await page.waitForTimeout(50);
    snapshots.push(
      await editor.evaluate((root) => {
        const paragraph = Array.from(root.querySelectorAll("p")).find(
          (candidate) => candidate.textContent === "Lorem Ipsum Generator",
        );

        if (paragraph == null) {
          throw new Error("Could not find the original paragraph.");
        }

        return Array.from(paragraph.children).map((child) => ({
          tag: child.tagName.toLowerCase(),
          text: child.textContent ?? "",
        }));
      }),
    );
  }

  await testInfo.attach("consecutive-delete-snapshots", {
    body: JSON.stringify(
      { browser: testInfo.project.name, snapshots },
      null,
      2,
    ),
    contentType: "application/json",
  });

  expect(snapshots[0]).toEqual([
    { tag: "del", text: "L" },
    { tag: "span", text: "orem Ipsum Generator" },
  ]);

  const reviewStates = snapshots.map((snapshot) => ({
    deleted: snapshot
      .filter((child) => child.tag === "del")
      .map((child) => child.text)
      .join(""),
    original: snapshot
      .filter((child) => child.tag === "span")
      .map((child) => child.text)
      .join(""),
  }));

  expect(reviewStates[0]).toEqual({
    deleted: "L",
    original: "orem Ipsum Generator",
  });
  expect(reviewStates[1]).toEqual({
    deleted: "Lo",
    original: "rem Ipsum Generator",
  });
});
