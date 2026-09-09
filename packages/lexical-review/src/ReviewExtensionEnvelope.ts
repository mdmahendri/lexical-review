/**
 * Opaque versioned extension envelopes (#63, Posture 1: native is a carrier).
 *
 * Native never interprets extension semantics: every well-formed URI is
 * unknown-to-native (zero known extensions are shipped) and handled by the
 * generic required/optional dispatch. This module owns the envelope grammar,
 * the required→unsupported dispatch, and the canonical form used for the
 * whole-proposal-ID ownership rule. Meaning across the WER boundary belongs
 * to explicit adapter mappers (#74), never to URI-string matching.
 */

/** JSON data: the only value shape that survives structuredClone round trips. */
export interface ReviewExtensionObject {
  readonly [key: string]: ReviewExtensionValue;
}

export type ReviewExtensionValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ReviewExtensionValue>
  | ReviewExtensionObject;

export type ReviewExtensionEnvelope = Readonly<{
  uri: string;
  required: boolean;
  value: ReviewExtensionValue;
}>;

export type ExtensionValidation =
  | Readonly<{
      envelopes: readonly ReviewExtensionEnvelope[];
      status: "valid";
    }>
  | Readonly<{ message: string; path: string; status: "invalid" }>
  | Readonly<{ message: string; path: string; status: "unsupported" }>;

const EXTENSION_URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isValidExtensionUri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !hasControlCharacter(value) &&
    EXTENSION_URI_PATTERN.test(value)
  );
}

function isJsonDataValue(value: unknown): value is ReviewExtensionValue {
  if (value === null) {
    return true;
  }
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") {
    return true;
  }
  if (kind === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonDataValue);
  }
  if (kind === "object") {
    return Object.values(value as Record<string, unknown>).every(
      isJsonDataValue,
    );
  }
  return false;
}

function hasExactlyEnvelopeKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === "required" &&
    keys[1] === "uri" &&
    keys[2] === "value"
  );
}

function cloneExtensionValue(
  value: ReviewExtensionValue,
): ReviewExtensionValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneExtensionValue));
  }
  if (typeof value === "object" && value !== null) {
    const cloned: Record<string, ReviewExtensionValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneExtensionValue(entry);
    }
    return Object.freeze(cloned);
  }
  return value;
}

function cloneEnvelope(
  envelope: ReviewExtensionEnvelope,
): ReviewExtensionEnvelope {
  return Object.freeze({
    required: envelope.required,
    uri: envelope.uri,
    value: cloneExtensionValue(envelope.value),
  });
}

export function cloneExtensionEnvelopes(
  envelopes: readonly ReviewExtensionEnvelope[],
): ReviewExtensionEnvelope[] {
  return envelopes.map(cloneEnvelope);
}

/**
 * Validate one `extensions` array in traversal order: per entry, grammar
 * first (`invalid`), then the required dispatch (`unsupported`). The first
 * failure wins; a fully optional array validates with cloned envelopes.
 */
export function validateExtensionEnvelopes(
  value: unknown,
  path: string,
): ExtensionValidation {
  if (!Array.isArray(value)) {
    return {
      message: "Expected an extension envelope array.",
      path,
      status: "invalid",
    };
  }
  const seen = new Set<string>();
  const envelopes: ReviewExtensionEnvelope[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const entry = value[index];
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      !hasExactlyEnvelopeKeys(entry as Record<string, unknown>)
    ) {
      return {
        message:
          "Extension envelopes must contain exactly uri, required, and value.",
        path: entryPath,
        status: "invalid",
      };
    }
    const record = entry as Record<string, unknown>;
    if (!isValidExtensionUri(record.uri)) {
      return {
        message: "Extension envelope uris must be absolute URIs with a scheme.",
        path: `${entryPath}.uri`,
        status: "invalid",
      };
    }
    if (typeof record.required !== "boolean") {
      return {
        message: "Extension envelope required flags must be boolean.",
        path: `${entryPath}.required`,
        status: "invalid",
      };
    }
    if (!isJsonDataValue(record.value)) {
      return {
        message: "Extension envelope values must be JSON data.",
        path: `${entryPath}.value`,
        status: "invalid",
      };
    }
    const uri = record.uri as string;
    if (seen.has(uri)) {
      return {
        message: `Extension envelope uri ${JSON.stringify(uri)} is duplicated in one envelope array.`,
        path: `${entryPath}.uri`,
        status: "invalid",
      };
    }
    seen.add(uri);
    if (record.required === true) {
      return {
        message: `Unrecognized required extension ${JSON.stringify(uri)} is not supported.`,
        path: entryPath,
        status: "unsupported",
      };
    }
    envelopes.push(
      cloneEnvelope({
        required: false,
        uri,
        value: record.value as ReviewExtensionValue,
      }),
    );
  }
  return { envelopes: Object.freeze(envelopes), status: "valid" };
}

function canonicalJsonValue(value: ReviewExtensionValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonValue).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJsonValue(
            (value as Record<string, ReviewExtensionValue>)[key]!,
          )}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Canonical form of one proposal's envelope set for the whole-ID ownership
 * rule: entries ordered by URI, every object member ordered. Value-equal
 * under the normalized comparator means identical canonical strings.
 */
export function canonicalExtensionSet(
  envelopes: readonly ReviewExtensionEnvelope[],
): string {
  const ordered = [...envelopes].sort((left, right) =>
    left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0,
  );
  return `[${ordered
    .map(
      (envelope) =>
        `{"required":${envelope.required ? "true" : "false"},"uri":${JSON.stringify(envelope.uri)},"value":${canonicalJsonValue(envelope.value)}}`,
    )
    .join(",")}]`;
}

export function sameExtensionSets(
  left: readonly ReviewExtensionEnvelope[],
  right: readonly ReviewExtensionEnvelope[],
): boolean {
  return canonicalExtensionSet(left) === canonicalExtensionSet(right);
}

/**
 * Read envelopes stored on live nodes during importJSON. Import only runs on
 * validated documents through the public API, so malformed input here is
 * unreachable; it throws like the other node-shape guards.
 */
export function readStoredExtensions(
  value: unknown,
): ReviewExtensionEnvelope[] {
  const validated = validateExtensionEnvelopes(value, "extensions");
  if (validated.status !== "valid") {
    throw new Error(`Invalid stored extension envelopes: ${validated.message}`);
  }
  return cloneExtensionEnvelopes(validated.envelopes);
}
