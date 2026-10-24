import { probe, render } from "../host/tasks.ts";
import { describeDocument } from "../shared/describe.ts";
import { checkedDocument, newDocument, type MediaDocument } from "../shared/document.ts";
import { applyOperation } from "../shared/operations.ts";
import type { AppHost } from "./api.ts";

const host: AppHost<MediaDocument> = {
  parse: (text) => checkedDocument(JSON.parse(text)),
  serialize: (document) => `${JSON.stringify(document, null, 2)}\n`,
  apply: applyOperation,
  describe: describeDocument,
  create: newDocument,
  tasks: { probe, render },
};

export default host;
