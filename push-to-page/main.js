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
  async pushAllBlocksToLinkedPages(editor, view) {
    const sourceFile = view.file;
    const sourceName = sourceFile ? sourceFile.basename : "Unknown";
    const totalLines = editor.lineCount();
    const blocks = [];
    let i = 0;
    while (i < totalLines) {
      if (editor.getLine(i).trim() === "") {
        i++;
        continue;
      }
      let endLine = i;
      while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== "") {
        endLine++;
      }
      const lines = [];
      for (let j = i; j <= endLine; j++) {
        lines.push(editor.getLine(j));
      }
      const text = lines.join("\n");
      blocks.push({ text, startLine: i, endLine });
      i = endLine + 1;
    }
    const linkedBlocks = blocks.filter((b) => this.extractWikiLinks(b.text).length > 0);
    if (linkedBlocks.length === 0) {
      new import_obsidian.Notice("No blocks with [[linked pages]] found on this page.");
      return;
    }
    let successCount = 0;
    let failCount = 0;
    const pushedPages = [];
    for (const block of linkedBlocks) {
      const linkedPages = this.extractWikiLinks(block.text);
      for (const pageName of linkedPages) {
        try {
          await this.appendBlockToPage(pageName, block.text, sourceName);
          successCount++;
          pushedPages.push(pageName);
        } catch (err) {
          console.error(`PushToPage: Failed to push to "${pageName}":`, err);
          failCount++;
        }
      }
    }
    if (successCount > 0 && failCount === 0) {
      new import_obsidian.Notice(`\u2705 Pushed ${linkedBlocks.length} block${linkedBlocks.length > 1 ? "s" : ""} to ${successCount} page${successCount > 1 ? "s" : ""}: ${pushedPages.join(", ")}`);
    } else if (successCount > 0 && failCount > 0) {
      new import_obsidian.Notice(`\u26A0\uFE0F Pushed to ${successCount} page(s), failed for ${failCount}.`);
    } else {
      new import_obsidian.Notice(`\u274C Failed to push any blocks.`);
    }
  }
  async pushBlockToLinkedPages(editor, view) {
    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line);
    const block = this.getBlockAtCursor(editor, cursor.line);
    if (!block.text.trim() === null || block.text.trim() === "") {
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
    let successCount = 0;
    let failCount = 0;
    for (const pageName of linkedPages) {
      try {
        await this.appendBlockToPage(pageName, block.text, sourceName);
        successCount++;
      } catch (err) {
        console.error(`PushToPage: Failed to push to "${pageName}":`, err);
        failCount++;
      }
    }
    if (successCount > 0 && failCount === 0) {
      new import_obsidian.Notice(`\u2705 Block pushed to ${successCount} page${successCount > 1 ? "s" : ""}.`);
    } else if (successCount > 0 && failCount > 0) {
      new import_obsidian.Notice(`\u26A0\uFE0F Pushed to ${successCount} page(s), failed for ${failCount}.`);
    } else {
      new import_obsidian.Notice(`\u274C Failed to push block. Check that linked pages exist or can be created.`);
    }
  }
  getBlockAtCursor(editor, cursorLine) {
    const totalLines = editor.lineCount();
    let startLine = cursorLine;
    while (startLine > 0 && editor.getLine(startLine - 1).trim() !== "") {
      startLine--;
    }
    let endLine = cursorLine;
    while (endLine < totalLines - 1 && editor.getLine(endLine + 1).trim() !== "") {
      endLine++;
    }
    const lines = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(editor.getLine(i));
    }
    return {
      text: lines.join("\n"),
      startLine,
      endLine
    };
  }
  extractWikiLinks(text) {
    const regex = /\[\[([^\[\]|#]+)(?:[|#][^\[\]]*)?\]\]/g;
    const links = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const pageName = match[1].trim();
      if (!links.includes(pageName)) {
        links.push(pageName);
      }
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
