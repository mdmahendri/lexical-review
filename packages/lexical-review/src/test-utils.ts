import {
  type Klass,
  type LexicalNode,
  type HTMLConfig,
  type LexicalNodeReplacement,
  createEditor,
  ElementNode,
  TextNode,
  SerializedElementNode,
  SerializedTextNode,
  LexicalEditor,
  EditorState,
  EditorThemeClasses,
} from "lexical";
import { InitialConfigType } from "@lexical/react/LexicalComposer";

export type SerializedTestInlineElementNode = SerializedElementNode;

export class TestInlineElementNode extends ElementNode {
  static override getType(): string {
    return "test_inline_block";
  }

  static override clone(node: TestInlineElementNode) {
    return new TestInlineElementNode(node.__key);
  }

  static override importJSON(
    serializedNode: SerializedTestInlineElementNode,
  ): TestInlineElementNode {
    const node = $createTestInlineElementNode();
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  override exportJSON(): SerializedTestInlineElementNode {
    return {
      ...super.exportJSON(),
      type: "test_inline_block",
      version: 1,
    };
  }

  override createDOM() {
    return document.createElement("a");
  }

  override updateDOM() {
    return false;
  }

  override isInline() {
    return true;
  }
}

export function $createTestInlineElementNode(): TestInlineElementNode {
  return new TestInlineElementNode();
}

export type SerializedTestElementNode = SerializedElementNode;

export class TestElementNode extends ElementNode {
  static override getType(): string {
    return "test_block";
  }

  static override clone(node: TestElementNode) {
    return new TestElementNode(node.__key);
  }

  static override importJSON(
    serializedNode: SerializedTestElementNode,
  ): TestInlineElementNode {
    const node = $createTestInlineElementNode();
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  override exportJSON(): SerializedTestElementNode {
    return {
      ...super.exportJSON(),
      type: "test_block",
      version: 1,
    };
  }

  override createDOM() {
    return document.createElement("div");
  }

  override updateDOM() {
    return false;
  }
}

export function $createTestElementNode(): TestElementNode {
  return new TestElementNode();
}

type SerializedTestTextNode = SerializedTextNode;

export class TestTextNode extends TextNode {
  static override getType() {
    return "test_text";
  }

  static override clone(node: TestTextNode): TestTextNode {
    return new TestTextNode(node.__text, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedTestTextNode,
  ): TestTextNode {
    return new TestTextNode(serializedNode.text);
  }

  override exportJSON(): SerializedTestTextNode {
    return {
      ...super.exportJSON(),
      type: "test_text",
      version: 1,
    };
  }
}

export function createTestEditor(
  config: {
    namespace?: string;
    editorState?: EditorState;
    theme?: EditorThemeClasses;
    parentEditor?: LexicalEditor;
    nodes?: ReadonlyArray<Klass<LexicalNode> | LexicalNodeReplacement>;
    onError?: (error: Error) => void;
    disableEvents?: boolean;
    readOnly?: boolean;
    html?: HTMLConfig;
  } = {},
): LexicalEditor {
  const customNodes = config.nodes || [];
  const editor = createEditor({
    namespace: config.namespace,
    onError: (e) => {
      throw e;
    },
    ...config,
    nodes: DEFAULT_NODES.concat(customNodes),
  });
  return editor;
}

const DEFAULT_NODES: NonNullable<InitialConfigType["nodes"]> = [
  TestElementNode,
  TestTextNode,
];
