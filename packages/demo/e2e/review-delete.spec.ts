import { expect, test, type Page } from "@playwright/test";
import type {
  NativeCaret,
  ReviewMarkup,
  ReviewEditorScenario,
  ReviewSegment,
} from "./ReviewEditorFixture.types";

type DeleteTraceEntry = {
  defaultPrevented: boolean;
  inputType?: string;
  key?: string;
  type: string;
};

declare global {
  interface Window {
    __deleteTrace?: DeleteTraceEntry[];
  }
}

async function openReviewEditorFixture(page: Page): Promise<void> {
  await page.goto(".");

  const editor = page.getByTestId("review-editor");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__lexicalReviewEditorFixture !== undefined),
    )
    .toBe(true);
}

async function getSegments(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<ReviewSegment[]> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getSegments(scenario);
  }, scenario);
}

async function compose(
  page: Page,
  scenario: ReviewEditorScenario,
  text: string,
): Promise<void> {
  await page.evaluate(
    ({ scenario, text }) => {
      const fixture = window.__lexicalReviewEditorFixture;

      if (fixture == null) {
        throw new Error("The review editor fixture is not ready.");
      }

      fixture.compose(scenario, text);
    },
    { scenario, text },
  );
}

async function getMarkup(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<ReviewMarkup> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getMarkup(scenario);
  }, scenario);
}

async function placeCaret(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<void> {
  await page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    fixture.placeCaret(scenario);
  }, scenario);
}

async function getCaret(
  page: Page,
  scenario: ReviewEditorScenario,
): Promise<NativeCaret | null> {
  return page.evaluate((scenario) => {
    const fixture = window.__lexicalReviewEditorFixture;

    if (fixture == null) {
      throw new Error("The review editor fixture is not ready.");
    }

    return fixture.getCaret(scenario);
  }, scenario);
}

async function installDeleteTrace(page: Page): Promise<void> {
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

    window.__deleteTrace = trace;
  });
}

async function getDeleteTrace(page: Page): Promise<DeleteTraceEntry[]> {
  return page.evaluate(() => window.__deleteTrace ?? []);
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    )
    .toBe("review-editor");
}

function expectedDeletedSegments(
  originalText: string,
  deletedCharacters: number,
): ReviewSegment[] {
  return [
    {
      review: "deletion",
      text: originalText.slice(0, deletedCharacters),
    },
    {
      review: "original",
      text: originalText.slice(deletedCharacters),
    },
  ];
}

test("Delete removes one inserted character at an original-to-insertion boundary", async ({
  page,
}, testInfo) => {
  await openReviewEditorFixture(page);
  const initialSegments = await getSegments(page, "insertion-boundary");
  const insertionIndex = initialSegments.findIndex(
    (segment) => segment.review === "insertion",
  );
  const initialInsertion = initialSegments[insertionIndex];

  expect(insertionIndex).toBeGreaterThanOrEqual(0);
  if (initialInsertion == null) {
    throw new Error("The review editor fixture has no insertion segment.");
  }
  expect(initialInsertion.text).not.toBe("");

  await placeCaret(page, "insertion-boundary");
  await expectEditorFocused(page);
  await expect
    .poll(() => getCaret(page, "insertion-boundary"))
    .toEqual({
      anchorNodeType: "text",
      offset: initialSegments[0]?.text.length,
      review: "original",
      segmentIndex: 0,
    });
  await installDeleteTrace(page);
  await page.keyboard.press("Delete");

  const expectedSegments = initialSegments.map((segment, index) =>
    index === insertionIndex
      ? { ...segment, text: segment.text.slice(1) }
      : segment,
  );
  await expect
    .poll(async () => ({
      caret: await getCaret(page, "insertion-boundary"),
      segments: await getSegments(page, "insertion-boundary"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: 0,
        review: "insertion",
        segmentIndex: insertionIndex,
      },
      segments: expectedSegments,
    });

  await expect
    .poll(async () => {
      const trace = await getDeleteTrace(page);
      return trace.some(
        (event) => event.type === "keydown" && event.key === "Delete",
      );
    })
    .toBe(true);

  const trace = await getDeleteTrace(page);
  await testInfo.attach("delete-event-trace", {
    body: JSON.stringify(
      {
        browser: testInfo.project.name,
        caret: await getCaret(page, "insertion-boundary"),
        trace,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("two Delete presses mark consecutive original characters as deleted", async ({
  page,
}, testInfo) => {
  await openReviewEditorFixture(page);
  const initialSegments = await getSegments(page, "consecutive-delete-start");

  expect(initialSegments).toHaveLength(1);
  const initialSegment = initialSegments[0];
  if (initialSegment == null) {
    throw new Error("The review editor fixture has no original segment.");
  }
  expect(initialSegment.review).toBe("original");
  expect(initialSegment.text.length).toBeGreaterThanOrEqual(2);

  await placeCaret(page, "consecutive-delete-start");
  await expectEditorFocused(page);
  await expect
    .poll(() => getCaret(page, "consecutive-delete-start"))
    .toEqual({
      anchorNodeType: "text",
      offset: 0,
      review: "original",
      segmentIndex: 0,
    });

  await page.keyboard.press("Delete");

  const snapshots: Array<{
    caret: NativeCaret | null;
    segments: ReviewSegment[];
  }> = [];
  await expect
    .poll(async () => ({
      caret: await getCaret(page, "consecutive-delete-start"),
      segments: await getSegments(page, "consecutive-delete-start"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: 1,
        review: "deletion",
        segmentIndex: 0,
      },
      segments: expectedDeletedSegments(initialSegment.text, 1),
    });
  snapshots.push({
    caret: await getCaret(page, "consecutive-delete-start"),
    segments: await getSegments(page, "consecutive-delete-start"),
  });

  await page.keyboard.press("Delete");
  try {
    await expect
      .poll(async () => ({
        caret: await getCaret(page, "consecutive-delete-start"),
        segments: await getSegments(page, "consecutive-delete-start"),
      }))
      .toEqual({
        caret: {
          anchorNodeType: "text",
          offset: 2,
          review: "deletion",
          segmentIndex: 0,
        },
        segments: expectedDeletedSegments(initialSegment.text, 2),
      });
  } finally {
    snapshots.push({
      caret: await getCaret(page, "consecutive-delete-start"),
      segments: await getSegments(page, "consecutive-delete-start"),
    });

    await testInfo.attach("consecutive-delete-snapshots", {
      body: JSON.stringify(
        { browser: testInfo.project.name, snapshots },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
});

test("composition commits formatted review text once and keeps the caret", async ({
  page,
}) => {
  await openReviewEditorFixture(page);
  await expect
    .poll(() => getSegments(page, "composition"))
    .toEqual([{ review: "insertion", text: "composed" }]);

  await placeCaret(page, "composition");
  await compose(page, "composition", "あ");

  await expect
    .poll(async () => ({
      caret: await getCaret(page, "composition"),
      markup: await getMarkup(page, "composition"),
      segments: await getSegments(page, "composition"),
    }))
    .toEqual({
      caret: {
        anchorNodeType: "text",
        offset: "composedあ".length,
        review: "insertion",
        segmentIndex: 0,
      },
      markup: {
        format: "EM",
        marker: "INS",
        text: "composedあ",
      },
      segments: [{ review: "insertion", text: "composedあ" }],
    });
});
