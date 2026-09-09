import { expect, test } from "@playwright/test";
import type {} from "./FormattingFixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/?formatting");
  await page.waitForFunction(() => window.__formattingFixture !== undefined);
});

for (const route of ["root", "client", "keyboard"] as const) {
  test(`${route} formatting retains selection and identity through correction and resolution`, async ({
    page,
  }) => {
    await page.evaluate(() => window.__formattingFixture!.select(0, 5, 0));
    if (route === "keyboard") await page.keyboard.press("Control+b");
    else
      await page.evaluate(
        (route) => window.__formattingFixture!.format("bold", route),
        route,
      );
    const editor = page.getByTestId("formatting-editor");
    await expect(editor.locator("[data-review-formatting] strong")).toHaveText(
      "plain",
    );
    expect(
      await page.evaluate(() => window.__formattingFixture!.snapshot()),
    ).toMatchObject({
      proposal: {
        value: {
          kind: "formatting",
          proposal: {
            proposalId: "proposal-1",
            accepted: [{ text: "plain", format: 0 }],
            current: [{ text: "plain", format: 1 }],
          },
        },
      },
      selection: { text: "plain", backward: true },
      document: { status: "valid" },
    });
    await page.keyboard.press("Control+i");
    await expect(
      editor.locator("[data-review-formatting] strong.italic"),
    ).toHaveText("plain");
    await page.evaluate(() => window.__formattingFixture!.settle("reject"));
    await expect(editor.locator("[data-review-formatting]")).toHaveCount(0);
    await expect(editor).toHaveText("plain bold");
    await expect(editor.locator("strong")).toHaveText("bold");
  });
}

test("collapsed toggles format only future native typing and movement adopts the destination", async ({
  page,
}) => {
  const editor = page.getByTestId("formatting-editor");
  await page.evaluate(() => window.__formattingFixture!.select(0, 2));
  await page.keyboard.press("Control+i");
  await expect(editor.locator("[data-review-formatting]")).toHaveCount(0);
  await page.keyboard.type("X");
  await expect(editor.locator("ins em")).toHaveText("X");
  await page.evaluate(() => window.__formattingFixture!.select(3, 2));
  await page.keyboard.type("Y");
  await expect(editor.locator("ins strong")).toHaveText("Y");
  await expect(editor.locator("ins em")).toHaveText("X");
  expect(
    await page.evaluate(() => window.__formattingFixture!.snapshot()),
  ).toMatchObject({ document: { status: "valid" } });
});

test("native typing cannot mutate a pending formatting target", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__formattingFixture!.select(0, 0, 5);
    window.__formattingFixture!.format("bold", "root");
    window.__formattingFixture!.select(0, 2);
  });
  const before = await page.evaluate(() =>
    window.__formattingFixture!.snapshot(),
  );
  await page.keyboard.type("X");
  expect(
    await page.evaluate(() => window.__formattingFixture!.snapshot()),
  ).toEqual({ ...(before as object), outcome: "refused" });
  await expect(page.getByTestId("formatting-editor")).toHaveText("plain bold");
});
