/** Shared native/live invariant: one contiguous fragment component per paragraph. */
export type FragmentComponentPosition = Readonly<{
  paragraph: number;
  index: number;
  siblings: number;
  startsParagraph: boolean;
}>;
export function validFragmentPositions(
  parts: readonly FragmentComponentPosition[],
): boolean {
  return (
    parts.length >= 2 &&
    parts.every((part, index) => {
      const previous = parts[index - 1];
      return (
        part.startsParagraph === index > 0 &&
        (index === 0 ||
          (part.index === 0 && part.paragraph === previous!.paragraph + 1)) &&
        (index === parts.length - 1 || part.index === part.siblings - 1)
      );
    })
  );
}
