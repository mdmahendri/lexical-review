import { expect, test } from "@playwright/test";
import type {} from "./InsertionFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?insertions");
  await page.waitForFunction(() => window.__insertionFixture !== undefined);
});

for (const route of ["root", "client"] as const) {
  test(`${route} insertion retains identity after native typing, navigation, and correction`, async ({
    page,
  }) => {
    const editor = page.getByTestId("insertion-editor");
    await page.evaluate((route) => {
      window.__insertionFixture!.select(0, 1);
      window.__insertionFixture!.insert("new", route);
    }, route);
    await expect(editor.locator("ins")).toHaveText("new");
    await page.keyboard.type("!");
    await expect(editor.locator("ins")).toHaveText("new!");
    await page.evaluate(() => window.__insertionFixture!.select(0, 0));
    await page.evaluate(() => window.__insertionFixture!.select(2, 0));
    await page.keyboard.type("?");
    await expect(editor.locator("ins")).toHaveText("new!?");
    await page.evaluate(() => window.__insertionFixture!.select(1, 0, 3));
    await page.keyboard.type("corrected");
    await expect(editor.locator("ins")).toHaveText("corrected!?");
    await expect(editor.locator("ins")).toHaveCount(1);
    const snapshot = await page.evaluate(() =>
      window.__insertionFixture!.snapshot(),
    );
    expect(snapshot).toMatchObject({
      proposal: { value: { proposalId: "insertion-1", text: "corrected!?" } },
      document: { status: "valid" },
    });
    await page.evaluate(() => window.__insertionFixture!.select(1, 0, 11));
    await page.keyboard.press("Backspace");
    await expect(editor).toHaveText("AB");
    await expect(editor.locator("ins")).toHaveCount(0);
  });
}

for (const action of ["accept", "reject", "remove"] as const) {
  test(`${action} resolves current insertion content as one operation`, async ({
    page,
  }) => {
    await page.evaluate((action) => {
      window.__insertionFixture!.select(0, 1);
      window.__insertionFixture!.insert("X", "root");
      window.__insertionFixture!.settle(action);
    }, action);
    await expect(page.getByTestId("insertion-editor")).toHaveText(
      action === "accept" ? "AXB" : "AB",
    );
    await expect(page.locator("ins")).toHaveCount(0);
    await page.evaluate(() => window.__insertionFixture!.undo());
    await expect(page.locator("ins")).toHaveText("X");
  });
}

test("a refused ambiguous edit adds no undo step", async ({ page }) => {
  await page.evaluate(() => {
    window.__insertionFixture!.select(0, 1);
    window.__insertionFixture!.insert("X", "root");
    window.__insertionFixture!.ambiguous();
  });
  const before = await page.evaluate(() =>
    window.__insertionFixture!.snapshot(),
  );
  await page.evaluate(() =>
    window.__insertionFixture!.insert("refused", "client"),
  );
  expect(
    await page.evaluate(() => window.__insertionFixture!.snapshot()),
  ).toEqual({ ...(before as object), lastOutcome: "refused" });
  await page.evaluate(() => window.__insertionFixture!.undo());
  await expect(page.getByTestId("insertion-editor")).toHaveText("AB");
});
