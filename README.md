# lexical-review
- There is a lack of available open-source for review mode text-editor, even though there is a need for documenting changes
- This is an implementation of review mode based on the ability of [Lexical](https://github.com/facebook/lexical) text-editor framework. The degree of customization offered through Lexical is good enough to add this feature.

## Demo
demo can be accessed from [https://mdmahendri.github.io/lexical-review/](https://mdmahendri.github.io/lexical-review/) and the source code is available through the repo in `packages/demo`

## Installation
```
npm i lexical-review
```

## Features
- Support review-mode only for textual change; does not support yet format change
- Support custom theme as any other element in Lexical

## Explanation of Behavior and Modifications from Lexical
- As I said before, Lexical provides good code for developers to make changes, so this library is created based on modification of `TextNode`, `RangeSelection`,  since both has the most needed features from review-mode
- Deciding behavior for review-mode in some cases are difficult, so I compare it with popular text editor to gain how they handle that.
- For detailed explanation on behavior, I take some notes and place it in the source code, such as in `ReviewSelection.ts`

## Contributing
- If you notice any inconsistencies or bad practices please open the issue or pull request. This is my first library created in monorepo format and registered to NPM