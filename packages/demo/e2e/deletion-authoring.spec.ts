import { expect, test } from "@playwright/test";
import type {} from "./DeletionFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?deletions");
  await page.waitForFunction(() => window.__deletionFixture !== undefined);
});

for (const backward of [false, true]) {
  test(`native ${backward ? "Backspace" : "Delete"} continues one identity with formatting nested inside del`, async ({
    page,
  }) => {
    await page.evaluate(
      (backward) => window.__deletionFixture!.select(0, backward ? 13 : 0),
      backward,
    );
    const key = backward ? "Backspace" : "Delete";
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    const marker = page.getByTestId("deletion-editor").locator("del");
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveText(backward ? "ee" : "on");
    await expect(marker.locator("strong")).toHaveText(backward ? "ee" : "on");
    await page.keyboard.press(`Control+${key}`);
    await expect(marker).toHaveText(backward ? "three" : "one");
    expect(
      await page.evaluate(() => window.__deletionFixture!.snapshot()),
    ).toMatchObject({
      proposal: {
        value: { proposalId: "deletion-1", text: backward ? "three" : "one" },
      },
      document: { status: "valid" },
    });
  });
}

for (const action of ["accept", "reject", "remove"] as const) {
  test(`${action} resolves a current range deletion without terminal metadata`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__deletionFixture!.select(0, 4, 7);
      window.__deletionFixture!.delete(false, "range");
    });
    await expect(page.locator("del")).toHaveText("two");
    await page.evaluate(
      (action) => window.__deletionFixture!.resolve(action),
      action,
    );
    await expect(page.locator("del")).toHaveCount(0);
    await expect(
      page.getByTestId("deletion-editor").locator("p").first(),
    ).toHaveText(action === "accept" ? "one  three" : "one two three");
    const snapshot = await page.evaluate(() =>
      window.__deletionFixture!.snapshot(),
    );
    expect(snapshot).toMatchObject({
      document: { status: "valid" },
      proposal: { status: "refused" },
    });
    expect(JSON.stringify(snapshot)).not.toContain('"proposalId":"deletion-1"');
  });
}

test("adjacency preserves selection, while a nonempty proposal-local deletion restores accepted text", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__deletionFixture!.select(0, 4, 7);
    window.__deletionFixture!.delete(false, "range");
    window.__deletionFixture!.select(2, 0);
  });
  const before = await page.evaluate(() =>
    window.__deletionFixture!.snapshot(),
  );
  await page.keyboard.press("Backspace");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toEqual({ ...(before as object), lastOutcome: "refused" });
  await page.evaluate(() => window.__deletionFixture!.select(1, 1, 2));
  await page.keyboard.press("Delete");
  await expect(page.locator("del")).toHaveCount(0);
  await expect(
    page.getByTestId("deletion-editor").locator("p").first(),
  ).toHaveText("one two three");
});

test("cross-paragraph refusal preserves the document and selection", async ({
  page,
}) => {
  await page.evaluate(() => window.__deletionFixture!.crossParagraph());
  const before = await page.evaluate(() =>
    window.__deletionFixture!.snapshot(),
  );
  await page.keyboard.press("Delete");
  expect(
    await page.evaluate(() => window.__deletionFixture!.snapshot()),
  ).toEqual({ ...(before as object), lastOutcome: "refused" });
});
