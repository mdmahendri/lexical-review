import { expect, test, type Page } from "@playwright/test";
async function snapshot(page: Page) {
  return page.evaluate(() => window.__fragmentFixture!.snapshot());
}
async function setup(page: Page, text = "x\ny") {
  await page.goto("/?fragment");
  await page.waitForFunction(() => !!window.__fragmentFixture);
  await page.evaluate((value) => window.__fragmentFixture!.insert(value), text);
}
test("multiline fragment typing and internal Enter/Backspace remain atomic", async ({
  page,
}) => {
  await setup(page);
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["Ax", "yB"], association: "proposal" });
  await page.keyboard.type("z");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["Ax", "yz", "B"] });
  await page.keyboard.press("Backspace");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["Ax", "yzB"] });
  await page.evaluate(() => window.__fragmentFixture!.settle("reject"));
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["AB"], document: { status: "valid" } });
});
test("arrow keys reach accepted and proposal sides at both outer endpoints", async ({
  page,
}) => {
  await setup(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ association: "accepted" });
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ association: "proposal" });
  await page.evaluate(() =>
    window.__fragmentFixture!.endpoint("start", "proposal"),
  );
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ association: "accepted" });
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ association: "proposal" });
});
test("accepted-side deletion stays separate from the fragment", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    window.__fragmentFixture!.endpoint("start", "accepted"),
  );
  await page.keyboard.press("Backspace");
  await expect(page.locator('[data-testid="fragment-editor"] del')).toHaveText(
    "A",
  );
  await page.evaluate(() => window.__fragmentFixture!.settle("reject"));
  await expect(page.locator('[data-testid="fragment-editor"] del')).toHaveText(
    "A",
  );
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["AB"], document: { status: "valid" } });
});
test("empty outer components preserve association and typing", async ({
  page,
}) => {
  await setup(page, "\nx\n");
  await page.keyboard.type("z");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["A", "x", "zB"] });
  await page.evaluate(() =>
    window.__fragmentFixture!.endpoint("start", "proposal"),
  );
  await page.keyboard.type("q");
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ paragraphs: ["Aq", "x", "zB"] });
  await page.evaluate(() => window.__fragmentFixture!.settle("reject"));
  await expect.poll(() => snapshot(page)).toMatchObject({ paragraphs: ["AB"] });
});
