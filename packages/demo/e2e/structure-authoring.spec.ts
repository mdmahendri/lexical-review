import { expect, test } from "@playwright/test";
import type {} from "./StructureFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?structure");
  await page.waitForFunction(() => window.__structureFixture !== undefined);
});
for (const route of ["root", "client", "keyboard"] as const) {
  test(`${route} split preserves subsequent typing when rejected`, async ({
    page,
  }) => {
    await page.evaluate(() => window.__structureFixture!.select(0, 6));
    if (route === "keyboard") await page.keyboard.press("Enter");
    else
      await page.evaluate(
        (route) => window.__structureFixture!.split(route),
        route,
      );
    const editor = page.getByTestId("structure-editor");
    await expect(editor.locator("p")).toHaveCount(3);
    await expect(editor.locator('[data-review-boundary="split"]')).toHaveCount(
      1,
    );
    await page.keyboard.type("new ");
    await expect(
      editor.locator("p").nth(1).locator("ins:not([data-review-boundary])"),
    ).toHaveText("new ");
    await page.evaluate(() =>
      window.__structureFixture!.settle(["proposal-1"], "reject"),
    );
    await expect(editor.locator("p")).toHaveCount(2);
    expect(
      await page.evaluate(() => window.__structureFixture!.snapshot()),
    ).toMatchObject({
      paragraphs: ["Hello new world", "Next"],
      document: { status: "valid" },
    });
  });
}
test("Backspace cancels a split and Enter cancels a merge without duplicate proposals", async ({
  page,
}) => {
  await page.evaluate(() => window.__structureFixture!.select(0, 6));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  const editor = page.getByTestId("structure-editor");
  await expect(editor.locator("p")).toHaveCount(2);
  await expect(editor.locator("[data-review-boundary]")).toHaveCount(0);
  await page.evaluate(() => window.__structureFixture!.select(1, 0));
  await page.keyboard.press("Backspace");
  await expect(editor.locator("p")).toHaveCount(1);
  await expect(editor.locator('[data-review-boundary="merge"]')).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(editor.locator("p")).toHaveCount(2);
  await expect(editor.locator("[data-review-boundary]")).toHaveCount(0);
});
test("merge marker exposes two typing attachments that survive rejection", async ({
  page,
}) => {
  await page.evaluate(() => window.__structureFixture!.select(1, 0));
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__structureFixture!.marker("left"));
  await page.keyboard.type("L");
  await page.evaluate(() => window.__structureFixture!.marker("right"));
  await page.keyboard.type("R");
  await page.evaluate(() =>
    window.__structureFixture!.settle(["proposal-1"], "reject"),
  );
  expect(
    await page.evaluate(() => window.__structureFixture!.snapshot()),
  ).toMatchObject({
    paragraphs: ["Hello worldL", "RNext"],
    document: { status: "valid" },
  });
});
test("keyboard navigation can cross the merge marker and type on either side", async ({
  page,
}) => {
  await page.evaluate(() => window.__structureFixture!.select(1, 0));
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__structureFixture!.marker("left"));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("R");
  await page.evaluate(() =>
    window.__structureFixture!.settle(["proposal-1"], "reject"),
  );
  expect(
    await page.evaluate(() => window.__structureFixture!.snapshot()),
  ).toMatchObject({
    paragraphs: ["Hello world", "RNext"],
    document: { status: "valid" },
  });
});
test("Enter over a range refuses without changing content or logical selection", async ({
  page,
}) => {
  await page.evaluate(() => window.__structureFixture!.select(0, 2, 7));
  const before = await page.evaluate(() =>
    window.__structureFixture!.snapshot(),
  );
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.__structureFixture!.snapshot()),
  ).toEqual({ ...(before as object), outcome: "refused" });
});

test("repeated Enter in an empty paragraph remains editable and cancellable", async ({
  page,
}) => {
  await page.goto("/?structure&empty");
  await page.waitForFunction(() => window.__structureFixture !== undefined);
  await page.evaluate(() => window.__structureFixture!.paragraph(0));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("structure-editor").locator("p")).toHaveCount(
    4,
  );
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("structure-editor").locator("p")).toHaveCount(
    3,
  );
  await page.keyboard.type("X");
  await page.evaluate(() =>
    window.__structureFixture!.settle(["proposal-1"], "reject"),
  );
  expect(
    await page.evaluate(() => window.__structureFixture!.snapshot()),
  ).toMatchObject({ paragraphs: ["X", ""], document: { status: "valid" } });
});
for (const direction of ["ArrowLeft", "ArrowRight"] as const) {
  test(`${direction} crosses an empty merge seam without losing side formatting`, async ({
    page,
  }) => {
    await page.goto("/?structure&empty");
    await page.waitForFunction(() => window.__structureFixture !== undefined);
    await page.evaluate(() => window.__structureFixture!.paragraph(1));
    await page.keyboard.press("Backspace");
    await page.evaluate(
      (direction) =>
        window.__structureFixture!.marker(
          direction === "ArrowLeft" ? "right" : "left",
        ),
      direction,
    );
    await page.keyboard.press(direction);
    await page.keyboard.type("X");
    await page.evaluate(() =>
      window.__structureFixture!.settle(["proposal-1"], "reject"),
    );
    expect(
      await page.evaluate(() => window.__structureFixture!.snapshot()),
    ).toMatchObject({
      paragraphs: direction === "ArrowLeft" ? ["X", ""] : ["", "X"],
      document: { status: "valid" },
    });
    await expect(
      page
        .getByTestId("structure-editor")
        .locator(direction === "ArrowLeft" ? "ins strong" : "ins em"),
    ).toHaveText("X");
  });
}
