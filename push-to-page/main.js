var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PushToPagePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
function getHeadingLevel(line) {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}
var PagePickerModal = class extends import_obsidian.Modal {
  constructor(app, pages, onConfirm) {
    super(app);
    this.pages = pages;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Push block to linked pages" });
    contentEl.createEl("p", {
      text: "Select which pages to send this block to:",
      cls: "push-to-page-subtitle"
    });
    const checkboxes = [];
    const list = contentEl.createDiv({ cls: "push-to-page-list" });
    list.style.cssText = "display:flex; flex-direction:column; gap:8px; margin:12px 0;";
    for (const page of this.pages) {
      const row = list.createDiv();
      row.style.cssText = "display:flex; align-items:center; gap:10px;";
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = true;
      checkbox.style.cssText = "width:16px; height:16px; cursor:pointer;";
      const label = row.createEl("label", { text: `[[${page}]]` });
      label.style.cssText = "cursor:pointer; font-size:14px;";
      label.onclick = () => {
        checkbox.checked = !checkbox.checked;
      };
      checkboxes.push({ page, checkbox });
    }
    const buttonRow = contentEl.createDiv();
    buttonRow.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:16px;";
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();
    const confirmBtn = buttonRow.createEl("button", { text: "Push" });
    confirmBtn.style.cssText = "background-color:var(--interactive-accent); color:var(--text-on-accent); font-weight:600;";
    confirmBtn.onclick = () => {
      const selected = checkboxes.filter((c) => c.checkbox.checked).map((c) => c.page);
      this.close();
      if (selected.length > 0) {
        this.onConfirm(selected);
      } else {
        new import_obsidian.Notice("No pages selected \u2014 nothing was pushed.");
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
var PushToPagePlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addCommand({
      id: "push-block-to-linked-pages",
      name: "Push block to linked pages",
      editorCallback: async (editor, view) => {
        await this.pushBlockToLinkedPages(editor, view);
      }
    });
    this.addCommand({
      id: "push-all-blocks-to-linked-pages",
      name: "Push all linked blocks on this page",
      editorCallback: async (editor, view) => {
        await this.pushAllBlocksToLinkedPages(editor, view);
      }
    });
  }
  // -----------------------------------------------------------------------
  // Push current block — shows picker if 2+ linked pages
  // -----------------------------------------------------------------------
  async pushBlockToLinkedPages(editor, view) {
    const cursor = editor.getCursor();
    const block = this.getSemanticBlock(editor, cursor.line);
    if (!block.text.trim()) {
      new import_obsidian.Notice("No block found at cursor position.");
      return;
    }
    const linkedPages = this.extractWikiLinks(block.text);
    if (linkedPages.length === 0) {
      new import_obsidian.Notice("No linked pages found in this block. Add [[PageName]] links to send content.");
      return;
    }
    const sourceFile = view.file;
    const sourceName = sourceFile ? sourceFile.basename : "Unknown";
    if (linkedPages.length === 1) {
      await this.sendToPages(linkedPages, block.text, sourceName);
    } else {
      new PagePickerModal(this.app, linkedPages, async (selected) => {
        await this.sendToPages(selected, block.text, sourceName);
      }).open();
    }
  }
  // -----------------------------------------------------------------------
  // Push all linked blocks — shows picker per block if 2+ linked pages
  // -----------------------------------------------------------------------
  async pushAllBlocksToLinkedPages(editor, view) {
    const sourceFile = view.file;
    const sourceName = sourceFile ? sourceFile.basename : "Unknown";
    const totalLines = editor.lineCount();
    const blocks = [];
    let i = 0;
    while (i < totalLines) {
      const line = editor.getLine(i).trim();
      if (line === "") {
        i++;
        continue;
      }
      const block = this.getSemanticBlock(editor, i);
      blocks.push(block);
      i = block.endLine + 1;
    }
    const seen = /* @__PURE__ */ new Set();
    const uniqueBlocks = blocks.filter((b) => {
      if (seen.has(b.startLine))
        return false;
      seen.add(b.startLine);
      return true;
    });
    const linkedBlocks = uniqueBlocks.filter((b) => this.extractWikiLinks(b.text).length > 0);
    if (linkedBlocks.length === 0) {
      new import_obsidian.Notice("No blocks with [[linked pages]] found on this page.");
      return;
    }
    await this.processBlocksSequentially(linkedBlocks, sourceName, 0);
  }
  async processBlocksSequentially(blocks, sourceName, index) {
    if (index >= blocks.length)
      return;
    const block = blocks[index];
    const linkedPages = this.extractWikiLinks(block.text);
    const proceed = async (selected) => {
      await this.sendToPages(selected, block.text, sourceName);
      await this.processBlocksSequentially(blocks, sourceName, index + 1);
    };
    if (linkedPages.length === 1) {
      await proceed(linkedPages);
    } else {
      const preview = block.text.split("\n")[0].replace(/^#{1,6}\s/, "").slice(0, 60);
      new PagePickerModal(this.app, linkedPages, proceed).open();
    }
  }
  // -----------------------------------------------------------------------
  // Send a block to a list of pages and report results
  // -----------------------------------------------------------------------
  async sendToPages(pages, blockText, sourceName) {
    let successCount = 0;
    let failCount = 0;
    const pushed = [];
    for (const pageName of pages) {
      try {
        await this.appendBlockToPage(pageName, blockText, sourceName);
        successCount++;
        pushed.push(pageName);
      } catch (err) {
        console.error(`PushToPage: Failed to push to "${pageName}":`, err);
        failCount++;
      }
    }
    if (successCount > 0 && failCount === 0) {
      new import_obsidian.Notice(`\u2705 Pushed to: ${pushed.join(", ")}`);
    } else if (successCount > 0 && failCount > 0) {
      new import_obsidian.Notice(`\u26A0\uFE0F Pushed to ${successCount} page(s), failed for ${failCount}.`);
    } else {
      new import_obsidian.Notice(`\u274C Failed to push block.`);
    }
  }
  // -----------------------------------------------------------------------
  // Semantic block detection
  // -----------------------------------------------------------------------
  getSemanticBlock(editor, startFromLine) {
    const totalLines = editor.lineCount();
    const cursorLineText = editor.getLine(startFromLine);
    const cursorHeadingLevel = getHeadingLevel(cursorLineText);
    if (cursorHeadingLevel > 0) {
      return this.collectHeadingBlock(editor, startFromLine, cursorHeadingLevel, totalLines);
    }
    for (let i = startFromLine - 1; i >= 0; i--) {
      const level = getHeadingLevel(editor.getLine(i));
      if (level > 0) {
        return this.collectHeadingBlock(editor, i, level, totalLines);
      }
    }
    return this.collectParagraphBlock(editor, startFromLine, totalLines);
  }
  collectHeadingBlock(editor, headingLine, headingLevel, totalLines) {
    let endLine = headingLine;
    for (let i = headingLine + 1; i < totalLines; i++) {
      const level = getHeadingLevel(editor.getLine(i));
      if (level > 0 && level <= headingLevel)
        break;
      endLine = i;
    }
    while (endLine > headingLine && editor.getLine(endLine).trim() === "")
      endLine--;
    const lines = [];
    for (let i = headingLine; i <= endLine; i++)
      lines.push(editor.getLine(i));
    return { text: lines.join("\n"), startLine: headingLine, endLine };
  }
  collectParagraphBlock(editor, cursorLine, totalLines) {
    let startLine = cursorLine;
    while (startLine > 0 && editor.getLine(startLine - 1).trim() !== "")
      startLine--;
    let endLine = cursorLine;
    while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== "")
      endLine++;
    const lines = [];
    for (let i = startLine; i <= endLine; i++)
      lines.push(editor.getLine(i));
    return { text: lines.join("\n"), startLine, endLine };
  }
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  extractWikiLinks(text) {
    const regex = /\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]/g;
    const links = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const pageName = match[1].trim();
      if (!links.includes(pageName))
        links.push(pageName);
    }
    return links;
  }
  async appendBlockToPage(pageName, blockText, sourceName) {
    const { vault } = this.app;
    let file = vault.getAbstractFileByPath(`${pageName}.md`);
    if (!file) {
      const allFiles = vault.getMarkdownFiles();
      file = allFiles.find((f) => f.basename === pageName) || null;
    }
    const timestamp = new Date().toISOString().split("T")[0];
    const appendContent = `

---
> [!note] Pushed from [[${sourceName}]] on ${timestamp}

${blockText}`;
    if (file) {
      const existing = await vault.read(file);
      await vault.modify(file, existing + appendContent);
    } else {
      await vault.create(`${pageName}.md`, appendContent.trimStart());
    }
  }
  onunload() {
  }
};
