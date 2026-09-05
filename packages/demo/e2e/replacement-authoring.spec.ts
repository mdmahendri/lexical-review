import { expect, test } from "@playwright/test";
import type {} from "./InsertionFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?insertions");
  await page.waitForFunction(() => window.__insertionFixture !== undefined);
});

test("native replacement typing, correction, refusal, and cancellation preserve one identity", async ({
  page,
}) => {
  const editor = page.getByTestId("insertion-editor");
  await page.evaluate(() => window.__insertionFixture!.select(0, 0, 2));
  await page.keyboard.type("new");
  await expect(editor.locator("del")).toHaveText("AB");
  await expect(editor.locator("ins")).toHaveText("new");
  await page.evaluate(() => window.__insertionFixture!.select(1, 0, 3));
  await page.keyboard.type("corrected");
  await expect(editor.locator("ins")).toHaveText("corrected");
  expect(
    await page.evaluate(() => window.__insertionFixture!.snapshot()),
  ).toMatchObject({
    document: { status: "valid" },
    replacement: {
      value: { proposalId: "insertion-1", oldText: "AB", newText: "corrected" },
    },
  });
  await page.evaluate(() => window.__insertionFixture!.select(0, 0, 2));
  await page.keyboard.type("refused");
  await expect(editor.locator("del")).toHaveText("AB");
  await expect(editor.locator("ins")).toHaveText("corrected");
  await page.evaluate(() => window.__insertionFixture!.select(1, 0, 9));
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveText("AB");
  await expect(editor.locator("ins, del")).toHaveCount(0);
});

for (const action of ["accept", "reject", "remove"] as const) {
  test(`${action} resolves a replacement atomically and undo restores both sides`, async ({
    page,
  }) => {
    await page.evaluate((action) => {
      window.__insertionFixture!.select(0, 0, 2);
      window.__insertionFixture!.insert("new", "client");
      window.__insertionFixture!.settle(action);
    }, action);
    const editor = page.getByTestId("insertion-editor");
    await expect(editor).toHaveText(action === "accept" ? "new" : "AB");
    await expect(editor.locator("ins, del")).toHaveCount(0);
    await page.evaluate(() => window.__insertionFixture!.undo());
    await expect(editor.locator("del")).toHaveText("AB");
    await expect(editor.locator("ins")).toHaveText("new");
  });
}
